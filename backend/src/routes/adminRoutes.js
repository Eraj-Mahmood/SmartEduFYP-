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
const { singleCsv } = require("../middleware/upload");

router.use(authenticate, authorize("admin"));

router.get("/dashboard", ctrl.dashboard);
router.get("/departments", ctrl.listDepartments);

// User provisioning
router.post("/users/student", ctrl.createStudentUser);
router.post("/users/faculty", ctrl.createFacultyUser);
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
router.post("/courses", ctrl.createCourse);
router.get("/faculty-courses", ctrl.listClasses);
router.post("/faculty-courses", ctrl.assignFacultyToCourse);
router.delete("/faculty-courses/:id", ctrl.unassignFacultyFromCourse);
router.get("/enrollments", ctrl.listEnrollments);
router.post("/enrollments", ctrl.enrollStudent);
router.put("/enrollments/:id/drop", ctrl.dropEnrollment);

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
const idParam = (name = "id") => param(name).isInt({ min: 1 }).withMessage(`${name} must be a positive integer`).toInt();
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
