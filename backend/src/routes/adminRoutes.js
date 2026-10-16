const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../middleware/auth");
const { body, param } = require("express-validator");
const { validate } = require("../middleware/validate");
const ctrl = require("../controllers/adminController");

router.use(authenticate, authorize("admin"));

router.get("/dashboard", ctrl.dashboard);
router.get("/departments", ctrl.listDepartments);

// User provisioning
router.post("/users/student", ctrl.createStudentUser);
router.post("/users/faculty", ctrl.createFacultyUser);
router.put("/users/:userId/deactivate", ctrl.deactivateUser);

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
router.get("/predictions", ctrl.predictionsDetailed);
router.post("/notifications", ctrl.sendNotification);

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
router.get("/predictions/runs", ctrl.listPredictionRuns);
router.get("/predictions/runs/:id", [param("id").isInt({ min: 1 }).withMessage("run id must be a positive integer")], validate, ctrl.getPredictionRun);

module.exports = router;
