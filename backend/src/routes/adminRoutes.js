const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../middleware/auth");
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

module.exports = router;
