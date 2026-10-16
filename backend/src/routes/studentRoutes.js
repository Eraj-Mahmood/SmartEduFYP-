const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { body } = require("express-validator");
const { authenticate, authorize } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const ctrl = require("../controllers/studentController");
const chat = require("../controllers/chatController");

router.use(authenticate, authorize("student"));

// Chat: per logged-in user (not per IP), CHAT_RATE_LIMIT_PER_MIN messages a minute (default 20)
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.CHAT_RATE_LIMIT_PER_MIN) || 20,
  keyGenerator: (req) => `chat:${req.user.userId}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "You're sending messages too quickly. Please wait a minute and try again." },
});
const chatRules = [
  body("message")
    .isString()
    .withMessage("message must be text")
    .bail()
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("message must be 1-500 characters"),
];

router.get("/dashboard", ctrl.dashboard);
router.get("/results", ctrl.results);
router.get("/attendance", ctrl.attendance);
router.get("/history", ctrl.history);
router.get("/prediction", ctrl.prediction);
router.get("/prediction/timeline", ctrl.predictionTimeline);
router.get("/next-steps", ctrl.nextSteps);
router.post("/prediction/refresh", ctrl.refreshPrediction); // triggers the helper bot, not a data edit
router.post("/chat", chatLimiter, chatRules, validate, chat.send);
router.get("/chat/history", chat.history);
router.delete("/chat/history", chat.clear);

module.exports = router;
