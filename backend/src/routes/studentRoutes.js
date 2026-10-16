const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../middleware/auth");
const ctrl = require("../controllers/studentController");

router.use(authenticate, authorize("student"));

router.get("/dashboard", ctrl.dashboard);
router.get("/results", ctrl.results);
router.get("/attendance", ctrl.attendance);
router.get("/history", ctrl.history);
router.get("/prediction", ctrl.prediction);
router.get("/prediction/timeline", ctrl.predictionTimeline);
router.get("/next-steps", ctrl.nextSteps);
router.post("/prediction/refresh", ctrl.refreshPrediction); // triggers the helper bot, not a data edit

module.exports = router;
