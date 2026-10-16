// Layer 2 (optional LLM), tested without a real API key: a fake client for the post-check,
// a never-answering local server for the real SDK timeout, and a spy on askLlm for the
// chat endpoint's llm / fallback / refusal paths.
const http = require("http");
const request = require("supertest");
const Anthropic = require("@anthropic-ai/sdk");
const llm = require("../src/services/chatLlm");
const app = require("../src/app");
const { login, studentId, cleanupChat, pool } = require("./helpers");

const CTX = { student: { name: "Test Student", roll_no: "BU-100008", email: "student100008@smartedu.edu" } };
const FAKE_KEY = "sk-ant-test-THIS-MUST-NEVER-BE-LOGGED";

/** A fake SDK client whose messages.create returns this response. */
const fakeClient = (response) => ({ messages: { create: jest.fn().mockResolvedValue(response) } });
const textResponse = (text, extra = {}) => ({ stop_reason: "end_turn", content: [{ type: "text", text }], ...extra });

describe("post-check", () => {
  test.each([
    ["another roll number", "BU-144766 has a CGPA of 1.62."],
    ["another roll number without the dash", "bu 122785 is doing fine"],
    ["another student email", "Ask student144766@smartedu.edu."],
    ["any other email", "Write to someone@example.com"],
    ["another student id", "Student 112907 is at risk."],
  ])("replaces an answer naming %s", async (_, text) => {
    const out = await llm.askLlm("tell me something", CTX, { client: fakeClient(textResponse(text)) });
    expect(out).toEqual({ answer: null, refused: true });
  });

  test("keeps an answer that only names the student's own roll number and email", async () => {
    const text = "Your roll number is BU-100008 and your email is student100008@smartedu.edu.";
    const out = await llm.askLlm("who am I", CTX, { client: fakeClient(textResponse(text)) });
    expect(out).toEqual({ answer: text, refused: false });
  });

  test("uses only text blocks (thinking blocks are dropped) and caps the length", async () => {
    const long = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const client = fakeClient({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: long }] });
    const out = await llm.askLlm("q", CTX, { client });
    expect(out.answer.split(/\s+/).length).toBeLessThanOrEqual(120);
    expect(out.answer.endsWith(".")).toBe(true);
  });

  test("sends the system prompt and the context as JSON in the user turn", async () => {
    const client = fakeClient(textResponse("ok"));
    await llm.askLlm("kya haal hai", CTX, { client });
    const req = client.messages.create.mock.calls[0][0];
    expect(req.model).toBe(process.env.CHAT_LLM_MODEL || "claude-haiku-5-5");
    expect(req.system).toBe(llm.SYSTEM_PROMPT);
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0].role).toBe("user");
    expect(req.messages[0].content).toContain(JSON.stringify(CTX).slice(0, 40));
    expect(req.messages[0].content).toContain("kya haal hai");
  });

  test("a model refusal or an empty reply throws (so the caller falls back)", async () => {
    await expect(llm.askLlm("q", CTX, { client: fakeClient({ stop_reason: "refusal", content: [] }) })).rejects.toThrow();
    await expect(llm.askLlm("q", CTX, { client: fakeClient(textResponse("  ")) })).rejects.toThrow();
  });
});

describe("timeout", () => {
  let server;
  let port;
  beforeAll(async () => {
    server = http.createServer(() => {}); // accepts the request and never answers
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = server.address().port;
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  test("the real SDK client times out and the error is described without the key", async () => {
    const client = new Anthropic({ apiKey: FAKE_KEY, baseURL: `http://127.0.0.1:${port}`, timeout: 300, maxRetries: 0 });
    const err = await llm.askLlm("q", CTX, { client }).catch((e) => e);
    expect(err).toBeInstanceOf(Anthropic.APIConnectionTimeoutError);
    expect(llm.describeError(err)).toBe("timeout");
    expect(llm.describeError(err)).not.toContain(FAKE_KEY);
  });
});

describe("POST /api/student/chat with Layer 2", () => {
  const ASKER = { roll: "BU-102717", email: "student102717@smartedu.edu" };
  const since = new Date();
  const saved = {};
  let token;
  let askerId;
  let spy;
  let warn;

  beforeAll(async () => {
    for (const k of ["CHAT_LLM_ENABLED", "ANTHROPIC_API_KEY"]) saved[k] = process.env[k];
    token = await login(app, ASKER.email, "student");
    askerId = await studentId(ASKER.roll);
  });
  beforeEach(() => {
    process.env.CHAT_LLM_ENABLED = "true";
    process.env.ANTHROPIC_API_KEY = FAKE_KEY;
    spy = jest.spyOn(llm, "askLlm");
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    spy.mockRestore();
    warn.mockRestore();
  });
  afterAll(async () => {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    await cleanupChat([askerId], since);
    await pool.end();
  });

  const chat = (message) => request(app).post("/api/student/chat").set("Authorization", `Bearer ${token}`).send({ message });

  test("an unknown question goes to the LLM (source 'llm')", async () => {
    spy.mockResolvedValue({ answer: "I can only help with your studies, but here's a tip: plan your week.", refused: false });
    const res = await chat("Tell me a joke");
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("llm");
    expect(res.body.answer).toContain("plan your week");
    expect(spy).toHaveBeenCalledTimes(1);
    const ctx = spy.mock.calls[0][1];
    expect(ctx.student.roll_no).toBe(ASKER.roll); // the context is the logged-in student's
    const hist = await request(app).get("/api/student/chat/history").set("Authorization", `Bearer ${token}`);
    expect(hist.body.at(-1)).toMatchObject({ role: "assistant", source: "llm" });
  });

  test("a matched intent never calls the LLM", async () => {
    const res = await chat("What is my CGPA?");
    expect(res.body.source).toBe("template");
    expect(spy).not.toHaveBeenCalled();
  });

  test("an LLM answer naming another student is replaced by the refusal template", async () => {
    spy.mockResolvedValue({ answer: null, refused: true });
    const res = await chat("Tell me a joke");
    expect(res.body.intent).toBe("other_student");
    expect(res.body.answer).toMatch(/other students/);
    expect(res.body.answer).not.toMatch(/\d/);
  });

  test("timeout or error falls back to the Layer 1 unknown reply (source 'fallback') and never logs the key", async () => {
    spy.mockRejectedValue(new Anthropic.APIConnectionTimeoutError());
    const res = await chat("Who won the cricket match?");
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("fallback");
    expect(res.body.intent).toBe("unknown");
    expect(res.body.answer).toMatch(/I can help with your status/);
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toMatch(/timeout/);
    expect(logged).not.toContain(FAKE_KEY);
  });

  test("with CHAT_LLM_ENABLED=false the LLM is never called", async () => {
    process.env.CHAT_LLM_ENABLED = "false";
    const res = await chat("Tell me a joke");
    expect(res.body.source).toBe("template");
    expect(res.body.intent).toBe("unknown");
    expect(spy).not.toHaveBeenCalled();
  });
});
