const { sendError } = require("../middleware/errors");
const { logAction } = require("../middleware/audit");
const close = require("../services/semesterClose");
const letters = require("../services/warningLetters");
const { getStudentStanding } = require("../services/studentStanding");

// Academic standing (Phase 7): semester close (admin), warning letters (admin + own student),
// Probation 2 enrolment approvals (admin). Rules: services/academicStanding.js, semesterClose.js,
// warningLetters.js.

const fail = (res, err) => sendError(res, err, "Could not complete the academic standing request");

/** POST /api/admin/semester-close/preview {termLabel} - writes nothing */
async function preview(req, res) {
  try {
    res.json(await close.preview(req.body.termLabel));
  } catch (err) {
    fail(res, err);
  }
}

/** POST /api/admin/semester-close/confirm {termLabel, resultsFinal: true} */
async function confirm(req, res) {
  try {
    res.status(201).json(await close.confirm(req.body, req.user.userId));
  } catch (err) {
    fail(res, err);
  }
}

/** GET /api/admin/semester-closes */
async function closes(req, res) {
  try {
    res.json(await close.listCloses());
  } catch (err) {
    fail(res, err);
  }
}

/** GET /api/admin/warning-letters?student&acknowledged=yes|no&page&limit */
async function adminLetters(req, res) {
  try {
    const q = req.query;
    res.json(await letters.listLetters({ student: q.student, acknowledged: q.acknowledged, page: q.page || 1, limit: q.limit || 25 }));
  } catch (err) {
    fail(res, err);
  }
}

/** GET /api/admin/warning-letters/:id - print-friendly content */
async function adminLetter(req, res) {
  try {
    const row = await letters.getLetter(req.params.id);
    if (!row) return res.status(404).json({ error: "Letter not found" });
    res.json(letters.letterContent(row));
  } catch (err) {
    fail(res, err);
  }
}

/** POST /api/admin/students/:id/enrolment-approval {approverRole, note?} */
async function approval(req, res) {
  try {
    const a = await letters.recordApproval(req.params.id, req.body, req.user.userId);
    await logAction(req.user.userId, "RECORD_ENROLMENT_APPROVAL", "enrolment_approvals", a.id, {
      student_id: a.student_id,
      standing_id: a.standing_id,
      approver_role: a.approver_role,
    });
    res.status(201).json(a);
  } catch (err) {
    fail(res, err);
  }
}

/** GET /api/student/warning-letters - own only */
async function studentLetters(req, res) {
  try {
    res.json(await letters.lettersForStudentUser(req.user.userId));
  } catch (err) {
    fail(res, err);
  }
}

/** PUT /api/student/warning-letters/:id/acknowledge - own only */
async function acknowledge(req, res) {
  try {
    const l = await letters.acknowledge(req.params.id, req.user.userId);
    await logAction(req.user.userId, "ACKNOWLEDGE_WARNING_LETTER", "warning_letters", l.id, { level: l.level, roll_no: l.student.roll_no });
    res.json(l);
  } catch (err) {
    fail(res, err);
  }
}

/** GET /api/student/standing - own academic standing (BU rules) for the dashboard card */
async function studentStanding(req, res) {
  try {
    res.json(await getStudentStanding({ userId: req.user.userId }));
  } catch (err) {
    fail(res, err);
  }
}

/** GET /api/admin/students/:id/standing - history, letters and approvals for the student drawer */
async function adminStudentStanding(req, res) {
  try {
    res.json(await getStudentStanding({ studentId: req.params.id, staff: true }));
  } catch (err) {
    fail(res, err);
  }
}

module.exports = { preview, confirm, closes, adminLetters, adminLetter, approval, studentLetters, acknowledge, studentStanding, adminStudentStanding };
