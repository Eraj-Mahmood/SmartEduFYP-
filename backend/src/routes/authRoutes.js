const express = require("express");
const router = express.Router();
const { login, changePassword, me } = require("../controllers/authController");
const { authenticate } = require("../middleware/auth");

router.post("/login", login);
router.post("/change-password", authenticate, changePassword);
router.get("/me", authenticate, me);

module.exports = router;
