// Shared helpers for the API tests. They run against the local smartedu database
// (backend/.env) with the seeded demo accounts; the ML service is not needed.
const request = require("supertest");
const pool = require("../src/config/db");

const PASSWORDS = { student: "Student@123", faculty: "Faculty@123", admin: "Admin@123" };

async function login(app, email, role) {
  const res = await request(app).post("/api/auth/login").send({ email, password: PASSWORDS[role] });
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

module.exports = { login, studentId, cleanupChat, pool };
