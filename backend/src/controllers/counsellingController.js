const { sendError } = require("../middleware/errors");
const svc = require("../services/counsellingSessions");

// Counselling sessions (Phase 7). Admin: schedule / list / reschedule / cancel / attendance override.
// Faculty: their own sessions and marking attendance. Student: their own sessions (no counsellor notes).
// The rules and the audit log live in services/counsellingSessions.js.

const fail = (res, err) => sendError(res, err, "Could not complete the counselling session request");

// ---------------- admin ----------------

/** POST /api/admin/counselling-sessions */
async function schedule(req, res) {
  try {
    const out = await svc.scheduleSession(req.body, req.user.userId);
    res.status(201).json(out);
  } catch (err) {
    fail(res, err);
  }
}

/** GET /api/admin/counselling-sessions?counsellor&student&search&status&from&to&page&limit */
async function adminList(req, res) {
  try {
    const q = req.query;
    res.json(
      await svc.listForAdmin({
        counsellor: q.counsellor,
        student: q.student,
        search: q.search,
        status: q.status,
        from: q.from,
        to: q.to,
        page: q.page,
        limit: q.limit,
      })
    );
  } catch (err) {
    fail(res, err);
  }
}

/** PUT /api/admin/counselling-sessions/:id/reschedule */
async function reschedule(req, res) {
  try {
    res.json(await svc.rescheduleSession(req.params.id, req.body, req.user.userId));
  } catch (err) {
    fail(res, err);
  }
}

/** PUT /api/admin/counselling-sessions/:id/cancel {reason} */
async function cancel(req, res) {
  try {
    res.json(await svc.cancelSession(req.params.id, req.body.reason, req.user.userId));
  } catch (err) {
    fail(res, err);
  }
}

/** PUT /api/admin/counselling-sessions/:id/attendance and /api/faculty/counselling-sessions/:id/attendance */
async function attendance(req, res) {
  try {
    res.json(await svc.markAttendance(req.params.id, { attendance: req.body.attendance, notes: req.body.notes }, req.user));
  } catch (err) {
    fail(res, err);
  }
}

// ---------------- faculty ----------------

/** GET /api/faculty/counselling-sessions?view=upcoming|history */
async function facultyList(req, res) {
  try {
    res.json({ view: req.query.view || "upcoming", sessions: await svc.listForFaculty(req.user.userId, req.query.view) });
  } catch (err) {
    fail(res, err);
  }
}

// ---------------- student ----------------

/** GET /api/student/counselling-sessions */
async function studentList(req, res) {
  try {
    res.json(await svc.listForStudent(req.user.userId));
  } catch (err) {
    fail(res, err);
  }
}

module.exports = { schedule, adminList, reschedule, cancel, attendance, facultyList, studentList };
