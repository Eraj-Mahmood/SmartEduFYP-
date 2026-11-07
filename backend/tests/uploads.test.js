// Faculty bulk uploads (FR13): templates, ownership, row validation (each error type), preview
// writes nothing, commit tags data_source='live' and re-predicts. Uses class 4 (CS401 A,
// bilal.raza; no demo students). Every row it touches is restored afterwards. ML is mocked.
const request = require("supertest");
const app = require("../src/app");
const { validateResults, validateAttendance } = require("../src/services/uploads");
const { parseCsv } = require("../src/services/csv");
const { login, pool } = require("./helpers");

const CLASS = 4;
const OWNER = "bilal.raza@smartedu.edu";
const OTHER = "amina.sheikh@smartedu.edu";
const as = (t) => ({ Authorization: `Bearer ${t}` });

let owner, other, roster, snap, warn;
const realFetch = global.fetch;

beforeAll(async () => {
  [owner, other] = await Promise.all([login(app, OWNER, "faculty"), login(app, OTHER, "faculty")]);
  const enr = (
    await pool.query(
      `SELECT e.enrollment_id, e.student_id, s.roll_no, s.full_name FROM enrollments e JOIN students s USING (student_id)
       WHERE e.faculty_course_id = $1 AND e.status = 'enrolled' ORDER BY s.roll_no`,
      [CLASS]
    )
  ).rows;
  roster = enr;
  const eids = enr.map((e) => e.enrollment_id);
  const sids = enr.map((e) => e.student_id);
  snap = {
    at: (await pool.query("SELECT NOW() AS t")).rows[0].t,
    eids, sids,
    results: (await pool.query("SELECT * FROM course_results WHERE enrollment_id = ANY($1)", [eids])).rows,
    attendance: (await pool.query("SELECT * FROM attendance WHERE enrollment_id = ANY($1)", [eids])).rows,
    pointers: (await pool.query("SELECT student_id, latest_prediction_id FROM students WHERE student_id = ANY($1)", [sids])).rows,
    maxUpload: (await pool.query("SELECT COALESCE(MAX(id), 0) AS m FROM uploads")).rows[0].m,
  };
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  // ML mocked: every student comes back Dropout-Likely, so labels change on commit
  global.fetch = jest.fn(async (url, init) => {
    const body = JSON.parse(init.body);
    const r = { label: "Dropout-Likely", prob_safe: 0.05, prob_at_risk: 0.05, prob_dropout: 0.9, model_version: "mocked_v1", explanations: [], base_value: 0.3 };
    return { ok: true, json: async () => (String(url).endsWith("/batch") ? { results: body.rows.map(() => r) } : r) };
  });
});

afterAll(async () => {
  global.fetch = realFetch;
  warn.mockRestore();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    for (const p of snap.pointers) await c.query("UPDATE students SET latest_prediction_id = $2 WHERE student_id = $1", [p.student_id, p.latest_prediction_id]);
    await c.query("DELETE FROM predictions WHERE student_id = ANY($1) AND created_at >= $2", [snap.sids, snap.at]);
    await c.query("DELETE FROM attendance WHERE enrollment_id = ANY($1)", [snap.eids]);
    for (const r of snap.attendance) {
      await c.query(
        "INSERT INTO attendance (attendance_id, enrollment_id, class_date, status, marked_by, marked_at, data_source, upload_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [r.attendance_id, r.enrollment_id, r.class_date, r.status, r.marked_by, r.marked_at, r.data_source, r.upload_id]
      );
    }
    await c.query("DELETE FROM course_results WHERE enrollment_id = ANY($1)", [snap.eids]);
    for (const r of snap.results) {
      await c.query(
        `INSERT INTO course_results (result_id, enrollment_id, assignment_avg, quiz_avg, midterm_marks, final_marks, grade, updated_by, updated_at, data_source, upload_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [r.result_id, r.enrollment_id, r.assignment_avg, r.quiz_avg, r.midterm_marks, r.final_marks, r.grade, r.updated_by, r.updated_at, r.data_source, r.upload_id]
      );
    }
    const up = await c.query("DELETE FROM uploads WHERE id > $1 RETURNING id", [snap.maxUpload]);
    await c.query("DELETE FROM audit_log WHERE entity = 'uploads' AND entity_id = ANY($1)", [up.rows.map((r) => r.id)]);
    await c.query("COMMIT");
  } finally {
    c.release();
  }
  await pool.end();
});

const send = (t, kind, mode, csv, name = "file.csv", classId = CLASS) =>
  request(app)
    .post(`/api/faculty/classes/${classId}/upload?kind=${kind}&mode=${mode}`)
    .set(as(t))
    .attach("file", Buffer.from(csv), { filename: name, contentType: "text/csv" });

const resultsCsv = (rows) => ["roll_no,name,assignment_avg,quiz_avg,midterm_marks,final_marks", ...rows.map((r) => r.join(","))].join("\r\n");
const attendanceCsv = (rows) => ["roll_no,name,class_date,status", ...rows.map((r) => r.join(","))].join("\r\n");
const dataRows = async () => {
  const { rows } = await pool.query(
    `SELECT (SELECT COUNT(*)::int FROM course_results WHERE enrollment_id = ANY($1) AND data_source = 'live') AS live_results,
            (SELECT COUNT(*)::int FROM attendance WHERE enrollment_id = ANY($1)) AS attendance,
            (SELECT COUNT(*)::int FROM predictions WHERE student_id = ANY($2)) AS predictions`,
    [snap.eids, snap.sids]
  );
  return rows[0];
};

describe("templates", () => {
  test("results and attendance templates list the roster with empty values", async () => {
    const res = await request(app).get(`/api/faculty/classes/${CLASS}/templates/results.csv`).set(as(owner));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    const lines = res.text.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("roll_no,name,assignment_avg,quiz_avg,midterm_marks,final_marks");
    expect(lines).toHaveLength(roster.length + 1);
    expect(lines[1]).toBe(`${roster[0].roll_no},${roster[0].full_name},,,,`);
    const att = await request(app).get(`/api/faculty/classes/${CLASS}/templates/attendance.csv`).set(as(owner));
    expect(att.text.replace(/^﻿/, "").split("\r\n")[0]).toBe("roll_no,name,class_date,status");
    expect((await request(app).get(`/api/faculty/classes/${CLASS}/templates/other.csv`).set(as(owner))).status).toBe(404);
  });
});

describe("ownership and file checks", () => {
  test("another faculty member's class gives 403 and writes nothing", async () => {
    const before = await dataRows();
    const csv = resultsCsv([[roster[0].roll_no, "", 90, 90, 90, 90]]);
    expect((await send(other, "results", "commit", csv)).status).toBe(403);
    expect((await request(app).get(`/api/faculty/classes/${CLASS}/templates/results.csv`).set(as(other))).status).toBe(403);
    expect(await dataRows()).toEqual(before);
  });

  test("only .csv, the expected columns, at most 2,000 rows and 2 MB", async () => {
    expect((await send(owner, "results", "preview", "x", "marks.xlsx")).status).toBe(400);
    const missing = await send(owner, "results", "preview", "roll_no,quiz_avg\r\nBU-1,50");
    expect(missing.status).toBe(400);
    expect(missing.body.missing).toEqual(["assignment_avg", "midterm_marks", "final_marks"]);
    const many = resultsCsv(Array.from({ length: 2001 }, () => [roster[0].roll_no, "", 1, 1, 1, 1]));
    expect((await send(owner, "results", "preview", many)).body.error).toMatch(/limit is 2000/);
    const big = "roll_no,name,assignment_avg,quiz_avg,midterm_marks,final_marks\r\n" + "x".repeat(2 * 1024 * 1024 + 10);
    expect((await send(owner, "results", "preview", big)).body.error).toMatch(/larger than 2 MB/);
    expect((await send(owner, "grades", "preview", resultsCsv([]))).status).toBe(400);
    expect((await request(app).post(`/api/faculty/classes/${CLASS}/upload?kind=results&mode=preview`).set(as(owner))).status).toBe(400);
  });
});

describe("row validation", () => {
  const byRoll = () => new Map(roster.map((r) => [r.roll_no, { ...r, status: "enrolled" }]));
  const parse = (csv) => parseCsv(Buffer.from(csv)).records;

  test("results: each error type is reported with row, column and message", () => {
    const dropped = new Map(byRoll());
    dropped.set("BU-DROP1", { enrollment_id: -1, student_id: -1, roll_no: "BU-DROP1", full_name: "Dropped", status: "dropped" });
    const rows = validateResults(
      parse(resultsCsv([
        [roster[0].roll_no, "", 80, 81, 82, 83], // row 2 ok
        [roster[1].roll_no, "", "abc", 70, 70, 70], // row 3 not a number
        [roster[2].roll_no, "", 70, 150, 70, 70], // row 4 out of range
        ["BU-999999", "", 70, 70, 70, 70], // row 5 not in class
        ["BU-DROP1", "", 70, 70, 70, 70], // row 6 dropped
        [roster[0].roll_no, "", 60, 60, 60, 60], // row 7 duplicate
        ["", "", 70, 70, 70, 70], // row 8 empty roll
        [roster[3].roll_no, "", "", "", "", ""], // row 9 blank template row -> skipped
        [roster[4].roll_no, "", 90, "", "", ""], // row 10 ok: empty cells keep saved marks
      ])),
      dropped
    );
    const err = (row) => rows.find((r) => r.row === row).errors;
    expect(err(2)).toEqual([]);
    expect(err(3)).toEqual([{ column: "assignment_avg", message: expect.stringMatching(/number from 0 to 100/) }]);
    expect(err(4)).toEqual([{ column: "quiz_avg", message: expect.stringMatching(/got "150"/) }]);
    expect(err(5)).toEqual([{ column: "roll_no", message: "BU-999999 is not enrolled in this class" }]);
    expect(err(6)).toEqual([{ column: "roll_no", message: "BU-DROP1 has dropped this course" }]);
    expect(err(7)).toEqual([{ column: "roll_no", message: expect.stringMatching(/appears twice .* row 2/) }]);
    expect(err(8)).toEqual([{ column: "roll_no", message: "Roll number is empty" }]);
    expect(rows.find((r) => r.row === 9).skipped).toBe(true);
    expect(err(10)).toEqual([]);
    expect(rows.find((r) => r.row === 10).values).toEqual({ assignment_avg: 90, quiz_avg: null, midterm_marks: null, final_marks: null });
  });

  test("attendance: invalid date, future date, bad status, duplicate (roll, date)", () => {
    const today = "2026-11-07";
    const rows = validateAttendance(
      parse(attendanceCsv([
        [roster[0].roll_no, "", "2026-11-02", "present"], // 2 ok
        [roster[1].roll_no, "", "2026-02-30", "absent"], // 3 not a real date
        [roster[2].roll_no, "", "07/11/2026", "absent"], // 4 wrong format
        [roster[3].roll_no, "", "2026-11-08", "present"], // 5 future
        [roster[4].roll_no, "", "2026-11-02", "late"], // 6 not in the enum
        [roster[0].roll_no, "", "2026-11-02", "absent"], // 7 duplicate of row 2
        [roster[5].roll_no, "", "2026-11-02", ""], // 8 blank status -> skipped
        [roster[6].roll_no, "", "2026-11-02", " Leave "], // 9 ok (trimmed, any case)
      ])),
      byRoll(),
      today
    );
    const err = (row) => rows.find((r) => r.row === row).errors;
    expect(err(2)).toEqual([]);
    expect(err(3)).toEqual([{ column: "class_date", message: expect.stringMatching(/real date/) }]);
    expect(err(4)).toEqual([{ column: "class_date", message: expect.stringMatching(/YYYY-MM-DD/) }]);
    expect(err(5)).toEqual([{ column: "class_date", message: "class_date 2026-11-08 is in the future" }]);
    expect(err(6)).toEqual([{ column: "status", message: expect.stringMatching(/present, absent or leave/) }]);
    expect(err(7)).toEqual([{ column: "class_date", message: expect.stringMatching(/already has a row for 2026-11-02/) }]);
    expect(rows.find((r) => r.row === 8).skipped).toBe(true);
    expect(err(9)).toEqual([]);
    expect(rows.find((r) => r.row === 9).values.status).toBe("leave");
  });
});

describe("preview and commit", () => {
  const csv = () =>
    resultsCsv([
      ...roster.slice(0, 5).map((r, i) => [r.roll_no, r.full_name, 60 + i, 61 + i, 62 + i, 63 + i]),
      [roster[5].roll_no, roster[5].full_name, 70, "x", 70, 70],
      ["BU-999999", "Nobody", 70, 70, 70, 70],
    ]);

  test("preview validates, returns the first rows and writes nothing", async () => {
    const before = await dataRows();
    const res = await send(owner, "results", "preview", csv());
    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({ rows_total: 7, rows_ok: 5, rows_failed: 2, rows_skipped: 0 });
    expect(res.body.errors.map((e) => [e.row, e.column])).toEqual([[7, "quiz_avg"], [8, "roll_no"]]);
    expect(res.body.preview).toHaveLength(7);
    expect(res.body.preview[5]).toMatchObject({ row: 7, ok: false, roll_no: roster[5].roll_no });
    expect(res.body.upload.status).toBe("previewed");
    expect(await dataRows()).toEqual(before);
  });

  test("commit saves the good rows as live, derives grades, re-predicts and audit-logs", async () => {
    const before = await dataRows();
    const res = await send(owner, "results", "commit", csv(), "cs401_marks.csv");
    expect(res.status).toBe(200);
    expect(res.body.upload).toMatchObject({ status: "committed", rows_ok: 5, rows_failed: 2, filename: "cs401_marks.csv" });
    expect(res.body.repredicted).toBe(5);
    const id = res.body.upload.id;
    const { rows } = await pool.query(
      `SELECT cr.*, e.student_id FROM course_results cr JOIN enrollments e USING (enrollment_id) WHERE cr.upload_id = $1 ORDER BY e.student_id`,
      [id]
    );
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r.data_source).toBe("live");
      expect(r.grade).toBe("C"); // means 61.5 to 65.5, derived on the server
    }
    // the bad rows' students were not touched
    const untouched = await pool.query("SELECT upload_id FROM course_results WHERE enrollment_id = $1", [roster[5].enrollment_id]);
    expect(untouched.rows[0]?.upload_id ?? null).toBeNull();

    // re-predicted with trigger 'upload' (the mocked model says Dropout-Likely for everyone)
    const preds = await pool.query(
      `SELECT p.triggered_by, p.model_label, p.source FROM students s JOIN predictions p ON p.prediction_id = s.latest_prediction_id
       WHERE s.student_id = ANY($1)`,
      [rows.map((r) => r.student_id)]
    );
    expect(preds.rows).toHaveLength(5);
    for (const p of preds.rows) expect(p).toEqual({ triggered_by: "upload", model_label: "Dropout-Likely", source: "model" });
    expect((await dataRows()).predictions).toBe(before.predictions + 5);
    const changed = res.body.labels_changed;
    expect(changed.every((c) => c.new_label === "Dropout-Likely" && c.old_label !== "Dropout-Likely")).toBe(true);
    expect(res.body.upload.summary).toMatchObject({ students: 5, repredicted: 5, labels_changed: changed.length });

    const audit = await pool.query("SELECT action, details FROM audit_log WHERE entity = 'uploads' AND entity_id = $1", [id]);
    expect(audit.rows[0].action).toBe("UPLOAD_RESULTS");

    // history lists it, newest first
    const hist = await request(app).get("/api/faculty/uploads").set(as(owner));
    expect(hist.body[0]).toMatchObject({ id, kind: "results", status: "committed", course_code: "CS401" });
    expect((await request(app).get("/api/faculty/uploads").set(as(other))).body.find((u) => u.id === id)).toBeUndefined();
  });

  test("an attendance commit upserts on (enrollment, date) and tags rows live", async () => {
    const date = "2026-11-03";
    const csv = attendanceCsv([
      [roster[0].roll_no, "", date, "present"],
      [roster[1].roll_no, "", date, "absent"],
    ]);
    const first = await send(owner, "attendance", "commit", csv);
    expect(first.body.summary.rows_ok).toBe(2);
    const again = await send(owner, "attendance", "commit", attendanceCsv([[roster[0].roll_no, "", date, "leave"]]));
    expect(again.body.summary.rows_ok).toBe(1);
    const { rows } = await pool.query(
      "SELECT enrollment_id, status, data_source, upload_id FROM attendance WHERE enrollment_id = ANY($1) AND class_date = $2 ORDER BY enrollment_id",
      [[roster[0].enrollment_id, roster[1].enrollment_id], date]
    );
    expect(rows).toHaveLength(2);
    const r0 = rows.find((r) => r.enrollment_id === roster[0].enrollment_id);
    expect(r0).toMatchObject({ status: "leave", data_source: "live", upload_id: again.body.upload.id });
  });

  test("a commit with no good rows is logged as failed and writes nothing", async () => {
    const before = await dataRows();
    const res = await send(owner, "results", "commit", resultsCsv([["BU-999999", "", 70, 70, 70, 70]]));
    expect(res.status).toBe(200);
    expect(res.body.upload.status).toBe("failed");
    expect(res.body.repredicted).toBe(0);
    expect(await dataRows()).toEqual(before);
  });
});
