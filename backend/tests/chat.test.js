const request = require("supertest");
const app = require("../src/app");
const { buildChatContext } = require("../src/services/chatContext");
const { login, studentId, cleanupChat, pool } = require("./helpers");

// The asker is an ordinary enrolled student (not one of the six demo accounts, so the demo
// chat histories are left alone). BU-144766 is the demo student they try to ask about.
const ASKER = { roll: "BU-100008", email: "student100008@smartedu.edu" };
const TARGET = "BU-144766";

let token;
let askerId;
let target;
const since = new Date();

beforeAll(async () => {
  token = await login(app, ASKER.email, "student");
  askerId = await studentId(ASKER.roll);
  target = await buildChatContext(await studentId(TARGET));
});

afterAll(async () => {
  await cleanupChat([askerId], since);
  await pool.end();
});

const chat = (message, t = token) => request(app).post("/api/student/chat").set("Authorization", `Bearer ${t}`).send({ message });

describe("POST /api/student/chat", () => {
  test("a student can chat and gets their own data", async () => {
    const mine = await buildChatContext(askerId);
    const res = await chat("What is my CGPA?");
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("standing");
    expect(res.body.source).toBe("template");
    expect(res.body.answer).toContain(mine.standing.official_cgpa.toFixed(2));
    expect(res.body.suggestions.length).toBeLessThanOrEqual(3);
    expect(Array.isArray(res.body.links)).toBe(true);
    expect(res.body.answer).not.toMatch(/probab/i);

    // both messages are saved, oldest first
    const hist = await request(app).get("/api/student/chat/history").set("Authorization", `Bearer ${token}`);
    expect(hist.status).toBe(200);
    const last = hist.body.slice(-2);
    expect(last.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(last[0].content).toBe("What is my CGPA?");
    expect(last[1].content).toBe(res.body.answer);
  });

  test("a body studentId cannot pick another student", async () => {
    const res = await request(app)
      .post("/api/student/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "What is my CGPA?", studentId: await studentId(TARGET), student_id: await studentId(TARGET) });
    expect(res.status).toBe(200);
    const mine = await buildChatContext(askerId);
    expect(res.body.answer).toContain(mine.standing.official_cgpa.toFixed(2));
    expect(res.body.answer).toContain(mine.standing.projected_cgpa.toFixed(2));
    if (target.standing.projected_cgpa !== mine.standing.projected_cgpa) {
      expect(res.body.answer).not.toContain(target.standing.projected_cgpa.toFixed(2));
    }
  });

  test.each(["faculty", "admin"])("a %s token gets 403", async (role) => {
    const email = role === "faculty" ? "ayesha.khan@smartedu.edu" : "admin@smartedu.edu";
    const t = await login(app, email, role);
    const res = await chat("What is my CGPA?", t);
    expect(res.status).toBe(403);
    const hist = await request(app).get("/api/student/chat/history").set("Authorization", `Bearer ${t}`);
    expect(hist.status).toBe(403);
  });

  test("no token gets 401", async () => {
    const res = await request(app).post("/api/student/chat").send({ message: "hi" });
    expect(res.status).toBe(401);
  });

  test("a question naming another demo student's roll number is refused without their numbers", async () => {
    const res = await chat(`What is ${TARGET}'s CGPA and attendance?`);
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("other_student");
    const s = target.standing;
    const theirs = [
      target.student.name,
      target.student.email,
      ...[s.official_cgpa, s.projected_cgpa, s.provisional_sgpa, s.previous_sgpa].map((v) => v.toFixed(2)),
      String(target.attendance.pct),
      `${Math.round(target.attendance.pct * 10) / 10}%`,
    ];
    for (const value of theirs) expect(res.body.answer).not.toContain(value);
    expect(res.body.answer).not.toMatch(/\d/); // the refusal carries no figures at all
  });

  test.each([
    ["empty", ""],
    ["only spaces", "    "],
    ["over 500 characters", "a".repeat(501)],
    ["not text", 42],
  ])("a %s message gets 400", async (_, message) => {
    const res = await chat(message);
    expect(res.status).toBe(400);
  });

  test("a missing message gets 400", async () => {
    const res = await request(app).post("/api/student/chat").set("Authorization", `Bearer ${token}`).send({});
    expect(res.status).toBe(400);
  });

  test("exactly 500 characters is accepted", async () => {
    const res = await chat(`How can I improve? ${"x".repeat(481)}`);
    expect(res.status).toBe(200);
  });

  test("chat still answers when the ML service is down", async () => {
    const saved = { url: process.env.ML_SERVICE_URL, batch: process.env.ML_BATCH_URL };
    process.env.ML_SERVICE_URL = "http://127.0.0.1:9/predict"; // nothing listens on port 9
    process.env.ML_BATCH_URL = "http://127.0.0.1:9/predict/batch";
    try {
      const res = await chat("Why is my status this?");
      expect(res.status).toBe(200);
      expect(res.body.intent).toBe("why_risk");
      expect(res.body.answer.length).toBeGreaterThan(20);
    } finally {
      process.env.ML_SERVICE_URL = saved.url;
      if (saved.batch === undefined) delete process.env.ML_BATCH_URL;
      else process.env.ML_BATCH_URL = saved.batch;
    }
  });
});

describe("chat history", () => {
  test("DELETE clears only this student's own history", async () => {
    const targetId = await studentId(TARGET);
    const before = await pool.query("SELECT COUNT(*)::int AS n FROM chat_messages WHERE student_id = $1", [targetId]);
    await chat("hi");
    const del = await request(app).delete("/api/student/chat/history").set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBeGreaterThan(0);
    const hist = await request(app).get("/api/student/chat/history").set("Authorization", `Bearer ${token}`);
    expect(hist.body).toEqual([]);
    const after = await pool.query("SELECT COUNT(*)::int AS n FROM chat_messages WHERE student_id = $1", [targetId]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
