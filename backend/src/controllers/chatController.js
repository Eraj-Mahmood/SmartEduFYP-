const chatService = require("../services/chatService");
const { getMyStudentId } = require("./studentController");

// "Ask SmartEdu" endpoints. The student is always the logged-in user (req.user from the JWT);
// nothing in the request body can choose another student.

/** POST /api/student/chat {message} -> {answer, intent, source, suggestions, links, created_at} */
async function send(req, res) {
  try {
    const studentId = await getMyStudentId(req.user.userId);
    res.json(await chatService.chat(studentId, req.body.message));
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: "The assistant couldn't answer just now. Please try again." });
  }
}

/** GET /api/student/chat/history -> last 50 messages, oldest first */
async function history(req, res) {
  try {
    const studentId = await getMyStudentId(req.user.userId);
    res.json(await chatService.history(studentId));
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message });
  }
}

/** DELETE /api/student/chat/history -> {deleted} */
async function clear(req, res) {
  try {
    const studentId = await getMyStudentId(req.user.userId);
    res.json({ deleted: await chatService.clearHistory(studentId) });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message });
  }
}

module.exports = { send, history, clear };
