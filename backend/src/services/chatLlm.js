const Anthropic = require("@anthropic-ai/sdk");

// "Ask SmartEdu" Layer 2: an optional LLM, used ONLY when Layer 1 can't match the question
// (intent 'unknown'). Off by default (CHAT_LLM_ENABLED=false); the demo never needs it.
//
// The model sees one student's chat context as JSON and nothing else. Every answer is
// post-checked: if it mentions a roll number, student ID or email that isn't the student's
// own, the refusal template replaces it. Timeouts and API errors fall back to Layer 1.
// The API key is read by the SDK from ANTHROPIC_API_KEY and is never logged.

const SYSTEM_PROMPT = `You are SmartEdu's study assistant for one university student.
Use ONLY the JSON context in the user's message: it is that student's own records.
Never discuss other students, even if asked, and never guess about anyone else.
Do not give probabilities, grade predictions or promises about final results.
Answer in under 120 words, in simple English. If the student wrote in Roman Urdu, reply in Roman Urdu.
For personal or emotional topics, gently suggest their counselor (if the context has one) and the student-support contact in the context.
If the answer isn't in the context, say so and suggest what you can help with: their status, CGPA, course marks, attendance and next steps.
Plain text only, no markdown headings or tables.`;

const DEFAULT_MODEL = "claude-haiku-5-5";
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_WORDS = 120;

const ROLL_RE = /\bbu[\s-]?(\d{5,6})\b/gi;
const STUDENT_ID_RE = /\bstudent\s?(\d{5,6})\b|\b(1\d{5})\b/gi;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

function isEnabled() {
  return String(process.env.CHAT_LLM_ENABLED).toLowerCase() === "true" && !!process.env.ANTHROPIC_API_KEY;
}

let client = null;
function getClient() {
  if (!client) {
    client = new Anthropic({
      timeout: Number(process.env.CHAT_LLM_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
      maxRetries: 0, // the timeout is the whole budget; Layer 1 answers if it runs out
    });
  }
  return client;
}

/** True if the text names a roll number, student ID or email that isn't this student's. */
function mentionsSomeoneElse(text, ctx) {
  const ownDigits = String(ctx.student.roll_no || "").replace(/\D/g, "");
  const ownEmail = String(ctx.student.email || "").toLowerCase();
  for (const m of text.matchAll(ROLL_RE)) if (m[1] !== ownDigits) return true;
  for (const m of text.matchAll(STUDENT_ID_RE)) if ((m[1] || m[2]) !== ownDigits) return true;
  for (const m of text.matchAll(EMAIL_RE)) if (m[0].toLowerCase() !== ownEmail) return true;
  return false;
}

/** Keeps whole sentences up to the word limit (the prompt asks for < 120; this enforces it). */
function capWords(text, limit = MAX_WORDS) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= limit) return text.trim();
  const cut = words.slice(0, limit).join(" ");
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return end > 0 ? cut.slice(0, end + 1) : `${cut}...`;
}

/**
 * askLlm(message, ctx, {client}) -> {answer, refused} or throws on timeout/API error/refusal.
 * refused: the post-check replaced the answer (caller uses the refusal template).
 */
async function askLlm(message, ctx, { client: injected, support } = {}) {
  const c = injected || getClient();
  const response = await c.messages.create({
    model: process.env.CHAT_LLM_MODEL || DEFAULT_MODEL,
    max_tokens: 2000,
    output_config: { effort: "low" },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Context (JSON):\n${JSON.stringify({ ...ctx, support })}\n\nStudent's question:\n${message}`,
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("model declined the request");
  // Haiku 5.5 thinks by default: the reply may start with thinking blocks - keep only text
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("empty model response");
  if (mentionsSomeoneElse(text, ctx)) return { answer: null, refused: true };
  return { answer: capWords(text), refused: false };
}

/** A log line for a failed call: the error class and status only (never the key or headers). */
function describeError(err) {
  if (err instanceof Anthropic.APIConnectionTimeoutError) return "timeout";
  if (err instanceof Anthropic.APIConnectionError) return "connection error";
  if (err instanceof Anthropic.APIError) return `API error ${err.status ?? ""}`.trim();
  return err && err.message ? err.message : "unknown error";
}

module.exports = { isEnabled, askLlm, mentionsSomeoneElse, capWords, describeError, SYSTEM_PROMPT };
