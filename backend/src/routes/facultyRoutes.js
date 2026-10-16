const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../middleware/auth");
const { body, param } = require("express-validator");
const { validate } = require("../middleware/validate");
const { MARK_FIELDS } = require("../services/grading");
const ctrl = require("../controllers/facultyController");

router.use(authenticate, authorize("faculty"));

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
  body("classDate").isDate({ format: "YYYY-MM-DD", strictMode: true }).withMessage("classDate must be a valid date (YYYY-MM-DD)"),
  body("entries").isArray({ min: 1 }).withMessage("entries must be a non-empty array"),
  body("entries.*.enrollmentId").isInt({ min: 1 }).withMessage("each entry needs a positive integer enrollmentId").toInt(),
  body("entries.*.status").isIn(["present", "absent", "leave"]).withMessage("each entry status must be present, absent or leave"),
];

router.get("/classes", ctrl.myClasses);
router.get("/classes/:facultyCourseId/roster", ctrl.classRoster);
router.get("/classes/:facultyCourseId/attendance", ctrl.classAttendance);
router.put("/results/:enrollmentId", resultRules, validate, ctrl.upsertResult);
router.post("/attendance", attendanceRules, validate, ctrl.markAttendance);

module.exports = router;
