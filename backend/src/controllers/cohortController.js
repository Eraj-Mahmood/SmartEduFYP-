const { logAction } = require("../middleware/audit");
const { importCohort, cohortTemplate } = require("../services/liveCohort");

// Admin live-cohort import (Objective 7). See services/liveCohort.js and docs/LIVE_DATA_TEMPLATE.md.

/** GET /api/admin/live-cohort/template.csv - the header row (column guide: docs/LIVE_DATA_TEMPLATE.md). */
function template(req, res) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="live_cohort_template.csv"');
  res.send(cohortTemplate());
}

/** POST /api/admin/live-cohort?mode=preview|commit (multipart: file, courseId, facultyId, section?, semester?, academicYear?) */
async function importLiveCohort(req, res) {
  try {
    const mode = String(req.query.mode || "preview");
    const out = await importCohort({ mode, file: req.file, body: req.body || {}, userId: req.user.userId });
    if (mode === "commit") {
      await logAction(req.user.userId, "IMPORT_LIVE_COHORT", "uploads", out.upload.id, {
        filename: out.upload.filename,
        status: out.upload.status,
        class: out.class,
        ...out.summary,
      });
    }
    res.json(out);
  } catch (err) {
    if (!err.status) console.error(err);
    res.status(err.status || 500).json({ error: err.message, ...(err.missing ? { missing: err.missing } : {}) });
  }
}

module.exports = { template, importLiveCohort };
