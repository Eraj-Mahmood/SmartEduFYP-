const request = require("supertest");
const app = require("../src/app");
const { login, pool, createTempUser, dropTempUser, takeSnapshot, restoreSnapshot } = require("./helpers");
const chatbot = require("../src/services/chatbot");
const { buildChatContext } = require("../src/services/chatContext");
const { getStudentOverview } = require("../src/services/studentOverview");
const { todayLocal } = require("../src/services/csv");

// Regression tests for the 2026-11 test pass (bugs 2-14). Each block reproduces one bug.
// Everything is created in a throwaway course/class taught by ayesha.khan with two students who
// are in no other class (no demo student is touched), and removed again in afterAll.

const as = (t) => ({ Authorization: `Bearer ${t}` });
const TAG = `BF${Date.now().toString().slice(-6)}`;
const since = new Date();
let admin, adminId, fac, facUserId, facultyId;
let courseId, classId, students, snap, enrollmentId; // enrollmentId: students[0] in the throwaway class
const made = { users: [], classes: [], courses: [] };
let maxIds; // ids before the run: anything above them was created here (also by a request that wrongly succeeded)

const enroll = (studentId) => request(app).post("/api/admin/enrollments").set(as(admin)).send({ student_id: studentId, faculty_course_id: classId });
const drop = (id) => request(app).put(`/api/admin/enrollments/${id}/drop`).set(as(admin));
const auditCount = async (action, entityId) =>
  (await pool.query("SELECT COUNT(*)::int AS n FROM audit_log WHERE action = $1 AND entity_id = $2 AND created_at >= $3", [action, entityId, since])).rows[0].n;
const setStatus = (status) => pool.query("UPDATE enrollments SET status = $2 WHERE enrollment_id = $1", [enrollmentId, status]);
const leaksDb = (res) => /invalid input syntax|violates|is not a function|relation |column /i.test(JSON.stringify(res.body));

beforeAll(async () => {
  admin = await login(app, "admin@smartedu.edu", "admin");
  fac = await login(app, "ayesha.khan@smartedu.edu", "faculty");
  adminId = (await pool.query("SELECT user_id FROM users WHERE email = 'admin@smartedu.edu'")).rows[0].user_id;
  ({ user_id: facUserId, faculty_id: facultyId } = (
    await pool.query("SELECT u.user_id, f.faculty_id FROM faculty f JOIN users u USING (user_id) WHERE u.email = 'ayesha.khan@smartedu.edu'")
  ).rows[0]);
  // two imported students with no enrollment and no counselor (never the demo students)
  students = (
    await pool.query(
      `SELECT s.student_id, s.user_id, s.roll_no FROM students s
       WHERE s.data_source = 'synthetic' AND s.roll_no LIKE 'BU-1%'
         AND NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = s.student_id)
         AND NOT EXISTS (SELECT 1 FROM counselor_assignments ca WHERE ca.student_id = s.student_id)
       ORDER BY s.student_id DESC LIMIT 2`
    )
  ).rows;
  snap = await takeSnapshot({ studentIds: students.map((s) => s.student_id) });
  maxIds = (await pool.query("SELECT (SELECT MAX(user_id) FROM users) AS users, (SELECT MAX(course_id) FROM courses) AS courses")).rows[0];
  const c = await request(app).post("/api/admin/courses").set(as(admin)).send({ course_code: TAG, title: "Bugfix course", department_id: 4, credit_hours: 3 });
  courseId = c.body.course_id;
  made.courses.push(courseId);
  const fc = await request(app)
    .post("/api/admin/faculty-courses")
    .set(as(admin))
    .send({ faculty_id: facultyId, course_id: courseId, section: "Z", semester: 5, academic_year: "2025-2026" });
  classId = fc.body.faculty_course_id;
  made.classes.push(classId);
  enrollmentId = (
    await pool.query("INSERT INTO enrollments (student_id, faculty_course_id) VALUES ($1, $2) RETURNING enrollment_id", [students[0].student_id, classId])
  ).rows[0].enrollment_id;
});

afterAll(async () => {
  const ids = students.map((s) => s.student_id);
  const userIds = students.map((s) => s.user_id);
  await pool.query("DELETE FROM counselor_assignments WHERE student_id = ANY($1) AND created_at >= $2", [ids, since]);
  await pool.query("DELETE FROM notifications WHERE sent_at >= $1 AND recipient_user_id = ANY($2)", [since, [...userIds, facUserId]]);
  await restoreSnapshot(snap); // predictions made since + latest-prediction pointers
  await pool.query("DELETE FROM prediction_runs WHERE started_at >= $1 AND scope = 'class' AND scope_id = ANY($2)", [since, made.classes]);
  await pool.query("DELETE FROM enrollments WHERE faculty_course_id = ANY($1)", [made.classes]); // cascades marks + attendance
  await pool.query("DELETE FROM faculty_courses WHERE faculty_course_id = ANY($1)", [made.classes]);
  await pool.query("DELETE FROM courses WHERE course_id = ANY($1)", [made.courses]);
  for (const u of made.users) await dropTempUser(u);
  await pool.query("DELETE FROM users WHERE user_id > $1", [maxIds.users]);
  await pool.query("DELETE FROM courses WHERE course_id > $1", [maxIds.courses]);
  await pool.query("DELETE FROM audit_log WHERE created_at >= $1 AND actor_user_id = ANY($2)", [since, [adminId, facUserId]]);
  await pool.end();
});

// ------------------------------------------------------------------------------- bug 2
describe("bug 2: deleting a class never wipes marks or attendance", () => {
  test("unknown class -> 404 and no audit entry", async () => {
    const res = await request(app).delete("/api/admin/faculty-courses/99999999").set(as(admin));
    expect(res.status).toBe(404);
    expect(await auditCount("UNASSIGN_FACULTY", 99999999)).toBe(0);
  });

  test("a class with an enrolled or dropped student -> 409, nothing deleted", async () => {
    const tmp = await request(app)
      .post("/api/admin/faculty-courses")
      .set(as(admin))
      .send({ faculty_id: facultyId, course_id: courseId, section: "Y", semester: 5, academic_year: "2025-2026" });
    const tmpId = tmp.body.faculty_course_id;
    made.classes.push(tmpId);
    const en = await request(app).post("/api/admin/enrollments").set(as(admin)).send({ student_id: students[1].student_id, faculty_course_id: tmpId });
    await pool.query("INSERT INTO course_results (enrollment_id, assignment_avg, grade) VALUES ($1, 80, 'B')", [en.body.enrollment_id]);

    const enrolled = await request(app).delete(`/api/admin/faculty-courses/${tmpId}`).set(as(admin));
    expect(enrolled.status).toBe(409);
    expect(enrolled.body.error).toMatch(/1 student/);
    await drop(en.body.enrollment_id);
    const dropped = await request(app).delete(`/api/admin/faculty-courses/${tmpId}`).set(as(admin));
    expect(dropped.status).toBe(409);
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM course_results WHERE enrollment_id = $1", [en.body.enrollment_id])).rows[0].n).toBe(1);
    expect(await auditCount("UNASSIGN_FACULTY", tmpId)).toBe(0);
  });

  test("an empty class is deleted (200, audit-logged)", async () => {
    const tmp = await request(app)
      .post("/api/admin/faculty-courses")
      .set(as(admin))
      .send({ faculty_id: facultyId, course_id: courseId, section: "X", semester: 5, academic_year: "2025-2026" });
    const res = await request(app).delete(`/api/admin/faculty-courses/${tmp.body.faculty_course_id}`).set(as(admin));
    expect(res.status).toBe(200);
    expect((await pool.query("SELECT 1 FROM faculty_courses WHERE faculty_course_id = $1", [tmp.body.faculty_course_id])).rows).toHaveLength(0);
    expect(await auditCount("UNASSIGN_FACULTY", tmp.body.faculty_course_id)).toBe(1);
  });
});

// ------------------------------------------------------------------------------- bug 3
describe("bug 3: manual attendance refuses future dates", () => {
  test("tomorrow or 2030 -> 400 and nothing written; today is fine", async () => {
    await setStatus("enrolled");
    const mark = (classDate) => request(app).post("/api/faculty/attendance").set(as(fac)).send({ facultyCourseId: classId, classDate, entries: [{ enrollmentId, status: "present" }] });
    const tomorrow = todayLocal(new Date(Date.now() + 86400000));
    const bad = await mark(tomorrow);
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(new RegExp(`classDate ${tomorrow} is in the future`));
    expect((await mark("2030-01-01")).status).toBe(400);
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM attendance WHERE enrollment_id = $1 AND class_date > $2", [enrollmentId, todayLocal()])).rows[0].n).toBe(0);
    expect((await mark(todayLocal())).status).toBe(200);
  });
});

// ------------------------------------------------------------------------------- bug 4
describe("bug 4: marks can't be edited for a dropped enrollment", () => {
  test("PUT /faculty/results -> 400 and nothing saved", async () => {
    await setStatus("dropped");
    await pool.query("DELETE FROM course_results WHERE enrollment_id = $1", [enrollmentId]);
    const res = await request(app).put(`/api/faculty/results/${enrollmentId}`).set(as(fac)).send({ assignment_avg: 90 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("This student has dropped this course");
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM course_results WHERE enrollment_id = $1", [enrollmentId])).rows[0].n).toBe(0);
    await setStatus("enrolled");
  });
});

// ------------------------------------------------------------------------------- bug 5
describe("bug 5: a dropped student can be re-enrolled", () => {
  test("201 with the same row, marks and attendance kept; enrolled again -> 409", async () => {
    await setStatus("dropped");
    await pool.query(
      `INSERT INTO course_results (enrollment_id, assignment_avg, grade) VALUES ($1, 77, 'B')
       ON CONFLICT (enrollment_id) DO UPDATE SET assignment_avg = 77, grade = 'B'`,
      [enrollmentId]
    );
    await pool.query("INSERT INTO attendance (enrollment_id, class_date, status) VALUES ($1, '2026-09-01', 'present') ON CONFLICT DO NOTHING", [enrollmentId]);
    const res = await enroll(students[0].student_id);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ enrollment_id: enrollmentId, status: "enrolled" });
    expect((await pool.query("SELECT assignment_avg FROM course_results WHERE enrollment_id = $1", [enrollmentId])).rows[0].assignment_avg).toBe("77.00");
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM attendance WHERE enrollment_id = $1 AND class_date = '2026-09-01'", [enrollmentId])).rows[0].n).toBe(1);
    const again = await enroll(students[0].student_id);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already enrolled/);
  });
});

// ------------------------------------------------------------------------------- bug 6
describe("bug 6: logout revokes the token", () => {
  test("after logout the old token gets 401 TOKEN_REVOKED; a new sign-in works", async () => {
    const u = await createTempUser("student");
    made.users.push(u.userId);
    const signIn = async () => (await request(app).post("/api/auth/login").send({ email: u.email, password: u.password, portal: "student" })).body.token;
    const token = await signIn();
    expect((await request(app).get("/api/auth/me").set(as(token))).status).toBe(200);
    expect((await request(app).post("/api/auth/logout").set(as(token))).status).toBe(200);
    const after = await request(app).get("/api/auth/me").set(as(token));
    expect(after.status).toBe(401);
    expect(after.body.code).toBe("TOKEN_REVOKED");
    await new Promise((r) => setTimeout(r, 5));
    const fresh = await signIn();
    expect((await request(app).get("/api/auth/me").set(as(fresh))).status).toBe(200);
  });
});
