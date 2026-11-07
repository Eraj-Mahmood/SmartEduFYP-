// Layer 2 with CHAT_LLM_PROVIDER=gemini, tested without calling Google: a fake client for the
// response handling and the post-check, the real @google/genai client against a local server
// for 429 and timeout (one attempt only, no retries), and a spy on askLlm for the chat endpoint.
const path = require("path");
const { execFileSync } = require("child_process");
const request = require("supertest");
const { ApiError } = require("@google/genai");
const llm = require("../src/services/chatLlm");
const app = require("../src/app");
const { login, studentId, cleanupChat, pool } = require("./helpers");

const FAKE_KEY = "AIza-test-THIS-MUST-NEVER-BE-LOGGED";
const CTX = { student: { name: "Test Student", roll_no: "BU-100008", email: "student100008@smartedu.edu" } };

// never touch the real key or Google from the tests
const saved = {};
const KEYS = ["CHAT_LLM_PROVIDER", "CHAT_LLM_ENABLED", "GEMINI_API_KEY", "CHAT_LLM_MODEL"];
beforeAll(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.CHAT_LLM_PROVIDER = "gemini";
  process.env.GEMINI_API_KEY = FAKE_KEY;
  delete process.env.CHAT_LLM_MODEL;
});
afterAll(async () => {
  for (const k of KEYS) if (saved[k] === undefined) delete process.env[k];
  else process.env[k] = saved[k];
  await pool.end();
});

/** A fake GoogleGenAI whose models.generateContent resolves (or rejects) with this. */
const fakeGemini = (impl) => ({ models: { generateContent: jest.fn(impl) } });
const geminiResponse = (text, extra = {}) => ({
  candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }],
  ...extra,
});

describe("gemini provider", () => {
  test("is the configured provider and is enabled only with the key", () => {
    expect(llm.providerName()).toBe("gemini");
    process.env.CHAT_LLM_ENABLED = "true";
    expect(llm.isEnabled()).toBe(true);
    delete process.env.GEMINI_API_KEY;
    expect(llm.isEnabled()).toBe(false);
    process.env.GEMINI_API_KEY = FAKE_KEY;
    process.env.CHAT_LLM_ENABLED = "false";
    expect(llm.isEnabled()).toBe(false);
  });

  test("success: same system prompt, context as JSON, default Flash model; thought parts dropped", async () => {
    const client = fakeGemini(async () => ({
      candidates: [{ content: { parts: [{ text: "planning...", thought: true }, { text: "Plan your week around your weakest course." }] }, finishReason: "STOP" }],
    }));
    const out = await llm.askLlm("kya haal hai", CTX, { client });
    expect(out).toEqual({ answer: "Plan your week around your weakest course.", refused: false });
    const req = client.models.generateContent.mock.calls[0][0];
    expect(req.model).toBe("gemini-3.8-flash");
    expect(req.config.systemInstruction).toBe(llm.SYSTEM_PROMPT);
    expect(req.config.maxOutputTokens).toBeGreaterThan(0);
    expect(req.config.abortSignal).toBeDefined();
    expect(req.contents).toContain(JSON.stringify(CTX).slice(0, 40));
    expect(req.contents).toContain("kya haal hai");
  });

  test("CHAT_LLM_MODEL overrides the model", async () => {
    process.env.CHAT_LLM_MODEL = "gemini-3.5-flash-lite";
    const client = fakeGemini(async () => geminiResponse("ok"));
    await llm.askLlm("q", CTX, { client });
    expect(client.models.generateContent.mock.calls[0][0].model).toBe("gemini-3.5-flash-lite");
    delete process.env.CHAT_LLM_MODEL;
  });

  test("the word cap applies", async () => {
    const long = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const out = await llm.askLlm("q", CTX, { client: fakeGemini(async () => geminiResponse(long)) });
    expect(out.answer.split(/\s+/).length).toBeLessThanOrEqual(120);
    expect(out.answer.endsWith(".")).toBe(true);
  });

  test.each([
    ["another roll number", "BU-144766 has a CGPA of 1.62."],
    ["another student email", "Ask student144766@smartedu.edu."],
    ["another student id", "Student 112907 is at risk."],
  ])("post-check refuses an answer naming %s", async (_, text) => {
    const out = await llm.askLlm("tell me something", CTX, { client: fakeGemini(async () => geminiResponse(text)) });
    expect(out).toEqual({ answer: null, refused: true });
  });

  test("the support office and the student's own counselor emails are allowed; others are not", async () => {
    const support = require("../src/config/support.json");
    const ctx = { ...CTX, counselor: { name: "Ms. Ayesha Khan", email: "ayesha.khan@smartedu.edu" } };
    const ask = (text, c = ctx) => llm.askLlm("q", c, { client: fakeGemini(async () => geminiResponse(text)), support });
    expect((await ask(`Write to ${support.office.email} or ayesha.khan@smartedu.edu.`)).refused).toBe(false);
    expect((await ask("Write to zain.abbas@smartedu.edu.")).refused).toBe(true); // not their counselor
    expect((await ask("ayesha.khan@smartedu.edu can help.", CTX)).refused).toBe(true); // no counselor in context
    expect((await ask(`${support.office.email} - or ask student144766@smartedu.edu`)).refused).toBe(true);
  });

  test("a blocked prompt, a safety stop or an empty answer throws (the caller falls back)", async () => {
    await expect(llm.askLlm("q", CTX, { client: fakeGemini(async () => ({ promptFeedback: { blockReason: "SAFETY" }, candidates: [] })) })).rejects.toThrow();
    await expect(llm.askLlm("q", CTX, { client: fakeGemini(async () => ({ candidates: [{ content: { parts: [] }, finishReason: "SAFETY" }] })) })).rejects.toThrow();
    await expect(llm.askLlm("q", CTX, { client: fakeGemini(async () => geminiResponse("   ")) })).rejects.toThrow();
  });

  test("a mocked 429 rejects and is described as a rate limit", async () => {
    const err = await llm
      .askLlm("q", CTX, { client: fakeGemini(async () => { throw new ApiError({ status: 429, message: "quota" }); }) })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(llm.describeError(err)).toBe("rate limited (429)");
  });
});

// The real @google/genai client, run in a child Node process (see fixtures/gemini_real_sdk.js).
describe("real SDK client against a local server", () => {
  const run = (mode) => {
    const out = execFileSync(process.execPath, [path.join(__dirname, "fixtures", "gemini_real_sdk.js"), mode, FAKE_KEY], {
      encoding: "utf8",
      timeout: 15000,
    });
    return { raw: out, ...JSON.parse(out.trim().split("\n").pop()) };
  };

  test("HTTP 429 is one attempt (no retries) and is described without the key", () => {
    const r = run("429");
    expect(r).toMatchObject({ hits: 1, name: "ApiError", status: 429, described: "rate limited (429)" });
    expect(r.raw).not.toContain(FAKE_KEY);
  });

  test("a server that never answers times out after one attempt", () => {
    const r = run("hang");
    expect(r).toMatchObject({ hits: 1, described: "timeout" });
    expect(r.ms).toBeLessThan(5000);
  });
});

describe("POST /api/student/chat with Gemini", () => {
  const ASKER = { roll: "BU-102717", email: "student102717@smartedu.edu" };
  const since = new Date();
  let token;
  let askerId;
  let spy;
  let warn;

  beforeAll(async () => {
    token = await login(app, ASKER.email, "student");
    askerId = await studentId(ASKER.roll);
  });
  beforeEach(() => {
    process.env.CHAT_LLM_ENABLED = "true";
    spy = jest.spyOn(llm, "askLlm");
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    spy.mockRestore();
    warn.mockRestore();
  });
  afterAll(async () => {
    await cleanupChat([askerId], since);
  });

  const chat = (message) => request(app).post("/api/student/chat").set("Authorization", `Bearer ${token}`).send({ message });

  test("an unknown question gets the Gemini answer (source 'llm')", async () => {
    spy.mockResolvedValue({ answer: "Try a weekly plan for your weakest course.", refused: false });
    const res = await chat("Tell me a joke");
    expect(res.body.source).toBe("llm");
    expect(res.body.answer).toContain("weekly plan");
  });

  test("a 429 falls back to Layer 1 (source 'fallback'), logs the reason, never the key", async () => {
    spy.mockRejectedValue(new ApiError({ status: 429, message: "quota" }));
    const res = await chat("Who won the cricket match?");
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("fallback");
    expect(res.body.intent).toBe("unknown");
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toMatch(/rate limited \(429\)/);
    expect(logged).not.toContain(FAKE_KEY);
  });

  test("a post-check refusal gives the other-student template", async () => {
    spy.mockResolvedValue({ answer: null, refused: true });
    const res = await chat("Tell me a joke");
    expect(res.body.intent).toBe("other_student");
    expect(res.body.answer).not.toMatch(/\d/);
  });
});
