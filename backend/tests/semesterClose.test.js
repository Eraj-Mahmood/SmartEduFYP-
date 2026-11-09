const request = require("supertest");
const app = require("../src/app");
const { login, pool } = require("./helpers");
const { noticeFor } = require("../src/services/semesterClose");
const { getRun } = require("../src/services/predictionRuns");
const { recordStanding } = require("../src/services/academicStanding");

// Semester close, warning letters and the enrolment hold (Phase 7, step 5). The close changes real
// rows for every student enrolled this term, so the suite snapshots them first and puts everything
// back afterwards (students' columns and prediction pointers; the close and everything hanging off it;
// the new performance rows, notifications, predictions, the re-prediction run and the audit rows).
const as = (t) => ({ Authorization: `Bearer ${t}` });
const since = new Date();
const TERM = `Jest Term ${Date.now()}`;
let admin, plan, scope, studentsBefore, enrolmentsBefore, closeResult;

const tables = ["semester_closes", "academic_standing", "warning_letters", "enrolment_approvals", "student_semester_performance", "notifications", "predictions"];
async function snapshot() {
  const out = {};
  for (const t of tables) out[t] = (await pool.query(`SELECT COUNT(*)::int AS n FROM ${t}`)).rows[0].n;
  out.students = (
    await pool.query(
      `SELECT md5(string_agg(concat_ws(',', student_id, cgpa, current_semester, academic_status, probation_count, latest_prediction_id), ';' ORDER BY student_id)) AS h FROM students`
    )
  ).rows[0].h;
  return out;
}

const preview = (body) => request(app).post("/api/admin/semester-close/preview").set(as(admin)).send(body);
const confirm = (body) => request(app).post("/api/admin/semester-close/confirm").set(as(admin)).send(body);

beforeAll(async () => {
  admin = await login(app, "admin@smartedu.edu", "admin");
  const p = await preview({ termLabel: TERM });
  plan = p.body;
  scope = plan.students.map((s) => s.student_id);
  studentsBefore = (
    await pool.query("SELECT student_id, cgpa, current_semester, academic_status, probation_count, latest_prediction_id FROM students WHERE student_id = ANY($1)", [scope])
  ).rows;
  enrolmentsBefore = (await pool.query("SELECT enrollment_id, status FROM enrollments WHERE student_id = ANY($1)", [scope])).rows;
});

afterAll(async () => {
  // let the re-prediction run finish before undoing it
  if (closeResult && closeResult.run && closeResult.run.id) {
    for (let i = 0; i < 100; i++) {
      const r = await getRun(closeResult.run.id);
      if (!r || r.status === "completed" || r.status === "failed") break;
      await new Promise((res) => setTimeout(res, 200));
    }
  }
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    for (const s of studentsBefore) {
      await c.query(
        "UPDATE students SET cgpa = $2, current_semester = $3, academic_status = $4, probation_count = $5, latest_prediction_id = $6 WHERE student_id = $1",
        [s.student_id, s.cgpa, s.current_semester, s.academic_status, s.probation_count, s.latest_prediction_id]
      );
    }
    // Phase 7.1: the close marks the term's enrolments 'completed'
    for (const e of enrolmentsBefore) await c.query("UPDATE enrollments SET status = $2 WHERE enrollment_id = $1", [e.enrollment_id, e.status]);
    await c.query("DELETE FROM predictions WHERE student_id = ANY($1) AND created_at >= $2", [scope, since]);
    await c.query("DELETE FROM prediction_runs WHERE started_at >= $1 AND scope = 'student'", [since]);
    await c.query("DELETE FROM semester_closes WHERE term_label LIKE 'Jest Term %'"); // cascades standing, letters, approvals
    await c.query("DELETE FROM student_semester_performance WHERE student_id = ANY($1) AND created_at >= $2", [scope, since]);
    await c.query("DELETE FROM notifications WHERE kind = 'standing' AND sent_at >= $1", [since]);
    await c.query(
      "DELETE FROM audit_log WHERE created_at >= $1 AND action IN ('CLOSE_SEMESTER', 'ACKNOWLEDGE_WARNING_LETTER', 'RECORD_ENROLMENT_APPROVAL', 'ENROLL_STUDENT')",
      [since]
    );
    await c.query("COMMIT");
  } finally {
    c.release();
  }
  await pool.end();
});

describe("preview", () => {
  test("lists every student enrolled this term with from -> to, and writes nothing", async () => {
    expect(plan.total).toBeGreaterThan(0);
    expect(Object.values(plan.counts).reduce((a, b) => a + b, 0)).toBe(plan.total);
    expect(plan.students[0]).toEqual(expect.objectContaining({ roll_no: expect.any(String), from: expect.any(Object), to: expect.any(Object), cgpa_used: expect.anything() }));
    expect(plan.incomplete).toEqual([]);
    expect(plan.alreadyClosed).toBe(false);
    const before = await snapshot();
    const again = await preview({ termLabel: TERM });
    expect(again.status).toBe(200);
    expect(await snapshot()).toEqual(before);
  });

  test("the first semester is judged on GPA, later ones on CGPA", () => {
    for (const s of plan.students) {
      expect(s.uses).toBe(s.semester_no === 1 ? "GPA" : "CGPA");
      expect(s.cgpa_used).toBe(s.semester_no === 1 ? s.gpa : s.cgpa);
    }
  });

  test("termLabel is validated", async () => {
    expect((await preview({})).status).toBe(400);
    expect((await preview({ termLabel: "x" })).status).toBe(400);
  });
});

describe("confirm", () => {
  test("refused without resultsFinal (Handbook 1.20.4); nothing written", async () => {
    const before = await snapshot();
    const res = await confirm({ termLabel: TERM });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("RESULTS_NOT_FINAL");
    expect(res.body.error).toMatch(/1\.20\.4/);
    expect((await confirm({ termLabel: TERM, resultsFinal: false })).status).toBe(400);
    expect((await confirm({ termLabel: TERM, resultsFinal: "true" })).status).toBe(400);
    expect(await snapshot()).toEqual(before);
  });

  test("all-or-nothing: an error half-way rolls everything back", async () => {
    const before = await snapshot();
    // a database trigger that fails the first warning letter insert - deep inside the transaction
    await pool.query(`CREATE OR REPLACE FUNCTION jest_fail_letter() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'jest: forced failure'; END $$ LANGUAGE plpgsql`);
    await pool.query("CREATE TRIGGER jest_fail_letter BEFORE INSERT ON warning_letters FOR EACH ROW EXECUTE FUNCTION jest_fail_letter()");
    const quiet = jest.spyOn(console, "error").mockImplementation(() => {}); // the server logs the forced error
    try {
      const res = await confirm({ termLabel: TERM, resultsFinal: true });
      expect(res.status).toBe(500);
      expect(res.body.error).not.toMatch(/jest: forced failure/); // no raw database message
    } finally {
      quiet.mockRestore();
      await pool.query("DROP TRIGGER IF EXISTS jest_fail_letter ON warning_letters");
      await pool.query("DROP FUNCTION IF EXISTS jest_fail_letter()");
    }
    expect(await snapshot()).toEqual(before);
    const audit = await pool.query("SELECT 1 FROM audit_log WHERE action = 'CLOSE_SEMESTER' AND created_at >= $1", [since]);
    expect(audit.rows.length).toBe(0);
  });

  test("closes the term: standing rows, new official CGPA, letters, notifications, audit, re-prediction", async () => {
    expect(plan.letters).toBeGreaterThan(0); // the demo data has new probations
    const before = await snapshot();
    const res = await confirm({ termLabel: TERM, resultsFinal: true });
    expect(res.status).toBe(201);
    closeResult = res.body;
    expect(res.body).toMatchObject({ counts: plan.counts, letters: plan.letters, students: plan.total });
    const expectedNotices = plan.students.filter((p) => noticeFor(p, TERM)).length;
    expect(res.body.notified).toBe(expectedNotices);

    const after = await snapshot();
    expect(after.semester_closes).toBe(before.semester_closes + 1);
    expect(after.academic_standing).toBe(before.academic_standing + plan.total);
    expect(after.warning_letters).toBe(before.warning_letters + plan.letters);
    expect(after.student_semester_performance).toBe(before.student_semester_performance + plan.total);
    expect(after.notifications).toBe(before.notifications + expectedNotices);

    const { rows } = await pool.query(
      "SELECT student_id, academic_status, probation_count, current_semester, cgpa FROM students WHERE student_id = ANY($1)",
      [scope]
    );
    const byId = new Map(rows.map((r) => [r.student_id, r]));
    for (const p of plan.students) {
      const r = byId.get(p.student_id);
      expect({ status: r.academic_status, count: r.probation_count }).toEqual(p.to);
      expect(r.current_semester).toBe(p.final_semester ? p.semester_no : p.semester_no + 1); // Phase 7.1: not past the last semester
      expect(Number(r.cgpa)).toBeCloseTo(p.cgpa, 2);
    }
    // a letter for each new probation, at the right level
    const letters = await pool.query(
      `SELECT w.level, a.status FROM warning_letters w JOIN academic_standing a ON a.id = w.standing_id
       JOIN semester_closes sc ON sc.id = a.close_id WHERE sc.term_label = $1`,
      [TERM]
    );
    expect(letters.rows.length).toBe(plan.letters);
    for (const l of letters.rows) expect(l.status).toBe(`probation_${l.level}`);
    const audit = await pool.query("SELECT details FROM audit_log WHERE action = 'CLOSE_SEMESTER' AND entity_id = $1", [res.body.close.id]);
    expect(audit.rows[0].details).toMatchObject({ term_label: TERM, students: plan.total, letters: plan.letters });
    // re-predicted through a batch run
    expect(res.body.run).toMatchObject({ scope: "student", total: plan.total });
    let run;
    for (let i = 0; i < 100; i++) {
      run = await getRun(res.body.run.id);
      if (run.status !== "running") break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(run.status).toBe("completed");
    const preds = await pool.query("SELECT COUNT(*)::int AS n FROM predictions WHERE run_id = $1 AND triggered_by = 'semester_close'", [run.id]);
    expect(preds.rows[0].n).toBe(plan.total);
  });

  test("the same term can't be closed twice", async () => {
    const res = await confirm({ termLabel: TERM.toUpperCase(), resultsFinal: true });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TERM_ALREADY_CLOSED");
    expect((await preview({ termLabel: TERM })).body.alreadyClosed).toBe(true);
  });
});

describe("warning letters", () => {
  let mine, myToken, otherToken, letterId;

  beforeAll(async () => {
    // a student who got a letter at the close and can log in (synthetic roll numbers: studentNNNNNN@)
    const { rows } = await pool.query(
      `SELECT w.id, s.roll_no FROM warning_letters w JOIN academic_standing a ON a.id = w.standing_id
       JOIN semester_closes sc ON sc.id = a.close_id JOIN students s ON s.student_id = w.student_id
       WHERE sc.term_label = $1 AND s.roll_no ~ '^BU-[0-9]+$' AND s.roll_no <> 'BU-100040' ORDER BY w.id LIMIT 1`,
      [TERM]
    );
    mine = rows[0];
    letterId = mine.id;
    myToken = await login(app, `student${mine.roll_no.slice(3)}@smartedu.edu`, "student");
    otherToken = await login(app, "student100040@smartedu.edu", "student");
  });

  test("the student sees their own letter with the handbook wording; others don't", async () => {
    const res = await request(app).get("/api/student/warning-letters").set(as(myToken));
    expect(res.status).toBe(200);
    const l = res.body.find((x) => x.id === letterId);
    expect(l).toMatchObject({ signature: "Head of Department", acknowledged_at: null, term: TERM, minimum: "2.00" });
    expect(l.body).toMatch(/below the minimum of 2\.00/);
    expect(l.next_steps.join(" ")).toMatch(/dropped from the programme \(Handbook 5\.5\.3\)/);
    if (l.level === 2) expect(l.next_steps.join(" ")).toMatch(/Principal's prior approval/);
    const other = await request(app).get("/api/student/warning-letters").set(as(otherToken));
    expect(other.body.map((x) => x.id)).not.toContain(letterId);
  });

  test("the student's standing card data comes from their own record", async () => {
    const res = await request(app).get("/api/student/standing").set(as(myToken));
    expect(res.status).toBe(200);
    expect(res.body.status).toMatch(/^probation_[12]$/);
    expect(res.body.term).toBe(TERM);
    expect(res.body.letters.map((x) => x.id)).toContain(letterId);
    expect(res.body).not.toHaveProperty("approvals");
  });

  test("acknowledging: own letter only, stores the time, only once", async () => {
    expect((await request(app).put(`/api/student/warning-letters/${letterId}/acknowledge`).set(as(otherToken))).status).toBe(404);
    const ok = await request(app).put(`/api/student/warning-letters/${letterId}/acknowledge`).set(as(myToken));
    expect(ok.status).toBe(200);
    expect(new Date(ok.body.acknowledged_at).getTime()).toBeGreaterThan(since.getTime());
    expect(ok.body.acknowledged_text).toMatch(/^Acknowledged by the student on /);
    const { rows } = await pool.query("SELECT acknowledged_at FROM warning_letters WHERE id = $1", [letterId]);
    expect(rows[0].acknowledged_at).not.toBeNull();
    expect((await request(app).put(`/api/student/warning-letters/${letterId}/acknowledge`).set(as(myToken))).status).toBe(409);
    const audit = await pool.query("SELECT 1 FROM audit_log WHERE action = 'ACKNOWLEDGE_WARNING_LETTER' AND entity_id = $1", [letterId]);
    expect(audit.rows.length).toBe(1);
  });

  test("admin: print data and the list", async () => {
    const one = await request(app).get(`/api/admin/warning-letters/${letterId}`).set(as(admin));
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({ id: letterId, student: { roll_no: mine.roll_no }, signature: "Head of Department" });
    expect(one.body.date).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) /);
    expect((await request(app).get("/api/admin/warning-letters/99999999").set(as(admin))).status).toBe(404);
    const list = await request(app).get("/api/admin/warning-letters?acknowledged=yes").set(as(admin));
    expect(list.body.rows.map((r) => r.id)).toContain(letterId);
    const closes = await request(app).get("/api/admin/semester-closes").set(as(admin));
    expect(closes.body[0]).toMatchObject({ term_label: TERM, students_total: plan.total });
  });
});

describe("enrolment hold (Handbook 5.5.3 / 5.5.5)", () => {
  let classId, held, heldBefore, heldRowId, dropped, droppedBefore;
  const enroll = (studentId) => request(app).post("/api/admin/enrollments").set(as(admin)).send({ student_id: studentId, faculty_course_id: classId });

  beforeAll(async () => {
    classId = (await pool.query("SELECT faculty_course_id FROM faculty_courses ORDER BY faculty_course_id LIMIT 1")).rows[0].faculty_course_id;
    const pick = async (status, offset) =>
      (
        await pool.query(
          `SELECT s.student_id, s.academic_status, s.probation_count FROM students s
           WHERE s.academic_status = $1 AND s.roll_no LIKE 'BU-12%'
             AND NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = s.student_id)
           ORDER BY s.student_id OFFSET $2 LIMIT 1`,
          [status, offset]
        )
      ).rows[0];
    // nobody is seeded on Probation 2 any more (Phase 7.1 Bug 5): put a Probation 1 student there for the test
    held = await pick("probation_1", 0);
    heldBefore = held;
    heldRowId = await recordStanding(pool, { studentId: held.student_id, semesterNo: 5, cgpaUsed: 1.5, status: "probation_2", count: 2, source: "seed" });
    dropped = await pick("good", 0);
    droppedBefore = dropped;
    await recordStanding(pool, { studentId: dropped.student_id, semesterNo: 5, cgpaUsed: 1.5, status: "dropped", count: 2, source: "seed" });
  });

  afterAll(async () => {
    await pool.query("DELETE FROM enrollments WHERE student_id = ANY($1) AND faculty_course_id = $2", [[held.student_id, dropped.student_id], classId]);
    await pool.query("DELETE FROM enrolment_approvals WHERE student_id = $1", [held.student_id]);
    await pool.query("DELETE FROM academic_standing WHERE student_id = $1 AND status = 'dropped'", [dropped.student_id]);
    await pool.query("DELETE FROM academic_standing WHERE id = $1", [heldRowId]); // only the row this suite added
    await pool.query("UPDATE students SET academic_status = $2, probation_count = $3 WHERE student_id = $1", [
      heldBefore.student_id, heldBefore.academic_status, heldBefore.probation_count,
    ]);
    await pool.query("UPDATE students SET academic_status = $2, probation_count = $3 WHERE student_id = $1", [
      droppedBefore.student_id, droppedBefore.academic_status, droppedBefore.probation_count,
    ]);
  });

  test("a dropped student can't be enrolled (409 STUDENT_DROPPED)", async () => {
    const res = await enroll(dropped.student_id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("STUDENT_DROPPED");
  });

  test("Probation 2 without an approval -> 409 ENROLMENT_HOLD; the approval unblocks it", async () => {
    const res = await enroll(held.student_id);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "ENROLMENT_HOLD", studentId: held.student_id });
    expect(res.body.error).toMatch(/Principal's prior approval/);

    const bad = await request(app).post(`/api/admin/students/${held.student_id}/enrolment-approval`).set(as(admin)).send({});
    expect(bad.status).toBe(400);
    const ok = await request(app)
      .post(`/api/admin/students/${held.student_id}/enrolment-approval`)
      .set(as(admin))
      .send({ approverRole: "Principal via HoD", note: "Approved for a reduced load" });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ student_id: held.student_id, approver_role: "Principal via HoD" });
    const twice = await request(app).post(`/api/admin/students/${held.student_id}/enrolment-approval`).set(as(admin)).send({ approverRole: "Principal via HoD" });
    expect(twice.status).toBe(409);

    expect((await enroll(held.student_id)).status).toBe(201);
    const audit = await pool.query("SELECT 1 FROM audit_log WHERE action = 'RECORD_ENROLMENT_APPROVAL' AND entity_id = $1", [ok.body.id]);
    expect(audit.rows.length).toBe(1);
    const drawer = await request(app).get(`/api/admin/students/${held.student_id}/standing`).set(as(admin));
    expect(drawer.body).toMatchObject({ status: "probation_2", hold: { active: false, approved: true, approver_role: "Principal via HoD" } });
    expect(drawer.body.approvals.length).toBe(1);
  });

  test("an approval is only for a student on Probation 2", async () => {
    const good = (await pool.query("SELECT student_id FROM students WHERE academic_status = 'good' ORDER BY student_id LIMIT 1")).rows[0];
    const res = await request(app).post(`/api/admin/students/${good.student_id}/enrolment-approval`).set(as(admin)).send({ approverRole: "Principal via HoD" });
    expect(res.status).toBe(409);
  });
});

describe("access", () => {
  test("admin-only routes refuse faculty and students; student routes refuse others", async () => {
    const [fac, stu] = await Promise.all([login(app, "ayesha.khan@smartedu.edu", "faculty"), login(app, "student100040@smartedu.edu", "student")]);
    const adminRoutes = [
      ["post", "/api/admin/semester-close/preview"],
      ["post", "/api/admin/semester-close/confirm"],
      ["get", "/api/admin/semester-closes"],
      ["get", "/api/admin/warning-letters"],
      ["get", "/api/admin/warning-letters/1"],
      ["get", "/api/admin/students/1/standing"],
      ["post", "/api/admin/students/1/enrolment-approval"],
    ];
    for (const [m, p] of adminRoutes) for (const t of [fac, stu]) expect((await request(app)[m](p).set(as(t)).send({})).status).toBe(403);
    for (const [m, p] of [["get", "/api/student/standing"], ["get", "/api/student/warning-letters"], ["put", "/api/student/warning-letters/1/acknowledge"]]) {
      expect((await request(app)[m](p).set(as(fac))).status).toBe(403);
      expect((await request(app)[m](p).set(as(admin))).status).toBe(403);
    }
  });
});
