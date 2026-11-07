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

module.exports = { login, studentId, cleanupChat, createTempUser, dropTempUser, PASSWORDS, pool };
