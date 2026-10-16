// Separate file so the rate limiter starts empty (Jest gives each file its own app instance).
const request = require("supertest");
const app = require("../src/app");
const { login, studentId, cleanupChat, pool } = require("./helpers");

const ASKER = { roll: "BU-100478", email: "student100478@smartedu.edu" };
const since = new Date();
let askerId;

afterAll(async () => {
  await cleanupChat([askerId], since);
  await pool.end();
});

test("the 21st message within a minute gets 429", async () => {
  askerId = await studentId(ASKER.roll);
  const token = await login(app, ASKER.email, "student");
  const send = () => request(app).post("/api/student/chat").set("Authorization", `Bearer ${token}`).send({ message: "hi" });
  for (let i = 0; i < 20; i++) expect((await send()).status).toBe(200);
  const res = await send();
  expect(res.status).toBe(429);
  expect(res.body.error).toMatch(/too quickly/);
}, 30000);
