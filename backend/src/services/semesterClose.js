const pool = require("../config/db");
const { logAction } = require("../middleware/audit");
const { buildFeaturesMany } = require("./featureBuilder");
const { getCourseSummary } = require("./studentCourses");
const { notify } = require("./counselors");
const standing = require("./academicStanding");
const { startRun } = require("./predictionRuns");

// "Close semester" (Phase 7, step 5). For every student with enrolments this term:
//   GPA  = the provisional SGPA from this term's course marks (featureBuilder, the formula in CLAUDE.md)
//   CGPA = semester 1: the GPA; later: (Previous_SGPA + SGPA) / 2 - the projected CGPA
//   judged on gradeUsed() (GPA in the first semester, CGPA after) -> nextStanding()
// preview() writes nothing. confirm() needs resultsFinal (Handbook 1.20.4) and does everything in ONE
// transaction: the semester_closes row, a standing row per student, the new official CGPA (the closed
// term's own performance row: same semester, close_id set, Previous_SGPA = the term before, SGPA = this
// term), current_semester + 1 (not past the programme's last semester - Phase 7.1 Bug 2), every
// enrolment of the term marked 'completed' (Bug 1: its marks are no longer "this term"), a warning
// letter for each new probation, a notification for each affected student. Afterwards the students are re-predicted through a batch
// run (scope 'student', trigger 'semester_close'). Probation never changes the ML label by itself.

const httpError = (status, message, payload) => Object.assign(new Error(message), { status, payload });
const round2 = (v) => (v == null ? null : Math.round(Number(v) * 100) / 100);
const MARKS = ["assignment_avg", "quiz_avg", "midterm_marks", "final_marks"];

/** Students with at least one enrolment this term (status 'enrolled'). */
async function studentsInTerm(db) {
  const { rows } = await db.query(
    `SELECT s.student_id, s.roll_no, s.full_name, s.current_semester, s.academic_status, s.probation_count, s.user_id,
            d.code AS department
     FROM students s JOIN departments d ON d.department_id = s.department_id
     WHERE EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = s.student_id AND e.status = 'enrolled')
     ORDER BY s.student_id`
  );
  return rows;
}

/** The close plan: one entry per student, plus counts. Reads only. */
async function buildPlan(db = pool) {
  const students = await studentsInTerm(db);
  const features = await buildFeaturesMany(students.map((s) => s.student_id), db);
  const plan = [];
  for (const s of students) {
    const f = features.get(s.student_id);
    const summary = await getCourseSummary(s.student_id, db);
    const incomplete = summary.courses.filter((c) => MARKS.some((k) => c[k] == null)).map((c) => c.course_code);
    const semesterNo = s.current_semester;
    const programme = standing.programmeFor(s.department);
    const finalSemester = semesterNo >= standing.lengthFor(programme);
    const gpa = f ? round2(f.features.SGPA) : null;
    const cgpa = !f ? null : semesterNo === 1 ? gpa : round2(f.features.CGPA);
    const used = standing.gradeUsed(semesterNo, gpa, cgpa);
    const to = incomplete.length
      ? { status: s.academic_status, count: s.probation_count }
      : standing.nextStanding(s.academic_status, s.probation_count, used, semesterNo, { programme });
    const newProbation = (to.status === "probation_1" || to.status === "probation_2") && to.status !== s.academic_status;
    plan.push({
      student_id: s.student_id,
      user_id: s.user_id,
      roll_no: s.roll_no,
      name: s.full_name,
      department: s.department,
      programme,
      minimum: standing.minimumFor(programme),
      semester_no: semesterNo,
      final_semester: finalSemester,
      next_semester: finalSemester ? semesterNo : semesterNo + 1,
      gpa,
      cgpa,
      cgpa_used: used,
      uses: semesterNo === 1 && standing.config.first_semester_uses_gpa ? "GPA" : "CGPA",
      from: { status: s.academic_status, count: s.probation_count },
      to,
      changed: to.status !== s.academic_status,
      letter: newProbation ? to.count : null,
      incomplete,
      features: f ? f.features : null,
      extra: f ? f.extra : null,
    });
  }
  const counts = Object.fromEntries(standing.STATUSES.map((st) => [st, plan.filter((p) => p.to.status === st).length]));
  return { plan, counts };
}

const publicRow = ({ user_id, features, extra, ...rest }) => rest; // eslint-disable-line no-unused-vars

/** preview(termLabel) -> {termLabel, total, counts, changed, incomplete, alreadyClosed, students}. Writes nothing. */
async function preview(termLabel) {
  const { plan, counts } = await buildPlan();
  const dup = await pool.query("SELECT 1 FROM semester_closes WHERE lower(term_label) = lower($1)", [termLabel]);
  return {
    termLabel,
    total: plan.length,
    counts,
    changed: plan.filter((p) => p.changed).length,
    letters: plan.filter((p) => p.letter).length,
    incomplete: plan.filter((p) => p.incomplete.length).map((p) => ({ roll_no: p.roll_no, name: p.name, courses: p.incomplete })),
    alreadyClosed: dup.rows.length > 0,
    students: plan.map(publicRow),
  };
}

const LABEL = standing.LABELS;
const fmt = (v) => Number(v).toFixed(2);

/** The notice a student gets at a close (null = nothing to tell them). */
function noticeFor(p, termLabel) {
  const min = fmt(p.minimum);
  const what = p.uses === "GPA" ? "GPA" : "CGPA";
  if (p.to.status === "probation_1" || p.to.status === "probation_2") {
    if (!p.changed) return null;
    return {
      subject: `Academic standing: ${LABEL[p.to.status]}`,
      message:
        `${termLabel} has been closed. Your ${what} is ${fmt(p.cgpa_used)}, below the ${min} minimum for your programme, so you are now on ` +
        `${LABEL[p.to.status]} (BU Student Handbook 5.5). A warning letter is waiting on your dashboard - please read and acknowledge it.`,
    };
  }
  if (p.to.status === "dropped" && p.changed) {
    return {
      subject: "Academic standing: Dropped",
      message:
        `${termLabel} has been closed. Your ${what} is ${fmt(p.cgpa_used)}, still below the ${min} minimum in the semester after two consecutive ` +
        `probations, so under the BU Student Handbook (5.5.3) you are dropped from the programme. Please contact your department.`,
    };
  }
  if (p.to.status === "good" && (p.from.status === "probation_1" || p.from.status === "probation_2")) {
    return {
      subject: "Academic standing: Good standing",
      message: `${termLabel} has been closed. Your ${what} is ${fmt(p.cgpa_used)} - you are off probation and back in good standing. Well done.`,
    };
  }
  return null;
}

/**
 * confirm({termLabel, resultsFinal}, adminUserId) -> {close, counts, letters, notified, run}
 * 400 without resultsFinal; 409 TERM_ALREADY_CLOSED; 409 RESULTS_INCOMPLETE (a course without all four marks).
 */
async function confirm({ termLabel, resultsFinal }, adminUserId) {
  if (resultsFinal !== true) {
    throw httpError(400, "Confirm that all results (including FYP) are final before closing the semester (BU Student Handbook 1.20.4).", {
      code: "RESULTS_NOT_FINAL",
    });
  }
  const client = await pool.connect();
  let out;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(7401)"); // one close at a time
    const dup = await client.query("SELECT id FROM semester_closes WHERE lower(term_label) = lower($1)", [termLabel]);
    if (dup.rows.length) throw httpError(409, `${termLabel} has already been closed.`, { code: "TERM_ALREADY_CLOSED" });
    const { plan, counts } = await buildPlan(client);
    if (!plan.length) throw httpError(400, "No student has enrolments this term, so there is nothing to close.");
    const incomplete = plan.filter((p) => p.incomplete.length);
    if (incomplete.length) {
      throw httpError(409, `${incomplete.length} student(s) still have courses without final marks. All results must be final first (Handbook 1.20.4).`, {
        code: "RESULTS_INCOMPLETE",
        incomplete: incomplete.map((p) => ({ roll_no: p.roll_no, name: p.name, courses: p.incomplete })),
      });
    }

    const { rows: [close] } = await client.query(
      `INSERT INTO semester_closes (term_label, closed_by, students_total, good_count, probation_1_count, probation_2_count, dropped_count, not_evaluated_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [termLabel, adminUserId, plan.length, counts.good, counts.probation_1, counts.probation_2, counts.dropped, counts.not_evaluated]
    );

    let letters = 0;
    let notified = 0;
    for (const p of plan) {
      const standingId = await standing.recordStanding(client, {
        studentId: p.student_id,
        closeId: close.id,
        semesterNo: p.semester_no,
        cgpaUsed: p.to.status === "not_evaluated" ? null : p.cgpa_used,
        status: p.to.status,
        count: p.to.count,
        source: "close",
        finalSemesterCompleted: p.final_semester,
      });

      // the new official CGPA: the closed term's own record (same semester, close_id). Until marks for a new
      // term exist, featureBuilder gives the model exactly this completed term; then its SGPA becomes Previous_SGPA.
      const f = p.features;
      if (f && p.cgpa != null) {
        const prev = f.Previous_SGPA;
        await client.query(
          `INSERT INTO student_semester_performance
             (student_id, semester, attendance_percentage, assignment_avg, quiz_avg, midterm_marks, final_marks,
              study_hours_per_week, lms_login_count, assignment_submission_rate, previous_sgpa, sgpa, cgpa,
              consecutive_low_cgpa, failed_courses, credits_enrolled, credits_passed, warning_count, target_label, data_source, close_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NULL, 'live', $19)`,
          [
            p.student_id, p.semester_no, f.Attendance_Percentage, f.Assignment_Avg, f.Quiz_Avg, f.Midterm_Marks, f.Final_Marks,
            f.Study_Hours_Per_Week, f.LMS_Login_Count, f.Assignment_Submission_Rate, prev, f.SGPA, p.cgpa,
            p.cgpa < 2 && prev != null && prev < 2 ? 1 : 0, f.Failed_Courses, f.Credits_Enrolled, f.Credits_Passed,
            (Number(p.extra && p.extra.Warning_Count) || 0) + (p.letter ? 1 : 0), close.id,
          ]
        );
        await client.query("UPDATE students SET cgpa = $2, current_semester = $3 WHERE student_id = $1", [p.student_id, p.cgpa, p.next_semester]);
      }

      if (p.letter) {
        await client.query("INSERT INTO warning_letters (standing_id, student_id, level, issued_by) VALUES ($1, $2, $3, $4)", [
          standingId, p.student_id, p.letter, adminUserId,
        ]);
        letters += 1;
      }
      const notice = noticeFor(p, termLabel);
      if (notice) {
        await client.query(
          `INSERT INTO notifications (sender_admin_id, recipient_user_id, subject, message, link, kind)
           VALUES ($1, $2, $3, $4, '/student#standing', 'standing')`,
          [adminUserId, p.user_id, notice.subject, notice.message]
        );
        notified += 1;
      }
    }
    // the term is over: its enrolments are finished, so their marks are no longer "this term" (dropped stay dropped)
    const ended = await client.query("UPDATE enrollments SET status = 'completed' WHERE student_id = ANY($1) AND status = 'enrolled'", [
      plan.map((p) => p.student_id),
    ]);
    await client.query("COMMIT");
    out = { enrolmentsCompleted: ended.rowCount, close, counts, letters, notified, students: plan.map((p) => p.student_id), changed: plan.filter((p) => p.changed).length };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  await logAction(adminUserId, "CLOSE_SEMESTER", "semester_closes", out.close.id, {
    term_label: termLabel,
    students: out.students.length,
    counts: out.counts,
    changed: out.changed,
    letters: out.letters,
    notified: out.notified,
    enrolments_completed: out.enrolmentsCompleted,
  });

  // re-predict the affected students through the existing batch run (outside the transaction)
  let run = null;
  try {
    run = await startRun({ scope: "student", studentIds: out.students, startedBy: adminUserId, trigger: "semester_close" });
  } catch (e) {
    run = { error: e.message };
  }
  const { students, ...rest } = out;
  return { ...rest, students: students.length, run };
}

async function listCloses() {
  const { rows } = await pool.query(
    `SELECT sc.*, u.email AS closed_by_email FROM semester_closes sc LEFT JOIN users u ON u.user_id = sc.closed_by ORDER BY sc.id DESC`
  );
  return rows;
}

module.exports = { preview, confirm, buildPlan, listCloses, noticeFor };
