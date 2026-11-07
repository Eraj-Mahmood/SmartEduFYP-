// Shared helpers for the API tests. They run against the local smartedu database
// (backend/.env) with the seeded demo accounts; the ML service is not needed.
const request = require("supertest");
const pool = require("../src/config/db");

const PASSWORDS = { student: "Student@123", faculty: "Faculty@123", admin: "Admin@123" };

async function login(app, email, role) {
  const res = await request(app).post("/api/auth/login").send({ email, password: PASSWORDS[role], portal: role });
  if (res.status !== 200) throw new Error(`login ${email} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token;
}

async function studentId(roll) {
  const { rows } = await pool.query("SELECT student_id FROM students WHERE roll_no = $1", [roll]);
  return rows[0].student_id;
}

/** Deletes chat messages the tests created (only for these students, only since `since`). */
async function cleanupChat(studentIds, since) {
  await pool.query("DELETE FROM chat_messages WHERE student_id = ANY($1) AND created_at >= $2", [studentIds, since]);
}

/** A throwaway login (no student/faculty profile) for tests that change account state.
 *  Remove it with dropTempUser(userId). */
async function createTempUser(role = "student", { mustReset = false, password = PASSWORDS[role] } = {}) {
  const bcrypt = require("bcrypt");
  const email = `jest.${role}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@smartedu.test`;
  const { rows } = await pool.query(
    "INSERT INTO users (email, password_hash, role, must_reset_pw) VALUES ($1, $2, $3, $4) RETURNING user_id",
    [email, await bcrypt.hash(password, 4), role, mustReset]
  );
  return { userId: rows[0].user_id, email, password, role };
}

async function dropTempUser(userId) {
  await pool.query("DELETE FROM audit_log WHERE actor_user_id = $1", [userId]);
  await pool.query("DELETE FROM users WHERE user_id = $1", [userId]);
}

/**
 * Snapshot for tests that write marks / attendance / predictions: the students' latest-prediction
 * pointers, the given enrollments' course_results rows (updated_at kept as text, so a restore is
 * exact) and their attendance rows. restoreSnapshot() puts it all back and deletes the predictions
 * made since. Pass student ids and enrollment ids.
 */
async function takeSnapshot({ studentIds = [], enrollmentIds = [] }) {
  return {
    at: (await pool.query("SELECT NOW() AS t")).rows[0].t,
    studentIds,
    enrollmentIds,
    pointers: (await pool.query("SELECT student_id, latest_prediction_id FROM students WHERE student_id = ANY($1)", [studentIds])).rows,
    results: (await pool.query("SELECT *, updated_at::text AS updated_at_text FROM course_results WHERE enrollment_id = ANY($1)", [enrollmentIds])).rows,
    attendance: (await pool.query("SELECT *, marked_at::text AS marked_at_text FROM attendance WHERE enrollment_id = ANY($1)", [enrollmentIds])).rows,
    enrollments: (await pool.query("SELECT enrollment_id, status FROM enrollments WHERE enrollment_id = ANY($1)", [enrollmentIds])).rows,
  };
}

async function restoreSnapshot(snap) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    for (const p of snap.pointers) await c.query("UPDATE students SET latest_prediction_id = $2 WHERE student_id = $1", [p.student_id, p.latest_prediction_id]);
    await c.query("DELETE FROM predictions WHERE student_id = ANY($1) AND created_at >= $2", [snap.studentIds, snap.at]);
    for (const e of snap.enrollments) await c.query("UPDATE enrollments SET status = $2 WHERE enrollment_id = $1", [e.enrollment_id, e.status]);
    await c.query("DELETE FROM attendance WHERE enrollment_id = ANY($1)", [snap.enrollmentIds]);
    for (const r of snap.attendance) {
      await c.query(
        `INSERT INTO attendance (attendance_id, enrollment_id, class_date, status, marked_by, marked_at, data_source, upload_id)
         VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7,$8)`,
        [r.attendance_id, r.enrollment_id, r.class_date, r.status, r.marked_by, r.marked_at_text, r.data_source, r.upload_id]
      );
    }
    for (const r of snap.results) {
      await c.query(
        `UPDATE course_results SET assignment_avg = $2, quiz_avg = $3, midterm_marks = $4, final_marks = $5, grade = $6,
           updated_by = $7, updated_at = $8::timestamptz, data_source = $9, upload_id = $10 WHERE result_id = $1`,
        [r.result_id, r.assignment_avg, r.quiz_avg, r.midterm_marks, r.final_marks, r.grade, r.updated_by, r.updated_at_text, r.data_source, r.upload_id]
      );
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

/** Every key anywhere in a JSON value (for "never exposes X" checks). */
function allKeys(v, out = new Set()) {
  if (Array.isArray(v)) v.forEach((x) => allKeys(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.add(k); allKeys(x, out); }
  return out;
}

module.exports = { login, studentId, cleanupChat, createTempUser, dropTempUser, takeSnapshot, restoreSnapshot, allKeys, PASSWORDS, pool };
