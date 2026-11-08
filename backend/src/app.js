// The Express app (routes, middleware, error handler). server.js starts it; tests import it.
require("dotenv").config();
const express = require("express");
const { sendError } = require("./middleware/errors");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const authRoutes = require("./routes/authRoutes");
const studentRoutes = require("./routes/studentRoutes");
const facultyRoutes = require("./routes/facultyRoutes");
const adminRoutes = require("./routes/adminRoutes");
const notificationRoutes = require("./routes/notificationRoutes");

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || "*", credentials: true }));
app.use(express.json());
if (process.env.NODE_ENV !== "test") app.use(morgan("dev"));

// Basic brute-force protection on login (per IP, in memory; configurable via .env)
const loginLimiter = rateLimit({
  windowMs: (Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MIN) || 15) * 60 * 1000,
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 20,
});
app.use("/api/auth/login", loginLimiter);

app.get("/api/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

app.use("/api/auth", authRoutes);
app.use("/api/student", studentRoutes);
app.use("/api/faculty", facultyRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/notifications", notificationRoutes);

// 404
app.use((req, res) => res.status(404).json({ error: "Not found" }));

// Central error handler: a 4xx error keeps its message (e.g. malformed JSON -> 400); anything else is
// logged and answered with a plain message, never the raw error (middleware/errors.js)
app.use((err, req, res, next) => sendError(res, err));

module.exports = app;
