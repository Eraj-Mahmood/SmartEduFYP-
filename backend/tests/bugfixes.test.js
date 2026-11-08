const request = require("supertest");
const app = require("../src/app");
const { login, pool, createTempUser, dropTempUser, takeSnapshot, restoreSnapshot } = require("./helpers");
const chatbot = require("../src/services/chatbot");
const { buildChatContext } = require("../src/services/chatContext");
const { getStudentOverview } = require("../src/services/studentOverview");
const { todayLocal } = require("../src/services/csv");

// Regression tests for the 2026-11 test pass (bugs 2-14). Each block reproduces one bug.
// The admin side runs as a throwaway admin account, so afterAll can remove exactly what it created
// (found through that account's audit entries) without touching anything else - not even rows someone
// creates in the app while the tests run. Classes live in a throwaway course taught by ayesha.khan with
// two students who are in no other class (no demo student is touched).

const as = (t) => ({ Authorization: `Bearer ${t}` });
const TAG = `BF${Date.now().toString().slice(-6)}`;
const since = new Date();
let admin, adminId, fac, facUserId, facultyId;
let courseId, classId, students, snap, enrollmentId; // enrollmentId: students[0] in the throwaway class
const made = { users: [], classes: [], courses: [] };
let tempAdmin;

const enroll = (studentId) => request(app).post("/api/admin/enrollments").set(as(admin)).send({ student_id: studentId, faculty_course_id: classId });
const drop = (id) => request(app).put(`/api/admin/enrollments/${id}/drop`).set(as(admin));
const auditCount = async (action, entityId) =>
  (await pool.query("SELECT COUNT(*)::int AS n FROM audit_log WHERE action = $1 AND entity_id = $2 AND created_at >= $3", [action, entityId, since])).rows[0].n;
const setStatus = (status) => pool.query("UPDATE enrollments SET status = $2 WHERE enrollment_id = $1", [enrollmentId, status]);
const leaksDb = (res) => /invalid input syntax|violates|is not a function|relation |column /i.test(JSON.stringify(res.body));

beforeAll(async () => {
  tempAdmin = await createTempUser("admin");
  adminId = tempAdmin.userId;
  admin = await login(app, tempAdmin.email, "admin");
  fac = await login(app, "ayesha.khan@smartedu.edu", "faculty");
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
  // what the throwaway admin created (also by a request that wrongly succeeded), from its audit entries
  const created = async (action) =>
    (await pool.query("SELECT entity_id FROM audit_log WHERE actor_user_id = $1 AND action = $2", [adminId, action])).rows.map((r) => r.entity_id);
  const courses = [...new Set([...(await created("CREATE_COURSE")), ...made.courses])];
  const classes = [...new Set([...(await created("ASSIGN_FACULTY")), ...made.classes])];
  const users = (
    await pool.query(
      `SELECT user_id FROM students WHERE student_id = ANY($1) UNION SELECT user_id FROM faculty WHERE faculty_id = ANY($2)`,
      [await created("CREATE_STUDENT"), await created("CREATE_FACULTY")]
    )
  ).rows.map((r) => r.user_id);
  // every step runs even if an earlier one fails, so a failed run still leaves nothing behind
  const steps = [
    () => pool.query("DELETE FROM counselor_assignments WHERE student_id = ANY($1) AND assigned_by = $2", [ids, adminId]),
    () => pool.query("DELETE FROM notifications WHERE sender_admin_id = $1", [adminId]),
    () => restoreSnapshot(snap), // predictions made since + latest-prediction pointers
    () => pool.query("DELETE FROM prediction_runs WHERE started_by = $1", [adminId]),
    () => pool.query("DELETE FROM audit_log WHERE actor_user_id = $1 AND action = 'MARK_ATTENDANCE' AND (details->>'facultyCourseId')::int = ANY($2)", [facUserId, classes]),
    // enrollments cascade to marks and attendance
    () => pool.query("DELETE FROM enrollments WHERE faculty_course_id IN (SELECT faculty_course_id FROM faculty_courses WHERE faculty_course_id = ANY($1) OR course_id = ANY($2))", [classes, courses]),
    () => pool.query("DELETE FROM faculty_courses WHERE faculty_course_id = ANY($1) OR course_id = ANY($2)", [classes, courses]),
    () => pool.query("DELETE FROM courses WHERE course_id = ANY($1)", [courses]),
    () => pool.query("DELETE FROM users WHERE user_id = ANY($1)", [[...users, ...made.users]]),
    () => dropTempUser(adminId), // its audit entries, then the account
  ];
  for (const step of steps) await step().catch((e) => console.error("bugfixes cleanup:", e.message));
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

// ------------------------------------------------------------------------------- bug 7
describe("bug 7: non-numeric ids -> 400, never a raw database error", () => {
  test.each([
    ["put", "/api/notifications/abc/read", "student", null],
    ["delete", "/api/admin/faculty-courses/abc", "admin", null],
    ["put", "/api/admin/enrollments/abc/drop", "admin", null],
    ["post", "/api/admin/courses", "admin", { course_code: `${TAG}Q`, title: "x", department_id: "abc" }],
    ["post", "/api/admin/enrollments", "admin", { student_id: "abc", faculty_course_id: 1 }],
    ["post", "/api/admin/enrollments", "admin", { student_id: 1, faculty_course_id: "abc" }],
    ["post", "/api/admin/faculty-courses", "admin", { faculty_id: "abc", course_id: 1, semester: 5, academic_year: "2025-2026" }],
    ["post", "/api/admin/users/student", "admin", { email: `${TAG}.x@smartedu.test`, full_name: "x", roll_no: `${TAG}-X`, department_id: "abc" }],
    ["post", "/api/admin/users/faculty", "admin", { email: `${TAG}.y@smartedu.test`, full_name: "x", employee_no: `${TAG}-Y`, department_id: "abc" }],
  ])("%s %s -> 400", async (method, url, role, body) => {
    const token = role === "student" ? await login(app, "student100040@smartedu.edu", "student") : admin;
    const r = request(app)[method](url).set(as(token));
    const res = body ? await r.send(body) : await r;
    expect(res.status).toBe(400);
    expect(leaksDb(res)).toBe(false);
  });
});

// ------------------------------------------------------------------------------- bug 8
describe("bug 8: create endpoints validate against the column sizes", () => {
  const student = (over) => ({ email: `${TAG.toLowerCase()}.v@smartedu.test`, full_name: "Valid Name", roll_no: `${TAG}-V`, department_id: 1, gender: "Male", age: 21, ...over });
  test.each([
    ["email 123", { email: 123 }],
    ["email not-an-email", { email: "not-an-email" }],
    ["email over 150", { email: `${"a".repeat(140)}@smartedu.test` }],
    ["empty full_name", { full_name: "" }],
    ["full_name over 150", { full_name: "x".repeat(151) }],
    ["roll_no with a space", { roll_no: "BU 1" }],
    ["roll_no too short", { roll_no: "B1" }],
    ["roll_no over 30", { roll_no: "B".repeat(31) }],
    ["age -3", { age: -3 }],
    ["age 81", { age: 81 }],
    ["semester 13", { current_semester: 13 }],
    ["gender Other", { gender: "Other" }],
  ])("student: %s -> 400", async (_, over) => {
    const res = await request(app).post("/api/admin/users/student").set(as(admin)).send(student(over));
    expect(res.status).toBe(400);
    expect(leaksDb(res)).toBe(false);
  });

  test.each([
    ["credit_hours -4", { credit_hours: -4 }],
    ["credit_hours 7", { credit_hours: 7 }],
    ["course_code over 20", { course_code: "C".repeat(21) }],
    ["course_code 1 char", { course_code: "C" }],
  ])("course: %s -> 400", async (_, over) => {
    const res = await request(app).post("/api/admin/courses").set(as(admin)).send({ course_code: `${TAG}C`, title: "x", department_id: 1, ...over });
    expect(res.status).toBe(400);
  });

  test("faculty: employee_no over 30 -> 400", async () => {
    const res = await request(app)
      .post("/api/admin/users/faculty")
      .set(as(admin))
      .send({ email: `${TAG.toLowerCase()}.w@smartedu.test`, full_name: "x", employee_no: "E".repeat(31), department_id: 1 });
    expect(res.status).toBe(400);
  });

  test("what the admin forms send still passes (optional gender/age left out, email upper-case trimmed)", async () => {
    const s = await request(app).post("/api/admin/users/student").set(as(admin)).send({ email: ` ${TAG}.Form@SmartEdu.test `, full_name: "Form Student", roll_no: `${TAG}-F1`, department_id: 2 });
    expect(s.status).toBe(201);
    made.users.push(s.body.student.user_id);
    expect((await pool.query("SELECT email FROM users WHERE user_id = $1", [s.body.student.user_id])).rows[0].email).toBe(`${TAG.toLowerCase()}.form@smartedu.test`);
    const f = await request(app).post("/api/admin/users/faculty").set(as(admin)).send({ email: `${TAG}.ff@smartedu.test`, full_name: "Form Faculty", employee_no: `${TAG}-E1`, department_id: 2, designation: "Lecturer" });
    expect(f.status).toBe(201);
    made.users.push(f.body.faculty.user_id);
    const c = await request(app).post("/api/admin/courses").set(as(admin)).send({ course_code: `${TAG}F`, title: "Form course", department_id: 2 });
    expect(c.status).toBe(201);
    expect(c.body.credit_hours).toBe(3);
    made.courses.push(c.body.course_id);
  });
});
