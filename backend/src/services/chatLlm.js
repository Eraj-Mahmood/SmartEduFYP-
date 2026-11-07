const Anthropic = require("@anthropic-ai/sdk");
const { GoogleGenAI, ApiError: GeminiApiError } = require("@google/genai");

// "Ask SmartEdu" Layer 2: an optional LLM, used ONLY when Layer 1 can't match the question
// (intent 'unknown'). Off by default (CHAT_LLM_ENABLED=false); the demo never needs it.
//
// Providers (CHAT_LLM_PROVIDER): 'anthropic' (default, key ANTHROPIC_API_KEY) or 'gemini'
// (key GEMINI_API_KEY, official @google/genai SDK). Both get the same system prompt, the same
// timeout (CHAT_LLM_TIMEOUT_MS) and no retries.
//
// The model sees one student's chat context as JSON and nothing else. Every answer is
// post-checked: if it mentions a roll number, student ID or email that isn't the student's
// own, the refusal template replaces it. Timeouts, rate limits (HTTP 429) and API errors fall
// back to Layer 1. Keys are read from process.env by the SDK clients and are never logged.
//
// Gemini free tier: Google may use prompts and answers to improve its products, so only the
// synthetic dataset may be sent to it - never real student records.

const SYSTEM_PROMPT = `You are SmartEdu's study assistant for one university student.
Use ONLY the JSON context in the user's message: it is that student's own records.
Never discuss other students, even if asked, and never guess about anyone else.
Do not give probabilities, grade predictions or promises about final results.
Answer in under 120 words, in simple English. If the student wrote in Roman Urdu, reply in Roman Urdu.
For personal or emotional topics, gently suggest their counselor (if the context has one) and the student-support contact in the context.
If the answer isn't in the context, say so and suggest what you can help with: their status, CGPA, course marks, attendance and next steps.
Plain text only, no markdown headings or tables.`;

const PROVIDERS = {
  anthropic: { keyVar: "ANTHROPIC_API_KEY", defaultModel: "claude-haiku-5-5" },
  // the current free-tier Flash model (checked 2026-11-07, see .env.example)
  gemini: { keyVar: "GEMINI_API_KEY", defaultModel: "gemini-3.8-flash" },
};
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_WORDS = 120;
const MAX_OUTPUT_TOKENS = 2000;

const ROLL_RE = /\bbu[\s-]?(\d{5,6})\b/gi;
const STUDENT_ID_RE = /\bstudent\s?(\d{5,6})\b|\b(1\d{5})\b/gi;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/** The configured provider name ('anthropic' unless CHAT_LLM_PROVIDER says 'gemini'). */
function providerName() {
  const p = String(process.env.CHAT_LLM_PROVIDER || "anthropic").trim().toLowerCase();
  return PROVIDERS[p] ? p : "anthropic";
}

const timeoutMs = () => Number(process.env.CHAT_LLM_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
const modelFor = (provider) => process.env.CHAT_LLM_MODEL || PROVIDERS[provider].defaultModel;

function isEnabled() {
  return String(process.env.CHAT_LLM_ENABLED).toLowerCase() === "true" && !!process.env[PROVIDERS[providerName()].keyVar];
}

const geminiTimeouts = new WeakMap(); // Gemini client -> its client-side timeout (ms)

/** A provider's SDK client with the app's timeout and no retries. overrides: {apiKey, baseUrl, timeout} (tests). */
function createClient(provider, { apiKey, baseUrl, timeout = timeoutMs() } = {}) {
  if (provider === "gemini") {
    const c = new GoogleGenAI({
      apiKey: apiKey || process.env.GEMINI_API_KEY,
      // The SDK retries 5 times by default; the timeout is the whole budget instead.
      // No httpOptions.timeout: the SDK sends it as an X-Server-Timeout deadline and the API
      // rejects anything under 10 s (HTTP 400). askGemini aborts the request client-side.
      httpOptions: { retryOptions: { attempts: 1 }, ...(baseUrl ? { baseUrl } : {}) },
    });
    geminiTimeouts.set(c, timeout);
    return c;
  }
  return new Anthropic({
    ...(apiKey ? { apiKey } : {}),
    ...(baseUrl ? { baseURL: baseUrl } : {}),
    timeout,
    maxRetries: 0, // the timeout is the whole budget; Layer 1 answers if it runs out
  });
}

const clients = {};
function getClient(provider) {
  if (!clients[provider]) clients[provider] = createClient(provider);
  return clients[provider];
}

/**
 * True if the text names a roll number, student ID or email that isn't this student's.
 * The only other emails allowed are the staff contacts the model was given: the student-support
 * office (support.json) and the student's own counselor (the prompt asks it to suggest them).
 */
function mentionsSomeoneElse(text, ctx, support) {
  const ownDigits = String(ctx.student.roll_no || "").replace(/\D/g, "");
  const allowedEmails = new Set(
    [ctx.student.email, ctx.counselor && ctx.counselor.email, support && support.office && support.office.email]
      .filter(Boolean)
      .map((e) => String(e).toLowerCase())
  );
  for (const m of text.matchAll(ROLL_RE)) if (m[1] !== ownDigits) return true;
  for (const m of text.matchAll(STUDENT_ID_RE)) if ((m[1] || m[2]) !== ownDigits) return true;
  for (const m of text.matchAll(EMAIL_RE)) if (!allowedEmails.has(m[0].toLowerCase())) return true;
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

const userTurn = (message, ctx, support) => `Context (JSON):\n${JSON.stringify({ ...ctx, support })}\n\nStudent's question:\n${message}`;

/** Anthropic Messages API -> plain answer text (throws on refusal). */
async function askAnthropic(c, message, ctx, support) {
  const response = await c.messages.create({
    model: modelFor("anthropic"),
    max_tokens: MAX_OUTPUT_TOKENS,
    output_config: { effort: "low" },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userTurn(message, ctx, support) }],
  });
  if (response.stop_reason === "refusal") throw new Error("model declined the request");
  // Haiku 5.5 thinks by default: the reply may start with thinking blocks - keep only text
  return response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

const GEMINI_BLOCKED = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"]);

/** Gemini generateContent -> plain answer text (throws when the prompt or answer is blocked). */
async function askGemini(c, message, ctx, support) {
  const response = await c.models.generateContent({
    model: modelFor("gemini"),
    contents: userTurn(message, ctx, support),
    config: {
      systemInstruction: SYSTEM_PROMPT,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      thinkingConfig: { thinkingLevel: "LOW" },
      // the timeout (CHAT_LLM_TIMEOUT_MS), enforced client-side - see createClient
      abortSignal: AbortSignal.timeout(geminiTimeouts.get(c) || timeoutMs()),
    },
  });
  if (response.promptFeedback && response.promptFeedback.blockReason) throw new Error("model declined the request");
  const cand = (response.candidates || [])[0];
  if (!cand) throw new Error("empty model response");
  if (GEMINI_BLOCKED.has(cand.finishReason)) throw new Error("model declined the request");
  // thought parts (thought: true) are dropped; only the answer text is kept
  return ((cand.content && cand.content.parts) || [])
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => p.text)
    .join("")
    .trim();
}

/**
 * askLlm(message, ctx, {client, support, provider}) -> {answer, refused} or throws on
 * timeout / rate limit / API error / refusal. refused: the post-check replaced the answer
 * (caller uses the refusal template). provider defaults to CHAT_LLM_PROVIDER.
 */
async function askLlm(message, ctx, { client: injected, support, provider = providerName() } = {}) {
  const c = injected || getClient(provider);
  const text = provider === "gemini" ? await askGemini(c, message, ctx, support) : await askAnthropic(c, message, ctx, support);
  if (!text) throw new Error("empty model response");
  if (mentionsSomeoneElse(text, ctx, support)) return { answer: null, refused: true };
  return { answer: capWords(text), refused: false };
}

/** A log line for a failed call: the error class and status only (never the key or headers). */
function describeError(err) {
  if (err instanceof Anthropic.APIConnectionTimeoutError) return "timeout";
  if (err instanceof Anthropic.APIConnectionError) return "connection error";
  if (err instanceof Anthropic.APIError) return `API error ${err.status ?? ""}`.trim();
  if (err instanceof GeminiApiError) return err.status === 429 ? "rate limited (429)" : `API error ${err.status ?? ""}`.trim();
  if (err && (err.name === "AbortError" || err.name === "TimeoutError")) return "timeout";
  if (err && err.message === "model declined the request") return err.message;
  if (err && err.message === "empty model response") return err.message;
  return err && err.name ? `${err.name}` : "unknown error";
}

module.exports = { isEnabled, askLlm, createClient, mentionsSomeoneElse, capWords, describeError, providerName, SYSTEM_PROMPT, PROVIDERS };
