const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../middleware/auth");
const { body, param } = require("express-validator");
const { validate } = require("../middleware/validate");
const ctrl = require("../controllers/adminController");
const tutorials = require("../controllers/tutorialController");
const counselors = require("../controllers/counselorController");
const governance = require("../controllers/governanceController");
const model = require("../controllers/modelController");
const cohort = require("../controllers/cohortController");
const counselling = require("../controllers/counsellingController");
const cs = require("./counsellingRules");
const { singleCsv } = require("../middleware/upload");

router.use(authenticate, authorize("admin"));

// Ids in the URL or the body: positive integers, else 400 (a non-number used to reach the database
// and come back as a raw 500 "invalid input syntax for type integer").
const idParam = (name = "id") => param(name).isInt({ min: 1 }).withMessage(`${name} must be a positive integer`).toInt();
const idField = (name) => body(name).isInt({ min: 1 }).withMessage(`${name} must be a positive integer`).toInt();

// Create forms: checked against the column sizes in database/schema.sql, so bad input is a 400 with a
// plain message instead of a 500 (or a row like age -3 being saved). Optional fields may be left out.
const { ROLL_RE } = require("../services/liveCohort");
const text = (name, min, max) =>
  body(name).isString().withMessage(`${name} is required`).bail().trim().isLength({ min, max }).withMessage(`${name} must be ${min}-${max} characters`);
const emailRule = body("email")
  .isString().withMessage("email is required").bail()
  .trim().toLowerCase()
  .isEmail().withMessage("email must be a valid email address").bail()
  .isLength({ max: 150 }).withMessage("email can be at most 150 characters");
const optionalInt = (name, min, max) =>
  body(name).optional({ values: "null" }).isInt({ min, max }).withMessage(`${name} must be a whole number from ${min} to ${max}`).toInt();
const studentRules = [
  emailRule,
  text("full_name", 1, 150),
  body("roll_no")
    .isString().withMessage("roll_no is required").bail()
    .trim()
    .matches(ROLL_RE).withMessage("roll_no may only use letters, digits and dashes (3-30 characters)"), // same rule as the live-cohort import
  idField("department_id"),
  body("gender").optional({ values: "falsy" }).isIn(["Male", "Female"]).withMessage("gender must be Male or Female"),
  optionalInt("age", 14, 80),
  optionalInt("current_semester", 1, 12),
];
const facultyRules = [
  emailRule,
  text("full_name", 1, 150),
  text("employee_no", 1, 30),
  idField("department_id"),
  body("designation").optional({ values: "null" }).isString().trim().isLength({ max: 100 }).withMessage("designation can be at most 100 characters"),
];
const courseRules = [text("course_code", 2, 20), text("title", 1, 150), idField("department_id"), optionalInt("credit_hours", 1, 6)];
const classRules = [
  idField("faculty_id"),
  idField("course_id"),
  body("section").optional({ values: "falsy" }).isString().trim().isLength({ min: 1, max: 10 }).withMessage("section must be 1-10 characters"),
  body("semester").isInt({ min: 1, max: 12 }).withMessage("semester must be a whole number from 1 to 12").toInt(),
  body("academic_year").isString().withMessage("academic_year is required").bail().trim().matches(/^\d{4}-\d{4}$/).withMessage("academic_year must look like 2025-2026"),
];

router.get("/dashboard", ctrl.dashboard);
router.get("/departments", ctrl.listDepartments);

// User provisioning
router.post("/users/student", studentRules, validate, ctrl.createStudentUser);
router.post("/users/faculty", facultyRules, validate, ctrl.createFacultyUser);
const userIdRule = [param("userId").isInt({ min: 1 }).withMessage("userId must be a positive integer").toInt()];
router.put("/users/:userId/deactivate", userIdRule, validate, governance.deactivateUser);
router.put("/users/:userId/reactivate", userIdRule, validate, governance.reactivateUser);
router.put("/users/:userId/reset-password", userIdRule, validate, governance.resetPassword);

// Audit log viewer
router.get("/audit-log", governance.auditLog);

// Directory (read access to everyone's data)
router.get("/students", ctrl.listStudents);
router.get("/faculty", ctrl.listFaculty);
router.get("/students/:studentId/full", ctrl.studentFullProfile);

// Courses / faculty assignment / enrollment (drop & assign)
router.get("/courses", ctrl.listCourses);
router.post("/courses", courseRules, validate, ctrl.createCourse);
router.get("/faculty-courses", ctrl.listClasses);
router.post("/faculty-courses", classRules, validate, ctrl.assignFacultyToCourse);
router.delete("/faculty-courses/:id", [idParam()], validate, ctrl.unassignFacultyFromCourse);
router.get("/enrollments", ctrl.listEnrollments);
router.post("/enrollments", [idField("student_id"), idField("faculty_course_id")], validate, ctrl.enrollStudent);
router.put("/enrollments/:id/drop", [idParam()], validate, ctrl.dropEnrollment);

// Class records - READ ONLY (no PUT/POST for results or attendance here on purpose)
router.get("/class-records/:facultyCourseId", ctrl.classRecords);

// Interventions
router.get("/at-risk-students", ctrl.atRiskStudents);
router.get("/at-risk-students/export", governance.exportAtRisk);
router.get("/predictions", ctrl.predictionsDetailed);
const messageRules = [
  body("subject").isString().trim().isLength({ min: 1, max: 200 }).withMessage("subject must be 1-200 characters"),
  body("message").isString().trim().isLength({ min: 1, max: 4000 }).withMessage("message must be 1-4000 characters"),
  body("includeTutorial").optional({ values: "null" }).isBoolean().withMessage("includeTutorial must be true or false").toBoolean(),
];
router.post(
  "/notifications",
  [body("recipient_user_id").isInt({ min: 1 }).withMessage("recipient_user_id must be a positive integer").toInt(), ...messageRules],
  validate,
  ctrl.sendNotification
);
router.post(
  "/notifications/bulk",
  [
    body("studentIds").optional().isArray({ min: 1 }).withMessage("studentIds must be a non-empty array"),
    body("studentIds.*").isInt({ min: 1 }).withMessage("each student id must be a positive integer").toInt(),
    body("filter").optional().isObject().withMessage("filter must be an object"),
    body().custom((b) => Array.isArray(b.studentIds) !== (b.filter !== undefined)).withMessage("send either studentIds or filter"),
    ...messageRules,
  ],
  validate,
  ctrl.bulkNotify
);
router.post(
  "/notifications/preview",
  [body("studentId").isInt({ min: 1 }).withMessage("studentId must be a positive integer").toInt(), ...messageRules],
  validate,
  ctrl.previewNotification
);

// Tutorials (study material per course)
const tutorialRules = (optional) => {
  const o = (chain) => (optional ? chain.optional() : chain);
  return [
    o(body("course_id")).isInt({ min: 1 }).withMessage("course_id must be a positive integer").toInt(),
    o(body("title")).isString().trim().isLength({ min: 1, max: 200 }).withMessage("title must be 1-200 characters"),
    o(body("url"))
      .isURL({ protocols: ["http", "https"], require_protocol: true })
      .withMessage("url must be a full http(s) link")
      .isLength({ max: 500 }),
    o(body("kind")).isIn(["video", "notes", "practice"]).withMessage("kind must be video, notes or practice"),
    body("provider").optional({ values: "null" }).isString().trim().isLength({ max: 100 }),
    body("description").optional({ values: "null" }).isString().trim().isLength({ max: 1000 }),
    body("is_active").optional().isBoolean().withMessage("is_active must be true or false").toBoolean(),
  ];
};
router.get("/tutorials", tutorials.list);
router.post("/tutorials", tutorialRules(false), validate, tutorials.create);
router.put("/tutorials/:id", [idParam(), ...tutorialRules(true)], validate, tutorials.update);
router.put("/tutorials/:id/deactivate", [idParam()], validate, tutorials.deactivate);

// Counselor assignments
router.post(
  "/counselors",
  [
    body("studentId").isInt({ min: 1 }).withMessage("studentId must be a positive integer").toInt(),
    body("facultyId").isInt({ min: 1 }).withMessage("facultyId must be a positive integer").toInt(),
  ],
  validate,
  counselors.assign
);
router.put("/counselors/:id/close", [idParam()], validate, counselors.close);
router.get("/counselors", counselors.list);
router.get("/faculty/workload", counselors.workload);

// Counselling sessions (Phase 7): only the admin books, reschedules and cancels; no delete
router.post("/counselling-sessions", cs.scheduleRules, validate, counselling.schedule);
router.get("/counselling-sessions", cs.adminListRules, validate, counselling.adminList);
router.put("/counselling-sessions/:id/reschedule", cs.rescheduleRules, validate, counselling.reschedule);
router.put("/counselling-sessions/:id/cancel", cs.cancelRules, validate, counselling.cancel);
router.put("/counselling-sessions/:id/attendance", cs.attendanceRules, validate, counselling.attendance); // admin override

// Batch re-prediction (background runs)
router.post(
  "/predictions/run",
  [
    body("scope").isIn(["all", "department", "class"]).withMessage('scope must be "all", "department" or "class"'),
    body("scopeId")
      .if(body("scope").isIn(["department", "class"]))
      .isInt({ min: 1 })
      .withMessage("scopeId must be a positive integer for department and class runs")
      .toInt(),
  ],
  validate,
  ctrl.runPredictions
);
// Model transparency (Phase 5): model card + live stats, and the what-if simulator (nothing saved)
router.get("/model", model.modelOverview);
// Live cohort import (Objective 7): template + preview/commit
router.get("/live-cohort/template.csv", cohort.template);
router.post("/live-cohort", singleCsv, cohort.importLiveCohort);
router.post(
  "/students/:studentId/what-if",
  [param("studentId").isInt({ min: 1 }).withMessage("studentId must be a positive integer").toInt()],
  validate,
  model.adminWhatIf
);

router.get("/predictions/runs", ctrl.listPredictionRuns);
router.get("/predictions/runs/:id", [param("id").isInt({ min: 1 }).withMessage("run id must be a positive integer")], validate, ctrl.getPredictionRun);

module.exports = router;
