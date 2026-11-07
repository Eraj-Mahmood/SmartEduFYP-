// Admin live-cohort import (Objective 7): creates live students with their performance row in a
// live class section; preview writes nothing; only admins. Everything is removed afterwards.
const request = require("supertest");
const app = require("../src/app");
const { removeCohort } = require("../src/services/liveCohort");
const { login, pool } = require("./helpers");

const as = (t) => ({ Authorization: `Bearer ${t}` });
const TAG = `JEST${Date.now().toString().slice(-6)}`;
const SECTION = `J${TAG.slice(-5)}`;
let admin, faculty, courseId, facultyId;
const created = [];

const HEADER = "roll_no,full_name,department,semester,cgpa,previous_sgpa,attendance,assignment,quiz,midterm,final,failed_courses,credits,actual_outcome,gender";
const csv = (rows) => [HEADER, ...rows].join("\r\n");
const GOOD = [
  `${TAG}-1,Jest Live One,CS,5,1.4,1.5,58,50,48,45,47,3,18,dropout,female`,
  `${TAG}-2,Jest Live Two,AI,3,3.1,3.0,92,85,80,82,84,0,15,safe,`,
  `${TAG}-3,Jest Live Three,EE,4,2.2,2.3,80,,65,60,62,1,18,,male`, // empty assignment mark, no outcome
];

beforeAll(async () => {
  [admin, faculty] = await Promise.all([login(app, "admin@smartedu.edu", "admin"), login(app, "amina.sheikh@smartedu.edu", "faculty")]);
  const { rows } = await pool.query(
    `SELECT fc.course_id, fc.faculty_id FROM faculty_courses fc JOIN faculty f USING (faculty_id) JOIN users u ON u.user_id = f.user_id
     WHERE u.email = 'amina.sheikh@smartedu.edu' LIMIT 1`
  );
  ({ course_id: courseId, faculty_id: facultyId } = rows[0]);
});

afterAll(async () => {
  for (const id of created) await removeCohort(id).catch(() => {});
  await pool.query("DELETE FROM uploads WHERE kind = 'cohort' AND filename = 'jest_cohort.csv'");
  await pool.query("DELETE FROM audit_log WHERE action IN ('IMPORT_LIVE_COHORT', 'REMOVE_LIVE_COHORT') AND details->>'filename' = 'jest_cohort.csv'");
  await pool.end();
});

const send = (t, mode, body, fields = { courseId, facultyId, section: SECTION }) => {
  let req = request(app).post(`/api/admin/live-cohort?mode=${mode}`).set(as(t));
  for (const [k, v] of Object.entries(fields)) req = req.field(k, String(v));
  return req.attach("file", Buffer.from(body), { filename: "jest_cohort.csv", contentType: "text/csv" });
};
const liveCount = async () => (await pool.query("SELECT COUNT(*)::int AS n FROM students WHERE roll_no LIKE $1", [`${TAG}-%`])).rows[0].n;

test("template lists the required and optional columns", async () => {
  const res = await request(app).get("/api/admin/live-cohort/template.csv").set(as(admin));
  expect(res.status).toBe(200);
  expect(res.text.replace(/^﻿/, "").trim().split(",")).toEqual(expect.arrayContaining(["roll_no", "cgpa", "actual_outcome", "gender"]));
});

test("only admins can import", async () => {
  expect((await send(faculty, "preview", csv(GOOD))).status).toBe(403);
  expect((await request(app).get("/api/admin/live-cohort/template.csv").set(as(faculty))).status).toBe(403);
});

test("preview validates every row, lists missing features and writes nothing", async () => {
  const bad = [...GOOD, `BU-100040,Existing,CS,5,2,2,80,70,70,70,70,0,15,safe,`, `${TAG}-9,Bad Dept,XX,5,2,2,80,70,70,70,70,0,15,maybe,`];
  const res = await send(admin, "preview", csv(bad));
  expect(res.status).toBe(200);
  expect(res.body.summary).toMatchObject({ rows_total: 5, rows_ok: 3, rows_failed: 2 });
  const cols = res.body.errors.map((e) => `${e.row}:${e.column}`);
  expect(cols).toEqual(expect.arrayContaining(["5:roll_no", "6:department", "6:actual_outcome"]));
  const missing = Object.fromEntries(res.body.missing_features.map((m) => [m.feature, m.students]));
  expect(missing).toMatchObject({ Age: 3, Study_Hours_Per_Week: 3, Assignment_Submission_Rate: 3, Gender: 1, Assignment_Avg: 1 });
  expect(res.body.with_outcome).toBe(2);
  expect(res.body.upload.status).toBe("previewed");
  expect(await liveCount()).toBe(0);
  expect((await send(admin, "preview", csv(GOOD), {})).status).toBe(400); // no class chosen
});

test("commit creates live students, their performance rows and the live class", async () => {
  const res = await send(admin, "commit", csv(GOOD));
  expect(res.status).toBe(200);
  created.push(res.body.upload.id);
  expect(res.body.upload.status).toBe("committed");
  expect(res.body.class).toMatchObject({ section: SECTION, created: true });
  const { rows } = await pool.query(
    `SELECT s.roll_no, s.data_source, s.actual_outcome, s.gender, u.must_reset_pw, sp.data_source AS perf_source,
            sp.upload_id, sp.cgpa, sp.sgpa, sp.assignment_avg, sp.credits_passed, sp.target_label, e.faculty_course_id
     FROM students s JOIN users u USING (user_id)
     JOIN student_semester_performance sp ON sp.student_id = s.student_id
     JOIN enrollments e ON e.student_id = s.student_id
     WHERE s.roll_no LIKE $1 ORDER BY s.roll_no`,
    [`${TAG}-%`]
  );
  expect(rows).toHaveLength(3);
  for (const r of rows) {
    expect(r).toMatchObject({ data_source: "live", perf_source: "live", upload_id: res.body.upload.id, target_label: null, must_reset_pw: true });
    expect(r.faculty_course_id).toBe(res.body.class.faculty_course_id);
  }
  expect(rows[0]).toMatchObject({ actual_outcome: "dropout", gender: "Female", sgpa: "1.30", credits_passed: 9 }); // 2 x 1.4 - 1.5; 18 - 3 x 3
  expect(rows[1].gender).toBeNull(); // empty -> imputed later
  expect(rows[2]).toMatchObject({ actual_outcome: null, assignment_avg: null });

  // the same file again: every roll number now exists
  const again = await send(admin, "commit", csv(GOOD));
  expect(again.body.upload.status).toBe("failed");
  expect(again.body.errors.every((e) => /already exists/.test(e.message))).toBe(true);

  // they count as live data on the admin dashboard
  const dash = await request(app).get("/api/admin/dashboard").set(as(admin));
  expect(dash.body.dataSources.students.live).toBeGreaterThanOrEqual(3);
  const audit = await pool.query("SELECT 1 FROM audit_log WHERE action = 'IMPORT_LIVE_COHORT' AND entity_id = $1", [res.body.upload.id]);
  expect(audit.rows).toHaveLength(1);
});

test("missing values never fire a policy rule or produce a reason sentence", () => {
  const { applyPolicy } = require("../src/services/policy");
  const { toReasons } = require("../src/services/reasons");
  const f = { CGPA: null, Previous_SGPA: null, Attendance_Percentage: null, Failed_Courses: 0, Assignment_Submission_Rate: null };
  expect(applyPolicy(f, "Safe")).toMatchObject({ policyLabel: "Safe", finalLabel: "Safe", reason: null });
  expect(applyPolicy({ ...f, CGPA: 1.5, Previous_SGPA: 1.6 }, "Safe").policyLabel).toBe("Dropout-Likely");
  const drivers = [
    { feature: "Assignment_Submission_Rate", value: null, direction: "raises_risk" },
    { feature: "CGPA", value: 2.1, direction: "raises_risk" },
  ];
  const reasons = toReasons(drivers, { ...f, CGPA: 2.1 }, "At-Risk");
  expect(reasons.join(" ")).not.toMatch(/null|NaN/);
  expect(reasons[0]).toMatch(/2\.10/);
});

test("removeCohort deletes the students and the class it created", async () => {
  const id = created.pop();
  const out = await removeCohort(id);
  expect(out).toEqual({ students: 3, class_removed: true });
  expect(await liveCount()).toBe(0);
  const fc = await pool.query("SELECT 1 FROM faculty_courses WHERE section = $1", [SECTION]);
  expect(fc.rows).toHaveLength(0);
});

test("a live student's imported term marks show as their course marks (not 'no marks yet')", async () => {
  const res = await send(admin, "commit", csv(GOOD));
  expect(res.status).toBe(200);
  created.push(res.body.upload.id);
  const { getCourseSummary } = require("../src/services/studentCourses");
  const sid = async (roll) => (await pool.query("SELECT student_id FROM students WHERE roll_no = $1", [roll])).rows[0].student_id;
  // all four marks in the file: shown, flagged as imported, grade derived (85,80,82,84 -> mean 82.75, B)
  const two = await getCourseSummary(await sid(`${TAG}-2`));
  expect(two.termMarksImported).toBe(true);
  expect(two.courses[0]).toMatchObject({ marks_source: "imported", assignment_avg: 85, final_marks: 84, mean: 82.75, grade: "B" });
  expect(two.weakest.course_code).toBe(two.courses[0].course_code);
  // a mark missing in the file: nothing is invented (a missing component would count as 0)
  const three = await getCourseSummary(await sid(`${TAG}-3`));
  expect(three.termMarksImported).toBe(false);
  expect(three.courses[0]).toMatchObject({ mean: null, marks_source: null });
  // a synthetic student with entered marks is unchanged
  const demo = await getCourseSummary(await sid("BU-100040"));
  expect(demo.termMarksImported).toBe(false);
  expect(demo.courses.every((c) => c.marks_source === "entered")).toBe(true);
});

test("removeLiveCohort.js writes a REMOVE_LIVE_COHORT audit entry", () => {
  const id = created.pop();
  const { execFileSync } = require("child_process");
  const out = execFileSync(process.execPath, ["src/scripts/removeLiveCohort.js", String(id), "--actor", "admin@smartedu.edu"], {
    cwd: require("path").join(__dirname, ".."),
    encoding: "utf8",
  });
  expect(out).toMatch(new RegExp(`Removed cohort #${id}: 3 students`));
  return pool
    .query(
      `SELECT a.actor_user_id, a.details, u.email FROM audit_log a LEFT JOIN users u ON u.user_id = a.actor_user_id
       WHERE a.action = 'REMOVE_LIVE_COHORT' AND a.entity = 'uploads' AND a.entity_id = $1`,
      [id]
    )
    .then(async ({ rows }) => {
      expect(rows).toHaveLength(1);
      expect(rows[0].email).toBe("admin@smartedu.edu");
      expect(rows[0].details).toMatchObject({ filename: "jest_cohort.csv", students: 3, class_removed: true, via: "removeLiveCohort.js" });
      expect(await liveCount()).toBe(0);
    });
});
