const pool = require("../config/db");
const { buildChatContext } = require("./chatContext");
const chatbot = require("./chatbot");
const llm = require("./chatLlm");
const { _about, ...support } = require("../config/support.json"); // contacts only, for the LLM context

// "Ask SmartEdu": one chat turn = context -> Layer 1 (router + templates) -> optional Layer 2
// (LLM, unknown intent only) -> both messages saved -> response. The student id always comes
// from the JWT (req.user) via the controller.

const HISTORY_LIMIT = 50;
const CATALOG_TTL_MS = 10 * 60 * 1000;

let catalogCache = null;
/** All course codes and titles (so the router can say "that isn't one of your courses"). */
async function getCatalog() {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.rows;
  const { rows } = await pool.query("SELECT course_code AS code, title FROM courses ORDER BY course_code");
  catalogCache = { rows, at: Date.now() };
  return rows;
}

/** chat(studentId, message) -> {answer, intent, source, suggestions, links, created_at} and saves both messages. */
async function chat(studentId, message) {
  const [ctx, catalog] = await Promise.all([buildChatContext(studentId), getCatalog()]);
  let reply = chatbot.respond(message, ctx, { catalog });
  let source = "template";

  // Layer 2 only for questions Layer 1 couldn't match, and only when switched on
  if (reply.intent === "unknown" && llm.isEnabled()) {
    try {
      const out = await llm.askLlm(message, ctx, { support });
      if (out.refused) {
        reply = { ...reply, ...chatbot.otherStudentReply(ctx), intent: "other_student" };
      } else {
        reply = { ...reply, answer: out.answer, suggestions: chatbot.STARTERS.slice(0, 3), links: [] };
      }
      source = "llm";
    } catch (err) {
      console.warn("Chat LLM unavailable, using the Layer 1 reply:", llm.describeError(err));
      reply = { ...reply, ...chatbot.unknown(ctx) };
      source = "fallback";
    }
  }

  const client = await pool.connect();
  let saved;
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO chat_messages (student_id, role, content, intent) VALUES ($1, 'user', $2, $3)",
      [studentId, message, reply.intent]
    );
    ({ rows: [saved] } = await client.query(
      `INSERT INTO chat_messages (student_id, role, content, intent, source)
       VALUES ($1, 'assistant', $2, $3, $4) RETURNING id, created_at`,
      [studentId, reply.answer, reply.intent, source]
    ));
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return { ...reply, source, id: saved.id, created_at: saved.created_at };
}

/** The student's last 50 messages, oldest first. */
async function history(studentId) {
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT id, role, content, intent, source, created_at FROM chat_messages
       WHERE student_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2
     ) m ORDER BY created_at, id`,
    [studentId, HISTORY_LIMIT]
  );
  return rows;
}

/** Deletes this student's own history; returns how many messages were removed. */
async function clearHistory(studentId) {
  const { rowCount } = await pool.query("DELETE FROM chat_messages WHERE student_id = $1", [studentId]);
  return rowCount;
}

module.exports = { chat, history, clearHistory, getCatalog, HISTORY_LIMIT };
