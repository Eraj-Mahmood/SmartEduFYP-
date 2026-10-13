const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const ctrl = require("../controllers/notificationController");

// No role restriction here on purpose - students AND faculty can both
// receive notifications from admin, and each only ever sees their own
// (scoped by recipient_user_id = req.user.userId inside the controller).
router.use(authenticate);

router.get("/mine", ctrl.mine);
router.put("/:id/read", ctrl.markRead);
router.put("/read-all", ctrl.markAllRead);

module.exports = router;
