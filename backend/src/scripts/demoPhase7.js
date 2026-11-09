// Phase 7 demo data, added by demoReset.js after the standing seed and before the prediction run.
// Fixed (no randomness): every date is counted from --as-of (Pakistan time), so two resets on the same
// day give the same rows.
//
//   - Dr. Ayesha Khan is the active counsellor of three students in her classes:
//       BU-122785 Ayesha Akhtar (At-Risk, Probation 1): Present, Absent, Present + one upcoming (in person)
//       BU-112907 Zain Khan     (At-Risk, good standing): Present, Present, one AWAITING ATTENDANCE
//                                (yesterday - the "teacher marks it Present" demo) + one upcoming (online)
//       BU-114400 Bushra Awan   (good standing): Present, Absent
//   - BU-114400 Bushra Awan is the semester-close demo student: her AI301 and AI302 final exams are set to
//     32 (grades stay C), so this term's projected CGPA drops below 2.00 and closing the semester puts her
//     on Probation 1 with a warning letter.
// BU-144766 (Farah Javed) keeps no counsellor: the interventions demo assigns Dr. Khan to her live.
const { deriveGrade } = require("../services/grading");

const COUNSELLOR = "ayesha.khan@smartedu.edu";
const PROBATION_DEMO = { roll: "BU-114400", courses: ["AI301", "AI302"], final: 32 };

// [roll, daysFromAsOf, "HH:MM", minutes, mode, location, attendance | null, notes | null]
const SESSIONS = [
  ["BU-122785", -28, "11:00", 30, "in_person", "Room 204", "present", "Went through the two failed courses; agreed a weekly AI301 revision slot."],
  ["BU-122785", -21, "11:00", 30, "in_person", "Room 204", "absent", "Did not come; emailed to rebook."],
  ["BU-122785", -14, "11:00", 30, "in_person", "Room 204", "present", "AI301 quiz marks improving; still behind in AI302 assignments."],
  ["BU-122785", 2, "11:00", 30, "in_person", "Room 204", null, null],
  ["BU-112907", -20, "14:00", 30, "online", "https://meet.google.com/smartedu-demo", "present", "Study hours are low (about 10 a week); set a weekly plan."],
  ["BU-112907", -13, "14:00", 30, "online", "https://meet.google.com/smartedu-demo", "present", "Kept to the plan; midterm preparation on track."],
  ["BU-112907", -1, "14:00", 30, "in_person", "Room 204", null, null], // ended, not marked: "Awaiting attendance"
  ["BU-112907", 3, "14:00", 45, "online", "https://meet.google.com/smartedu-demo", null, null],
  ["BU-114400", -17, "15:00", 30, "in_person", "Room 204", "present", "Final exam preparation for AI301 and AI302."],
  ["BU-114400", -10, "15:00", 30, "in_person", "Room 204", "absent", null],
];

function addDays(ymd, days) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const pkt = (ymd, days, hhmm) => `${addDays(ymd, days)}T${hhmm}:00+05:00`;

async function seedPhase7Demo(pool, { asOf, adminUserId }) {
  const { rows: [fac] } = await pool.query(
    "SELECT f.faculty_id, f.user_id FROM faculty f JOIN users u ON u.user_id = f.user_id WHERE u.email = $1",
    [COUNSELLOR]
  );
  const rolls = [...new Set(SESSIONS.map((s) => s[0]))];
  const { rows: students } = await pool.query("SELECT student_id, roll_no FROM students WHERE roll_no = ANY($1) ORDER BY roll_no", [rolls]);
  const byRoll = new Map(students.map((s) => [s.roll_no, s.student_id]));

  // counsellor assignments (active, Dr. Khan), assigned 35 days before --as-of
  const assignment = new Map();
  for (const roll of rolls) {
    const lastPresent = SESSIONS.filter((s) => s[0] === roll && s[6] === "present").map((s) => pkt(asOf, s[1], s[2])).pop() || null;
    const { rows } = await pool.query(
      `INSERT INTO counselor_assignments (student_id, faculty_id, assigned_by, created_at, last_contacted_at)
       VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz) RETURNING id`,
      [byRoll.get(roll), fac.faculty_id, adminUserId, pkt(asOf, -35, "10:00"), lastPresent]
    );
    assignment.set(roll, rows[0].id);
  }

  for (const [roll, days, hhmm, minutes, mode, location, attendance, notes] of SESSIONS) {
    const at = pkt(asOf, days, hhmm);
    await pool.query(
      `INSERT INTO counselling_sessions
         (assignment_id, student_id, faculty_id, scheduled_at, duration_min, mode, location, agenda, reason,
          attendance, counsellor_notes, marked_by, marked_at, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4::timestamptz, $5::int, $6, $7, $8, 'risk', $9::varchar, $10, $11,
               CASE WHEN $9::varchar IS NULL THEN NULL ELSE $4::timestamptz + $5::int * INTERVAL '1 minute' END,
               $12, $13::timestamptz, $13::timestamptz)`,
      [
        assignment.get(roll), byRoll.get(roll), fac.faculty_id, at, minutes, mode, location,
        "Regular check-in on this term's progress", attendance, notes, attendance ? fac.user_id : null,
        adminUserId, pkt(asOf, -35, "10:30"),
      ]
    );
  }

  // the semester-close demo student: lower the two final exams in Dr. Khan's courses
  const { rows: results } = await pool.query(
    `SELECT cr.result_id, cr.assignment_avg, cr.quiz_avg, cr.midterm_marks
     FROM course_results cr JOIN enrollments e ON e.enrollment_id = cr.enrollment_id
     JOIN faculty_courses fc ON fc.faculty_course_id = e.faculty_course_id JOIN courses c ON c.course_id = fc.course_id
     JOIN students s ON s.student_id = e.student_id
     WHERE s.roll_no = $1 AND c.course_code = ANY($2) ORDER BY c.course_code`,
    [PROBATION_DEMO.roll, PROBATION_DEMO.courses]
  );
  for (const r of results) {
    const grade = deriveGrade({ assignment_avg: Number(r.assignment_avg), quiz_avg: Number(r.quiz_avg), midterm_marks: Number(r.midterm_marks), final_marks: PROBATION_DEMO.final });
    await pool.query("UPDATE course_results SET final_marks = $2, grade = $3 WHERE result_id = $1", [r.result_id, PROBATION_DEMO.final, grade]);
  }
  return { assignments: assignment.size, sessions: SESSIONS.length, marksChanged: results.length };
}

module.exports = { seedPhase7Demo, SESSIONS, PROBATION_DEMO, COUNSELLOR };
