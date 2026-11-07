// Run by chat.gemini.test.js in a plain Node process (inside Jest's vm sandbox Node's fetch and
// the SDK's retry wrapper see different realms, so the real client can't be exercised there).
// Starts a local server that answers 429 or never answers, calls askLlm with the real
// @google/genai client pointed at it, and prints one JSON line with what happened.
const http = require("http");
const llm = require("../../src/services/chatLlm");

const FAKE_KEY = process.argv[3] || "fake";
const mode = process.argv[2]; // "429" | "hang"
let hits = 0;
const server = http.createServer((req, res) => {
  hits++;
  if (mode === "hang") return;
  res.writeHead(429, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: { code: 429, message: "Resource has been exhausted (e.g. check quota).", status: "RESOURCE_EXHAUSTED" } }));
});

server.listen(0, "127.0.0.1", async () => {
  const client = llm.createClient("gemini", { apiKey: FAKE_KEY, baseUrl: `http://127.0.0.1:${server.address().port}`, timeout: 300 });
  const started = Date.now();
  const err = await llm
    .askLlm("q", { student: { roll_no: "BU-100008", email: "student100008@smartedu.edu" } }, { client, provider: "gemini" })
    .then(() => null, (e) => e);
  console.log(JSON.stringify({ hits, ms: Date.now() - started, name: err && err.name, status: err && err.status, described: err && llm.describeError(err) }));
  server.closeAllConnections();
  server.close();
});
