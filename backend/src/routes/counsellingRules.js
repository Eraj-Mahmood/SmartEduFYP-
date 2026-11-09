const { body, param, query } = require("express-validator");
const { DISPLAY_LABELS } = require("../services/counsellingSessions");

// express-validator rules for the counselling-session routes (admin, faculty, student).
// The service re-checks the time rules (future, within 60 days) against the clock at write time.

// A date and time with its time zone, so "11:00" can't be read in the server's zone by mistake.
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

const sessionId = [param("id").isInt({ min: 1 }).withMessage("session id must be a positive integer").toInt()];

const scheduledAt = body("scheduledAt")
  .isString().withMessage("scheduledAt is required").bail()
  .matches(ISO_WITH_ZONE).withMessage("scheduledAt must be a date and time with a time zone, e.g. 2026-11-18T11:00:00+05:00").bail()
  .custom((v) => !Number.isNaN(new Date(v).getTime())).withMessage("scheduledAt must be a real date and time");

const optional = (chain, required) => (required ? chain : chain.optional({ values: "undefined" }));

const details = (required) => [
  optional(body("durationMin"), false).isInt({ min: 15, max: 120 }).withMessage("durationMin must be a whole number from 15 to 120").toInt(),
  optional(body("mode"), required).isIn(["in_person", "online"]).withMessage("mode must be in_person or online"),
  optional(body("location"), required)
    .isString().withMessage("location is required").bail()
    .trim().isLength({ min: 1, max: 300 }).withMessage("location must be 1-300 characters (a room or a meeting link)"),
  body("agenda").optional({ values: "null" }).isString().withMessage("agenda must be text").bail()
    .trim().isLength({ max: 1000 }).withMessage("agenda can be at most 1000 characters"),
];

const scheduleRules = [
  body("studentId").isInt({ min: 1 }).withMessage("studentId must be a positive integer").toInt(),
  body("facultyId").optional({ values: "null" }).isInt({ min: 1 }).withMessage("facultyId must be a positive integer").toInt(),
  scheduledAt,
  ...details(true),
  body("reason").optional({ values: "null" }).isIn(["manual", "risk", "probation"]).withMessage("reason must be manual, risk or probation"),
  body("reassign").optional({ values: "null" }).isBoolean({ strict: true }).withMessage("reassign must be true or false").toBoolean(),
];

const rescheduleRules = [...sessionId, scheduledAt, ...details(false)];

const cancelRules = [
  ...sessionId,
  body("reason").isString().withMessage("A reason for cancelling is required").bail()
    .trim().isLength({ min: 1, max: 500 }).withMessage("reason must be 1-500 characters"),
];

const attendanceRules = [
  ...sessionId,
  body("attendance").isIn(["present", "absent"]).withMessage("attendance must be present or absent"),
  body("notes").optional({ values: "null" }).isString().withMessage("notes must be text").bail()
    .trim().isLength({ max: 4000 }).withMessage("notes can be at most 4000 characters"),
];

const optionalId = (name) => query(name).optional().isInt({ min: 1 }).withMessage(`${name} must be a positive integer`).toInt();
const optionalDate = (name) =>
  query(name).optional().isDate({ format: "YYYY-MM-DD", strictMode: true }).withMessage(`${name} must be a date (YYYY-MM-DD)`);

const adminListRules = [
  optionalId("counsellor"),
  optionalId("student"),
  query("search").optional().isString().trim().isLength({ max: 100 }).withMessage("search can be at most 100 characters"),
  query("status").optional().isIn(Object.keys(DISPLAY_LABELS)).withMessage(`status must be one of: ${Object.keys(DISPLAY_LABELS).join(", ")}`),
  optionalDate("from"),
  optionalDate("to"),
  query("page").optional().isInt({ min: 1 }).withMessage("page must be a positive integer").toInt(),
  query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("limit must be a whole number from 1 to 100").toInt(),
];

const facultyListRules = [query("view").optional().isIn(["upcoming", "history"]).withMessage("view must be upcoming or history")];

module.exports = { scheduleRules, rescheduleRules, cancelRules, attendanceRules, adminListRules, facultyListRules };
