const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../middleware/auth");
const ctrl = require("../controllers/facultyController");

router.use(authenticate, authorize("faculty"));

router.get("/classes", ctrl.myClasses);
router.get("/classes/:facultyCourseId/roster", ctrl.classRoster);
router.get("/classes/:facultyCourseId/attendance", ctrl.classAttendance);
router.put("/results/:enrollmentId", ctrl.upsertResult);
router.post("/attendance", ctrl.markAttendance);

module.exports = router;
