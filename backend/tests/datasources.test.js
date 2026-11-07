// Synthetic vs live data: the admin dashboard's dataSources panel and the dataSource filter on the
// flagged-students list (and its CSV export). One flagged student is given a live mark for the
// test and put back afterwards.
const request = require("supertest");
const app = require("../src/app");
const { login, pool } = require("./helpers");

const as = (t) => ({ Authorization: `Bearer ${t}` });
let admin, target, saved;

beforeAll(async () => {
  admin = await login(app, "admin@smartedu.edu", "admin");
  // a flagged student with a course result (not a demo account)
  const { rows } = await pool.query(
    `SELECT s.student_id, s.roll_no, cr.result_id, cr.data_source
     FROM students s JOIN predictions p ON p.prediction_id = s.latest_prediction_id
     JOIN enrollments e ON e.student_id = s.student_id AND e.status = 'enrolled'
     JOIN course_results cr ON cr.enrollment_id = e.enrollment_id
     WHERE p.final_label IN ('At-Risk', 'Dropout-Likely')
       AND s.roll_no NOT IN ('BU-100040','BU-106864','BU-122785','BU-112907','BU-144766','BU-101986','BU-115624')
     ORDER BY s.roll_no LIMIT 1`
  );
  target = rows[0];
  saved = (await pool.query("SELECT result_id, data_source FROM course_results cr JOIN enrollments e USING (enrollment_id) WHERE e.student_id = $1", [target.student_id])).rows;
  await pool.query("UPDATE course_results SET data_source = 'synthetic' WHERE result_id = ANY($1)", [saved.map((r) => r.result_id)]);
});

afterAll(async () => {
  for (const r of saved) await pool.query("UPDATE course_results SET data_source = $2 WHERE result_id = $1", [r.result_id, r.data_source]);
  await pool.end();
});

const flagged = (q) => request(app).get("/api/admin/at-risk-students").query({ limit: 100, search: target.roll_no, ...q }).set(as(admin));

test("the dashboard reports synthetic vs live counts", async () => {
  const res = await request(app).get("/api/admin/dashboard").set(as(admin));
  expect(res.status).toBe(200);
  const d = res.body.dataSources;
  for (const k of ["students", "course_results", "attendance", "performance"]) {
    expect(d[k]).toEqual(expect.objectContaining({ synthetic: expect.any(Number), live: expect.any(Number) }));
  }
  expect(d.students.synthetic).toBeGreaterThan(40000);
  expect(d.course_results).toHaveProperty("from_uploads");
  expect(d.uploads).toEqual(expect.objectContaining({ committed: expect.any(Number) }));
  expect(typeof d.students_with_live_data).toBe("number");
});

test("the dataSource filter separates students with live data from synthetic-only ones", async () => {
  // synthetic only for now
  expect((await flagged({ dataSource: "synthetic" })).body.rows.map((r) => r.roll_no)).toContain(target.roll_no);
  expect((await flagged({ dataSource: "live" })).body.rows.map((r) => r.roll_no)).not.toContain(target.roll_no);

  // one live mark makes them a live-data student
  await pool.query("UPDATE course_results SET data_source = 'live' WHERE result_id = $1", [target.result_id]);
  expect((await flagged({ dataSource: "live" })).body.rows.map((r) => r.roll_no)).toContain(target.roll_no);
  expect((await flagged({ dataSource: "synthetic" })).body.rows.map((r) => r.roll_no)).not.toContain(target.roll_no);
  expect((await flagged({})).body.rows.map((r) => r.roll_no)).toContain(target.roll_no); // no filter: both

  // the totals add up
  const [all, live, syn] = await Promise.all(["", "live", "synthetic"].map((ds) => request(app).get("/api/admin/at-risk-students").query(ds ? { dataSource: ds } : {}).set(as(admin))));
  expect(live.body.total + syn.body.total).toBe(all.body.total);

  // the CSV export honours it too
  const csv = await request(app).get("/api/admin/at-risk-students/export").query({ dataSource: "live", search: target.roll_no }).set(as(admin));
  expect(csv.status).toBe(200);
  expect(csv.text).toContain(target.roll_no);
});
