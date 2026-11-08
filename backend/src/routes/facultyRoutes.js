const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../middleware/auth");
const { body, param } = require("express-validator");
const { validate } = require("../middleware/validate");
const { MARK_FIELDS } = require("../services/grading");
const { todayLocal } = require("../services/csv");
const ctrl = require("../controllers/facultyController");
const counselors = require("../controllers/counselorController");
const model = require("../controllers/modelController");
const uploads = require("../controllers/uploadController");
const { singleCsv } = require("../middleware/upload");

router.use(authenticate, authorize("faculty"));

const classIdRule = [param("facultyCourseId").isInt({ min: 1 }).withMessage("class id must be a positive integer").toInt()];

const resultRules = [
  param("enrollmentId").isInt({ min: 1 }).withMessage("enrollmentId must be a positive integer").toInt(),
  ...MARK_FIELDS.map((f) =>
    body(f)
      .optional({ values: "null" })
      .isFloat({ min: 0, max: 100 })
      .withMessage(`${f} must be a number between 0 and 100`)
      .toFloat()
  ),
];

const attendanceRules = [
  body("facultyCourseId").isInt({ min: 1 }).withMessage("facultyCourseId must be a positive integer").toInt(),
  body("classDate")
    .isDate({ format: "YYYY-MM-DD", strictMode: true })
    .withMessage("classDate must be a valid date (YYYY-MM-DD)")
    .bail()
    // same rule as the CSV upload (services/uploads.js): no attendance for a day that hasn't happened yet
    .custom((v) => v <= todayLocal())
    .withMessage((v) => `classDate ${v} is in the future`),
  body("entries").isArray({ min: 1 }).withMessage("entries must be a non-empty array"),
  body("entries.*.enrollmentId").isInt({ min: 1 }).withMessage("each entry needs a positive integer enrollmentId").toInt(),
  body("entries.*.status").isIn(["present", "absent", "leave"]).withMessage("each entry status must be present, absent or leave"),
];

router.get("/classes", ctrl.myClasses);
router.get("/summary", ctrl.mySummary);
router.get("/classes/:facultyCourseId/roster", classIdRule, validate, ctrl.classRoster);
router.get("/classes/:facultyCourseId/attendance", classIdRule, validate, ctrl.classAttendance);
router.get("/classes/:facultyCourseId/risk-summary", classIdRule, validate, ctrl.classRiskSummary);
router.put("/results/:enrollmentId", resultRules, validate, ctrl.upsertResult);
router.post("/attendance", attendanceRules, validate, ctrl.markAttendance);

// My counselees (only my own active assignments; 403 for anyone else's)
const counseleeId = [param("id").isInt({ min: 1 }).withMessage("id must be a positive integer").toInt()];
// Bulk uploads (FR13): templates prefilled with the roster, preview/commit, history
router.get("/classes/:facultyCourseId/templates/:template", classIdRule, validate, uploads.template);
router.post("/classes/:facultyCourseId/upload", classIdRule, validate, singleCsv, uploads.upload);
router.get("/uploads", uploads.history);

// What-if simulator (nothing saved): own class students and active counselees only
router.post(
  "/students/:studentId/what-if",
  [param("studentId").isInt({ min: 1 }).withMessage("studentId must be a positive integer").toInt()],
  validate,
  model.facultyWhatIf
);

router.get("/counselees", counselors.myCounselees);
router.get("/counselees/:id", counseleeId, validate, counselors.oneCounselee);
router.put(
  "/counselees/:id",
  [
    ...counseleeId,
    body("notes").optional({ values: "null" }).isString().withMessage("notes must be text").isLength({ max: 5000 }).withMessage("notes can be at most 5000 characters"),
    body("last_contacted_at")
      .optional({ values: "null" })
      .isISO8601()
      .withMessage("last_contacted_at must be a date")
      .custom((v) => new Date(v).getTime() <= Date.now() + 5 * 60 * 1000)
      .withMessage("last_contacted_at can't be in the future"),
    body("close").optional().isBoolean().withMessage("close must be true or false").toBoolean(),
  ],
  validate,
  counselors.updateCounselee
);

module.exports = router;
