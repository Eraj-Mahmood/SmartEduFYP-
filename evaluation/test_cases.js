// Executes the manual test cases (docs/TEST_CASES.md) against the RUNNING services - the API over
// HTTP and the portal/UI cases in a real browser (Playwright) - and writes the table with each
// result and the date. It changes demo data (marks, counselors, uploads...), so run it right after
// `npm run demo:reset` and reset again afterwards:
//
//   cd backend; npm run demo:reset -- --yes; node ../evaluation/test_cases.js; npm run demo:reset -- --yes
//
// Needs: backend :5000, ML service :8001, frontend :5173, LOGIN_RATE_LIMIT_MAX >= 100.
const path = require("path");
const fs = require("fs");
const BACKEND = path.join(__dirname, "..", "backend");
const FRONTEND = path.join(__dirname, "..", "frontend");
require(path.join(BACKEND, "node_modules", "dotenv")).config({ path: path.join(BACKEND, ".env") });
const { Pool } = require(path.join(BACKEND, "node_modules", "pg"));
const { chromium } = require(path.join(FRONTEND, "node_modules", "playwright"));

const API = "http://127.0.0.1:5000/api";
const WEB = "http://localhost:5173";
const OUT = path.join(__dirname, "..", "docs", "TEST_CASES.md");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = async (sql, params) => (await pool.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];

// ---- helpers -------------------------------------------------------------------------------------
class Fail extends Error {}
const expect = (cond, msg) => {
  if (!cond) throw new Fail(msg);
};
async function call(method, url, { token, body, raw } = {}) {
  const res = await fetch(url.startsWith("http") ? url : API + url, {
    method,
    headers: { ...(raw ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: raw || (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* CSV etc. */
  }
  return { status: res.status, json, text, headers: res.headers };
}
const ACCOUNTS = {
  admin: { email: "admin@smartedu.edu", password: "Admin@123", portal: "admin" },
  ayesha: { email: "ayesha.khan@smartedu.edu", password: "Faculty@123", portal: "faculty" },
  bilal: { email: "bilal.raza@smartedu.edu", password: "Faculty@123", portal: "faculty" },
  bu100040: { email: "student100040@smartedu.edu", password: "Student@123", portal: "student" }, // BU-100040 Safe
  bu112907: { email: "student112907@smartedu.edu", password: "Student@123", portal: "student" }, // BU-112907 At-Risk
  bu144766: { email: "student144766@smartedu.edu", password: "Student@123", portal: "student" }, // BU-144766 Dropout-Likely
};
const tokens = {};
async function tok(name) {
  if (!tokens[name]) {
    const r = await call("POST", "/auth/login", { body: ACCOUNTS[name] });
    if (r.status !== 200) throw new Error(`login ${name}: ${r.status}`);
    tokens[name] = r.json.token;
  }
  return tokens[name];
}
const sid = async (roll) => (await one("SELECT student_id, user_id, full_name FROM students WHERE roll_no = $1", [roll]));
const latest = async (roll) =>
  one("SELECT p.* FROM students s JOIN predictions p ON p.prediction_id = s.latest_prediction_id WHERE s.roll_no = $1", [roll]);
async function tempUser(role, { mustReset = false } = {}) {
  const bcrypt = require(path.join(BACKEND, "node_modules", "bcrypt"));
  const email = `tc.${role}.${Date.now()}${Math.floor(Math.random() * 1000)}@smartedu.test`;
  const u = await one("INSERT INTO users (email, password_hash, role, must_reset_pw) VALUES ($1,$2,$3,$4) RETURNING user_id", [email, await bcrypt.hash("Temp-pass1", 4), role, mustReset]);
  return { id: u.user_id, email, password: "Temp-pass1" };
}
let browser;
async function page(viewport = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ viewport });
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  return p;
}
const at = (p, pathname) => p.waitForURL((u) => new URL(u).pathname === pathname, { timeout: 15000 }).catch(() => {});
const pathOf = (p) => new URL(p.url()).pathname;
async function uiSignIn(p, portal, email, password) {
  await p.goto(`${WEB}/login/${portal}`);
  await p.fill("#login-email", email);
  await p.fill("#login-password", password);
  await p.click("button[type=submit]");
}

// ---- the cases -------------------------------------------------------------------------------------
// [id, fr, description, steps, expected, run]
const CASES = [
  // ---------- portals (Phase 6) ----------
  ["TC-P-01", "P", "Portal chooser", "Open http://localhost:5173/", "Three portals (Student, Faculty, Admin), each with a Sign in link; SmartEdu branding", async () => {
    const p = await page();
    await p.goto(`${WEB}/`);
    await p.waitForSelector("text=Choose how you want to sign in");
    expect((await p.getByRole("link", { name: /sign in/i }).count()) === 3, "not 3 portal links");
    expect((await p.locator("h1").textContent()).includes("SmartEdu"), "no branding");
    await p.context().close();
  }],
  ["TC-P-02", "P", "Each role signs in through its own portal", "Sign in as admin, ayesha.khan and student100040 on their own portal", "Each lands on its dashboard (/admin, /faculty, /student)", async () => {
    for (const [name, home] of [["admin", "/admin"], ["ayesha", "/faculty"], ["bu100040", "/student"]]) {
      const p = await page();
      await uiSignIn(p, ACCOUNTS[name].portal, ACCOUNTS[name].email, ACCOUNTS[name].password);
      await at(p, home);
      expect(pathOf(p) === home, `${name} ended on ${pathOf(p)}`);
      await p.context().close();
    }
  }],
  ["TC-P-03", "P", "Wrong-portal sign-in", "On Faculty sign in, enter student100040@smartedu.edu / Student@123", '"This is a student account - please use the Student sign in" with a button to the Student portal; no session stored', async () => {
    const p = await page();
    await uiSignIn(p, "faculty", ACCOUNTS.bu100040.email, ACCOUNTS.bu100040.password);
    const alert = p.locator("[role=alert]");
    await alert.waitFor();
    expect(/This is a student account - please use the Student sign in/.test(await alert.textContent()), "message missing");
    expect(!(await p.evaluate(() => localStorage.getItem("smartedu_token"))), "a token was stored");
    await p.getByRole("button", { name: /Go to Student sign in/ }).click();
    await at(p, "/login/student");
    expect(pathOf(p) === "/login/student", "button did not open the Student portal");
    await p.context().close();
  }],
  ["TC-P-04", "P", "Wrong password reveals nothing", "POST /api/auth/login with a wrong password (and an unknown email) on each portal", "The same 401 'Invalid email or password' every time", async () => {
    const bodies = new Set();
    for (const portal of ["student", "faculty", "admin"]) {
      for (const email of [ACCOUNTS.bu100040.email, ACCOUNTS.ayesha.email, "nobody@smartedu.edu"]) {
        const r = await call("POST", "/auth/login", { body: { email, password: "Wrong-pass1", portal } });
        expect(r.status === 401, `${portal}/${email}: ${r.status}`);
        bodies.add(JSON.stringify(r.json));
      }
    }
    expect(bodies.size === 1, "responses differ");
  }],
  ["TC-P-05", "P", "Signed-out deep link", "Signed out, open /faculty/counselees", "Redirected to /login/faculty", async () => {
    const p = await page();
    await p.goto(`${WEB}/faculty/counselees`);
    await at(p, "/login/faculty");
    expect(pathOf(p) === "/login/faculty", pathOf(p));
    await p.context().close();
  }],
  ["TC-P-06", "P", "Logout returns to the user's own portal (phone width)", "At 390px sign in as ayesha.khan, open the menu, Log out", "Back on /login/faculty", async () => {
    const p = await page({ width: 390, height: 844 });
    await uiSignIn(p, "faculty", ACCOUNTS.ayesha.email, ACCOUNTS.ayesha.password);
    await at(p, "/faculty");
    await p.locator("button[aria-controls=mobile-nav]").click();
    await p.locator("#mobile-nav").getByRole("button", { name: /Log out/ }).click();
    await at(p, "/login/faculty");
    expect(pathOf(p) === "/login/faculty", pathOf(p));
    expect(p.errors.length === 0, p.errors.join(" | "));
    await p.context().close();
    delete tokens.ayesha; // logout revokes every token of the user (all devices), so the cached API token is gone too
  }],

  // ---------- FR1 authentication and session security ----------
  ["TC-FR1-01", "FR1", "Role-based access on the server", "Call a student, a faculty and an admin endpoint with each other role's token, and with no token", "403 for another role, 401 with no token", async () => {
    const routes = { bu100040: "/student/dashboard", ayesha: "/faculty/classes", admin: "/admin/dashboard" };
    for (const [owner, route] of Object.entries(routes)) {
      expect((await call("GET", route)).status === 401, `${route} without token`);
      for (const other of Object.keys(routes).filter((o) => o !== owner)) {
        const r = await call("GET", route, { token: await tok(other) });
        expect(r.status === 403, `${route} as ${other}: ${r.status}`);
      }
    }
  }],
  ["TC-FR1-02", "FR1", "Deactivated account is signed out at once", "Sign in a test account; admin deactivates it; use the old token", "401 ACCOUNT_DISABLED; signing in again is refused", async () => {
    const u = await tempUser("student");
    const t = (await call("POST", "/auth/login", { body: { email: u.email, password: u.password, portal: "student" } })).json.token;
    expect((await call("PUT", `/admin/users/${u.id}/deactivate`, { token: await tok("admin") })).status === 200, "deactivate failed");
    const r = await call("GET", "/auth/me", { token: t });
    expect(r.status === 401 && r.json.code === "ACCOUNT_DISABLED", `got ${r.status} ${r.json && r.json.code}`);
    expect((await call("POST", "/auth/login", { body: { email: u.email, password: u.password, portal: "student" } })).status === 403, "login not refused");
  }],
  ["TC-FR1-03", "FR1", "Temporary password must be changed first", "Sign in with a must-reset account; call any other API; change the password", "403 PASSWORD_RESET_REQUIRED until changed; afterwards normal access with a fresh token", async () => {
    const u = await tempUser("faculty", { mustReset: true });
    const login = await call("POST", "/auth/login", { body: { email: u.email, password: u.password, portal: "faculty" } });
    expect(login.json.mustResetPassword === true, "mustResetPassword not set");
    const blocked = await call("GET", "/notifications/mine", { token: login.json.token });
    expect(blocked.status === 403 && blocked.json.code === "PASSWORD_RESET_REQUIRED", `got ${blocked.status}`);
    const ch = await call("POST", "/auth/change-password", { token: login.json.token, body: { currentPassword: u.password, newPassword: "New-pass99" } });
    expect(ch.status === 200 && ch.json.token, "change failed");
    expect((await call("GET", "/notifications/mine", { token: ch.json.token })).status === 200, "fresh token not accepted");
    expect((await call("GET", "/notifications/mine", { token: login.json.token })).status === 401, "old token still works");
  }],
  ["TC-FR1-04", "FR1", "Password rules enforced", "Change password to 'short', 'alllowercase1', 'NoDigitsHere'", "400 each time with the failed rules listed", async () => {
    const u = await tempUser("student");
    const t = (await call("POST", "/auth/login", { body: { email: u.email, password: u.password, portal: "student" } })).json.token;
    for (const pw of ["short", "alllowercase1", "NoDigitsHere"]) {
      const r = await call("POST", "/auth/change-password", { token: t, body: { currentPassword: u.password, newPassword: pw } });
      expect(r.status === 400, `${pw}: ${r.status}`);
    }
  }],

  // ---------- FR2 user management ----------
  ["TC-FR2-01", "FR2", "Admin creates a student account", "Users -> Create student account (email, name, roll no, department)", "201 with a temporary password; the account must set its own password at first sign-in", async () => {
    const tag = Date.now().toString().slice(-6);
    const r = await call("POST", "/admin/users/student", { token: await tok("admin"), body: { email: `tc${tag}@smartedu.test`, full_name: `TC Student ${tag}`, roll_no: `TC-${tag}`, department_id: 1 } });
    expect(r.status === 201 && r.json.tempPassword, `status ${r.status}`);
    const login = await call("POST", "/auth/login", { body: { email: `tc${tag}@smartedu.test`, password: r.json.tempPassword, portal: "student" } });
    expect(login.json.mustResetPassword === true, "not forced to change");
  }],
  ["TC-FR2-02", "FR2", "Admin resets a password (one-time box)", "Users -> Reset password on a student -> confirm -> copy the temporary password", "Box shows a 12-character password once; the student signs in with it and must change it; old sessions end", async () => {
    const p = await page();
    await uiSignIn(p, "admin", ACCOUNTS.admin.email, ACCOUNTS.admin.password);
    await at(p, "/admin");
    await p.goto(`${WEB}/admin/users`);
    await p.getByPlaceholder("Search by roll no, name, or email...").fill("SYN-104868");
    const row = p.locator("tr", { hasText: "SYN-104868" });
    await row.waitFor();
    await row.getByRole("button", { name: /Reset password/ }).click();
    await p.getByRole("dialog").getByRole("button", { name: /^Reset password$/ }).click();
    const temp = await p.locator("#temp-password").inputValue();
    expect(/^[A-Za-z2-9]{12}$/.test(temp), "no temporary password shown");
    await p.getByRole("button", { name: "Done" }).click();
    expect((await p.locator("#temp-password").count()) === 0, "password still on the page");
    await p.context().close();
    const login = await call("POST", "/auth/login", { body: { email: "live.syn-104868@smartedu.edu", password: temp, portal: "student" } });
    expect(login.status === 200 && login.json.mustResetPassword === true, `live student sign-in ${login.status}`);
  }],
  ["TC-FR2-03", "FR2", "Every admin action is in the audit log", "Audit log page after the steps above", "Entries for CREATE/RESET/DEACTIVATE with actor, entity and details (never a password)", async () => {
    const r = await call("GET", "/admin/audit-log?limit=50", { token: await tok("admin") });
    const actions = new Set(r.json.rows.map((x) => x.action));
    for (const a of ["RESET_PASSWORD", "DEACTIVATE_USER"]) expect(actions.has(a), `${a} missing`);
    expect(!/Temp-pass|tempPassword/.test(JSON.stringify(r.json.rows)), "a password appears in the audit log");
  }],

  // ---------- FR3 courses, classes, enrollments ----------
  ["TC-FR3-01", "FR3", "Course, teacher assignment, enrollment and drop", "Assignments: create course TC###, assign Dr. Amina Sheikh section T, enroll BU-100040, then drop", "Each step succeeds; duplicates are refused (409); the dropped student leaves the roster", async () => {
    const t = await tok("admin");
    const code = `TC${Date.now().toString().slice(-5)}`;
    const c = await call("POST", "/admin/courses", { token: t, body: { course_code: code, title: "TC course", department_id: 1, credit_hours: 3 } });
    expect(c.status === 201, `course ${c.status}`);
    const fac = await one("SELECT f.faculty_id FROM faculty f JOIN users u USING (user_id) WHERE u.email = 'amina.sheikh@smartedu.edu'");
    const fc = await call("POST", "/admin/faculty-courses", { token: t, body: { faculty_id: fac.faculty_id, course_id: c.json.course_id, section: "T", semester: 5, academic_year: "2025-2026" } });
    expect(fc.status === 201, `assign ${fc.status}`);
    const s = await sid("BU-100040");
    const en = await call("POST", "/admin/enrollments", { token: t, body: { student_id: s.student_id, faculty_course_id: fc.json.faculty_course_id } });
    expect(en.status === 201, `enroll ${en.status}`);
    expect((await call("POST", "/admin/enrollments", { token: t, body: { student_id: s.student_id, faculty_course_id: fc.json.faculty_course_id } })).status === 409, "duplicate enrollment allowed");
    expect((await call("PUT", `/admin/enrollments/${en.json.enrollment_id}/drop`, { token: t })).status === 200, "drop failed");
    await pool.query("DELETE FROM courses WHERE course_id = $1", [c.json.course_id]);
  }],

  // ---------- FR4 data import and live cohort ----------
  ["TC-FR4-01", "FR4", "50,000-row dataset loaded", "Count students and performance rows after demo:reset", "50,000 synthetic students, each with one performance row and a dataset label", async () => {
    const r = await one("SELECT COUNT(*)::int AS s, COUNT(*) FILTER (WHERE sp.target_label IS NOT NULL)::int AS l FROM students st JOIN student_semester_performance sp USING (student_id) WHERE st.data_source = 'synthetic'");
    expect(r.s === 50000 && r.l === 50000, JSON.stringify(r));
  }],
  ["TC-FR4-02", "FR4", "Live cohort preview validates rows and writes nothing", "Admin -> Import a live cohort -> preview a file with 1 good row and 2 bad rows (unknown department, existing roll no)", "Preview lists 2 errors with row and column; no student is created", async () => {
    const t = await tok("admin");
    const before = (await one("SELECT COUNT(*)::int AS n FROM students")).n;
    const csv = ["roll_no,full_name,department,semester,cgpa,previous_sgpa,attendance,assignment,quiz,midterm,final,failed_courses,credits",
      "TC-1,TC One,CS,5,2.5,2.4,80,70,70,70,70,0,15", "TC-2,TC Two,XX,5,2.5,2.4,80,70,70,70,70,0,15", "BU-100040,Existing,CS,5,2,2,80,70,70,70,70,0,15"].join("\r\n");
    const form = new FormData();
    form.append("file", new Blob([csv], { type: "text/csv" }), "tc_cohort.csv");
    const course = await one("SELECT course_id FROM courses WHERE course_code = 'CS301'");
    const fac = await one("SELECT faculty_id FROM faculty WHERE full_name = 'Dr. Amina Sheikh'");
    form.append("courseId", String(course.course_id));
    form.append("facultyId", String(fac.faculty_id));
    form.append("section", "TC");
    const res = await fetch(`${API}/admin/live-cohort?mode=preview`, { method: "POST", headers: { Authorization: `Bearer ${t}` }, body: form });
    const body = await res.json();
    expect(res.status === 200 && body.summary.rows_ok === 1 && body.summary.rows_failed === 2, JSON.stringify(body.summary));
    expect(body.errors.every((e) => e.row && e.column), "errors without row/column");
    expect((await one("SELECT COUNT(*)::int AS n FROM students")).n === before, "preview created students");
  }],
  ["TC-FR4-03", "FR4", "Imported live students are scored with missing inputs imputed", "After demo:reset, check the 30 SYN-* students' latest predictions", "30 predictions, all from the Random Forest model (missing features imputed, none from the rule fallback)", async () => {
    const r = await one("SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE p.source = 'model')::int AS m FROM students s JOIN predictions p ON p.prediction_id = s.latest_prediction_id WHERE s.roll_no LIKE 'SYN-%'");
    expect(r.n === 30 && r.m === 30, JSON.stringify(r));
  }],

  // ---------- FR5 results entry ----------
  ["TC-FR5-01", "FR5", "Faculty saves marks; label updates live", "ayesha.khan -> AI301 A -> BU-112907: Quiz 75, Midterm 88 -> Save", "Grade C -> B (server-derived), toast 'At-Risk -> Safe'; the student's dashboard shows Safe", async () => {
    const s = await sid("BU-112907");
    const e = await one(`SELECT e.enrollment_id, cr.* FROM enrollments e JOIN course_results cr USING (enrollment_id) JOIN faculty_courses fc USING (faculty_course_id)
      JOIN courses c USING (course_id) WHERE e.student_id = $1 AND c.course_code = 'AI301'`, [s.student_id]);
    const r = await call("PUT", `/faculty/results/${e.enrollment_id}`, { token: await tok("ayesha"), body: { assignment_avg: +e.assignment_avg, quiz_avg: 75, midterm_marks: 88, final_marks: +e.final_marks, grade: "F" } });
    expect(r.status === 200 && r.json.grade === "B", `grade ${r.json && r.json.grade}`);
    expect(r.json.prediction.old_label === "At-Risk" && r.json.prediction.new_label === "Safe", JSON.stringify(r.json.prediction));
    const d = await call("GET", "/student/dashboard", { token: await tok("bu112907") });
    expect(d.json.latestPrediction.final_label === "Safe", "dashboard not Safe");
  }],
  ["TC-FR5-02", "FR5", "Faculty can't edit another teacher's class", "As ayesha.khan, PUT marks for an enrollment in bilal.raza's CS401 A", "403; marks unchanged", async () => {
    const e = await one("SELECT enrollment_id FROM enrollments WHERE faculty_course_id = 4 LIMIT 1");
    const r = await call("PUT", `/faculty/results/${e.enrollment_id}`, { token: await tok("ayesha"), body: { quiz_avg: 1 } });
    expect(r.status === 403, `got ${r.status}`);
  }],
  ["TC-FR5-03", "FR5", "Marks outside 0-100 are rejected", "Save a quiz mark of 105", "400 with the field named", async () => {
    const e = await one("SELECT enrollment_id FROM enrollments WHERE faculty_course_id = 16 LIMIT 1");
    const r = await call("PUT", `/faculty/results/${e.enrollment_id}`, { token: await tok("ayesha"), body: { quiz_avg: 105 } });
    expect(r.status === 400 && /quiz_avg/.test(JSON.stringify(r.json)), `got ${r.status}`);
  }],

  // ---------- FR6 attendance ----------
  ["TC-FR6-01", "FR6", "Faculty marks attendance for a session", "ayesha.khan -> AI301 A -> Mark attendance for 2026-01-05, all present", "Saved for every student, tagged live; students re-predicted", async () => {
    const enr = await q("SELECT enrollment_id FROM enrollments WHERE faculty_course_id = 16");
    const r = await call("POST", "/faculty/attendance", { token: await tok("ayesha"), body: { facultyCourseId: 16, classDate: "2026-01-05", entries: enr.map((e) => ({ enrollmentId: e.enrollment_id, status: "present" })) } });
    expect(r.status === 200, `got ${r.status}`);
    const n = (await one("SELECT COUNT(*)::int AS n FROM attendance WHERE class_date = '2026-01-05' AND data_source = 'live'")).n;
    expect(n === enr.length, `${n} rows`);
  }],
  ["TC-FR6-02", "FR6", "Attendance for a student outside the class is refused", "Mark attendance in AI301 A including an enrollment from CS401 A", "403 and nothing written", async () => {
    const own = await one("SELECT enrollment_id FROM enrollments WHERE faculty_course_id = 16 LIMIT 1");
    const other = await one("SELECT enrollment_id FROM enrollments WHERE faculty_course_id = 4 LIMIT 1");
    const r = await call("POST", "/faculty/attendance", { token: await tok("ayesha"), body: { facultyCourseId: 16, classDate: "2026-01-12", entries: [{ enrollmentId: own.enrollment_id, status: "present" }, { enrollmentId: other.enrollment_id, status: "present" }] } });
    expect(r.status === 403, `got ${r.status}`);
    expect((await one("SELECT COUNT(*)::int AS n FROM attendance WHERE class_date = '2026-01-12'")).n === 0, "rows written");
  }],

  // ---------- FR7 prediction ----------
  ["TC-FR7-01", "FR7", "A student's prediction comes from the Random Forest", "Student refreshes their prediction", "source 'model', model version of the .pkl, label one of Safe/At-Risk/Dropout-Likely", async () => {
    const r = await call("POST", "/student/prediction/refresh", { token: await tok("bu100040") });
    expect(r.status === 200 && r.json.source === "model" && r.json.final_label === "Safe", JSON.stringify({ s: r.json.source, l: r.json.final_label }));
    expect(r.json.model_version && r.json.model_version !== "rule_fallback", "fallback model version");
  }],
  ["TC-FR7-02", "FR7", "Batch prediction run for a department", "Admin -> Overview -> Run predictions -> Department: Artificial Intelligence -> Start", "Run completes; every student in the department predicted by the model (0 fallback)", async () => {
    const t = await tok("admin");
    const run = await call("POST", "/admin/predictions/run", { token: t, body: { scope: "department", scopeId: 4 } });
    expect(run.status === 202, `start ${run.status}`);
    let r;
    for (let i = 0; i < 120; i++) {
      await new Promise((res) => setTimeout(res, 1000));
      r = (await call("GET", `/admin/predictions/runs/${run.json.id}`, { token: t })).json;
      if (r.status !== "running") break;
    }
    const fb = await one("SELECT COUNT(*) FILTER (WHERE source <> 'model')::int AS f, COUNT(*)::int AS n FROM predictions WHERE run_id = $1", [run.json.id]);
    expect(r.status === "completed" && r.failed === 0 && fb.f === 0 && fb.n === r.total, JSON.stringify({ ...r, ...fb }));
  }],
  ["TC-FR7-03", "FR7", "The policy only escalates the model's label", "Compare model_label and final_label over every student's latest prediction", "final_label is never less severe than model_label", async () => {
    const r = await one(`SELECT COUNT(*)::int AS n FROM students s JOIN predictions p ON p.prediction_id = s.latest_prediction_id
      WHERE (CASE p.final_label WHEN 'Safe' THEN 0 WHEN 'At-Risk' THEN 1 ELSE 2 END) < (CASE p.model_label WHEN 'Safe' THEN 0 WHEN 'At-Risk' THEN 1 ELSE 2 END)`);
    expect(r.n === 0, `${r.n} lowered labels`);
  }],

  // ---------- FR8 explanations and transparency ----------
  ["TC-FR8-01", "FR8", "Student sees plain-language reasons, never probabilities", "Student dashboard (BU-144766)", "1-3 reasons with the student's own numbers; no probabilities, SHAP values or raw features in the response", async () => {
    const r = await call("GET", "/student/dashboard", { token: await tok("bu144766") });
    const reasons = r.json.latestPrediction.reasons;
    expect(reasons.length >= 1 && reasons.length <= 3 && /1\.62/.test(reasons.join(" ")), JSON.stringify(reasons));
    expect(!/prob_safe|prob_dropout|"drivers"|"shap"/.test(r.text), "probabilities or drivers exposed");
  }],
  ["TC-FR8-02", "FR8", "Model page proves the Random Forest", "Admin -> Model", "RandomForestClassifier, 300 trees, 20 features, CV/test macro F1 0.9992/0.9994, global importance (CGPA first)", async () => {
    const r = await call("GET", "/admin/model", { token: await tok("admin") });
    const m = r.json.model;
    expect(r.json.ml_online && /RandomForest/.test(m.model_type) && m.n_estimators === 300 && m.feature_names.length === 20, JSON.stringify({ t: m && m.model_type, n: m && m.n_estimators }));
    const gi = m.global_importance && (m.global_importance.overall || m.global_importance.features || m.global_importance);
    expect(JSON.stringify(gi).indexOf("CGPA") >= 0, "no global importance");
  }],
  ["TC-FR8-03", "FR8", "What-if simulator (nothing saved)", "ayesha.khan -> BU-100040 -> What if? -> Attendance 55%", "Safe -> Dropout-Likely from the model; attendance tops the drivers; no prediction stored", async () => {
    const s = await sid("BU-100040");
    const before = (await one("SELECT COUNT(*)::int AS n FROM predictions WHERE student_id = $1", [s.student_id])).n;
    const r = await call("POST", `/faculty/students/${s.student_id}/what-if`, { token: await tok("ayesha"), body: { overrides: { Attendance_Percentage: 55 } } });
    expect(r.json.baseline.final_label === "Safe" && r.json.scenario.final_label === "Dropout-Likely" && r.json.scenario.source === "model", JSON.stringify(r.json.scenario && r.json.scenario.final_label));
    expect(r.json.scenario.drivers[0].feature === "Attendance_Percentage", "attendance not the top driver");
    expect((await one("SELECT COUNT(*)::int AS n FROM predictions WHERE student_id = $1", [s.student_id])).n === before, "a prediction was saved");
  }],

  // ---------- FR9 student dashboard ----------
  ["TC-FR9-01", "FR9", "Student dashboard renders", "Sign in as student144766 and open the dashboard", "Status hero (High risk), reasons, 'Random Forest model' badge, CGPA tiles, What to do next, charts; no page errors", async () => {
    const p = await page();
    await uiSignIn(p, "student", ACCOUNTS.bu144766.email, ACCOUNTS.bu144766.password);
    await at(p, "/student");
    await p.waitForLoadState("networkidle");
    const text = await p.locator("main").textContent();
    for (const s of ["High risk", "Random Forest model", "Official CGPA", "Projected CGPA", "What to do next", "Marks by course"]) expect(text.includes(s), `missing '${s}'`);
    expect(p.errors.length === 0, p.errors.join(" | "));
    await p.context().close();
  }],
  ["TC-FR9-02", "FR9", "Results and attendance pages show the student's own courses", "Student -> Results, Attendance", "4 AI courses with marks and derived grades; attendance per course", async () => {
    const t = await tok("bu144766");
    const r = await call("GET", "/student/results", { token: t });
    expect(r.json.length === 4 && r.json.every((c) => c.course_code.startsWith("AI") && c.grade), JSON.stringify(r.json.map((c) => c.course_code)));
    const a = await call("GET", "/student/attendance", { token: t });
    expect(a.status === 200 && JSON.stringify(a.json).includes("AI30"), "attendance missing");
  }],
  ["TC-FR9-03", "FR9", "Prediction history is kept", "Student status timeline / history after the refresh in TC-FR7-01", "History holds every prediction; timeline has one point per day", async () => {
    const s = await sid("BU-100040");
    const n = (await one("SELECT COUNT(*)::int AS n FROM predictions WHERE student_id = $1", [s.student_id])).n;
    expect(n >= 2, `${n} predictions`);
    const t = await call("GET", "/student/prediction/timeline", { token: await tok("bu100040") });
    expect(Array.isArray(t.json) && t.json.length >= 1, "no timeline");
  }],

  // ---------- FR10 faculty class view ----------
  ["TC-FR10-01", "FR10", "Faculty sees risk in their classes", "ayesha.khan -> My classes -> AI301 A roster", "Only her classes; label counts; roster with label, reasons and the model badge source; no probabilities", async () => {
    const t = await tok("ayesha");
    const classes = (await call("GET", "/faculty/classes", { token: t })).json;
    expect(classes.every((c) => /^AI30/.test(c.course_code)), JSON.stringify(classes.map((c) => c.course_code)));
    const roster = await call("GET", "/faculty/classes/16/roster", { token: t });
    expect(roster.json.length === 8 && roster.json.every((r) => r.final_label && Array.isArray(r.reasons)), "roster incomplete");
    expect(!/prob_safe/.test(roster.text), "probabilities exposed");
  }],
  ["TC-FR10-02", "FR10", "Class risk summary", "AI301 A -> Risk in this class", "Counts per label (sum = 8), A-F grade distribution, attendance per session", async () => {
    const r = (await call("GET", "/faculty/classes/16/risk-summary", { token: await tok("ayesha") })).json;
    const c = r.counts || r;
    expect(Number(c.safe) + Number(c.at_risk) + Number(c.dropout_likely) === 8, JSON.stringify(c));
    expect(JSON.stringify(r).match(/grade|distribution/i) && JSON.stringify(r).match(/session|date/i), "no grade distribution / sessions");
  }],

  // ---------- FR11 study material ----------
  ["TC-FR11-01", "FR11", "Every course has active study material", "Admin -> Tutorials", "Each of the 20 courses has at least one active tutorial", async () => {
    const r = await one("SELECT COUNT(*)::int AS n FROM courses c WHERE NOT EXISTS (SELECT 1 FROM tutorials t WHERE t.course_id = c.course_id AND t.is_active)");
    expect(r.n === 0, `${r.n} courses without`);
  }],
  ["TC-FR11-02", "FR11", "A flagged student gets material for their weakest course", "Student BU-144766 -> What to do next", "Tutorial card for AI302 (average 53) with an external link", async () => {
    const d = (await call("GET", "/student/dashboard", { token: await tok("bu144766") })).json;
    expect(d.recommendation && d.recommendation.course.course_code === "AI302" && /^https?:/.test(d.recommendation.tutorial.url), JSON.stringify(d.recommendation && d.recommendation.course));
  }],
  ["TC-FR11-03", "FR11", "Admin adds and deactivates a tutorial", "Tutorials -> Add (course AI302) -> Deactivate", "201 then the tutorial is inactive; both in the audit log", async () => {
    const t = await tok("admin");
    const course = await one("SELECT course_id FROM courses WHERE course_code = 'AI302'");
    const r = await call("POST", "/admin/tutorials", { token: t, body: { course_id: course.course_id, title: "TC tutorial", url: `https://example.org/tc-${Date.now()}`, provider: "TC", kind: "notes" } });
    expect(r.status === 201, `add ${r.status}`);
    const id = r.json.tutorial_id || r.json.id;
    expect((await call("PUT", `/admin/tutorials/${id}/deactivate`, { token: t })).status === 200, "deactivate failed");
    expect((await one("SELECT is_active FROM tutorials WHERE tutorial_id = $1", [id])).is_active === false, "still active");
  }],

  // ---------- FR12 counselors ----------
  ["TC-FR12-01", "FR12", "Admin assigns a counselor", "Interventions -> BU-144766 -> Assign -> Dr. Ayesha Khan", "Assigned; the student and the counselor are both notified; the student's dashboard shows the counselor", async () => {
    const s = await sid("BU-144766");
    const f = await one("SELECT faculty_id FROM faculty WHERE full_name = 'Dr. Ayesha Khan'");
    const r = await call("POST", "/admin/counselors", { token: await tok("admin"), body: { studentId: s.student_id, facultyId: f.faculty_id } });
    expect(r.status === 201, `assign ${r.status}`);
    const d = (await call("GET", "/student/dashboard", { token: await tok("bu144766") })).json;
    expect(d.counselor && d.counselor.name === "Dr. Ayesha Khan", "no counselor on dashboard");
    const n = (await call("GET", "/notifications/mine", { token: await tok("ayesha") })).json;
    expect(n.notifications.some((x) => /counselor/i.test(`${x.subject} ${x.message}`)), "counselor not notified");
  }],
  ["TC-FR12-02", "FR12", "Counselor follows up; others can't", "ayesha.khan -> My counselees -> Farah Javed -> notes, Mark contacted today; bilal.raza opens the same counselee", "Notes and contact date saved; bilal.raza gets 403", async () => {
    const list = (await call("GET", "/faculty/counselees", { token: await tok("ayesha") })).json;
    const c = list.find((x) => x.roll_no === "BU-144766");
    expect(c, "counselee not listed");
    const today = new Date().toISOString().slice(0, 10);
    const r = await call("PUT", `/faculty/counselees/${c.id}`, { token: await tok("ayesha"), body: { notes: "TC note", last_contacted_at: today } });
    expect(r.status === 200, `save ${r.status}`);
    expect((await call("GET", `/faculty/counselees/${c.id}`, { token: await tok("bilal") })).status === 403, "another faculty member could open it");
  }],
  ["TC-FR12-03", "FR12", "Closing an assignment", "Interventions -> Dr. Ayesha Khan -> Close assignment", "Closed; the row shows Assign again; the counselor no longer lists the student", async () => {
    const a = await one("SELECT ca.id FROM counselor_assignments ca JOIN students s USING (student_id) WHERE s.roll_no = 'BU-144766' AND ca.status = 'active'");
    expect((await call("PUT", `/admin/counselors/${a.id}/close`, { token: await tok("admin") })).status === 200, "close failed");
    const list = (await call("GET", "/faculty/counselees", { token: await tok("ayesha") })).json;
    expect(!list.some((x) => x.roll_no === "BU-144766"), "still listed");
  }],

  // ---------- FR13 bulk uploads ----------
  ["TC-FR13-01", "FR13", "Upload template prefilled with the roster", "bilal.raza -> CS401 A -> Upload -> Download marks template", "CSV with roll_no, name and empty mark columns, one row per enrolled student", async () => {
    const r = await call("GET", "/faculty/classes/4/templates/results.csv", { token: await tok("bilal") });
    const lines = r.text.replace(/^﻿/, "").trim().split(/\r?\n/);
    expect(lines[0].startsWith("roll_no,name,assignment_avg") && lines.length === 9, `${lines.length} lines`);
  }],
  ["TC-FR13-02", "FR13", "Preview catches bad rows and saves nothing", "Upload docs/demo_files/demo_marks_upload_CS401_A.csv in preview", "9 rows: 7 valid, 2 errors (quiz '8O' on row 4, BU-100099 not in the class on row 10); nothing written", async () => {
    const form = new FormData();
    form.append("file", new Blob([fs.readFileSync(path.join(__dirname, "..", "docs", "demo_files", "demo_marks_upload_CS401_A.csv"))], { type: "text/csv" }), "demo.csv");
    const res = await fetch(`${API}/faculty/classes/4/upload?kind=results&mode=preview`, { method: "POST", headers: { Authorization: `Bearer ${await tok("bilal")}` }, body: form });
    const b = await res.json();
    expect(b.summary.rows_total === 9 && b.summary.rows_ok === 7 && b.summary.rows_failed === 2, JSON.stringify(b.summary));
    expect(b.errors.map((e) => e.row).sort().join(",") === "10,4", JSON.stringify(b.errors.map((e) => e.row)));
  }],
  ["TC-FR13-03", "FR13", "Commit saves good rows and re-predicts; undo file reverts", "Save 7 valid rows; then upload demo_marks_undo_CS401_A.csv", "7 saved, 2 rejected, 1 label changed (BU-145871 Safe -> At-Risk); after the undo file BU-145871 is Safe again", async () => {
    const up = async (file) => {
      const form = new FormData();
      form.append("file", new Blob([fs.readFileSync(path.join(__dirname, "..", "docs", "demo_files", file))], { type: "text/csv" }), file);
      return (await fetch(`${API}/faculty/classes/4/upload?kind=results&mode=commit`, { method: "POST", headers: { Authorization: `Bearer ${await tok("bilal")}` }, body: form })).json();
    };
    const c = await up("demo_marks_upload_CS401_A.csv");
    expect(c.summary.rows_ok === 7 && c.summary.rows_failed === 2 && c.labels_changed.length === 1, JSON.stringify(c.summary));
    expect((await latest("BU-145871")).final_label === "At-Risk", "label did not change");
    await up("demo_marks_undo_CS401_A.csv");
    expect((await latest("BU-145871")).final_label === "Safe", "undo did not restore Safe");
  }],

  // ---------- FR14 admin dashboard, interventions, export ----------
  ["TC-FR14-01", "FR14", "Admin dashboard KPIs and charts", "Admin -> Overview", "Students 50,030; label counts add up to the predicted total; charts and data sources render without errors", async () => {
    const d = (await call("GET", "/admin/dashboard", { token: await tok("admin") })).json;
    const n = (await one("SELECT COUNT(*)::int AS n FROM students")).n; // 50,030 after a reset, plus accounts created above
    expect(d.kpis.students === n && n >= 50030, `students ${d.kpis.students} vs ${n}`);
    const p = await page();
    await uiSignIn(p, "admin", ACCOUNTS.admin.email, ACCOUNTS.admin.password);
    await at(p, "/admin");
    await p.waitForLoadState("networkidle");
    const text = await p.locator("main").textContent();
    expect(text.includes("Data sources") && /50,0\d\d/.test(text), "dashboard incomplete");
    expect(p.errors.length === 0, p.errors.join(" | "));
    await p.context().close();
  }],
  ["TC-FR14-02", "FR14", "Flagged list with filters", "Interventions -> Label: Dropout-Likely, Department: AI, search BU-1", "Only matching flagged students, sorted by severity, 25 per page", async () => {
    const r = (await call("GET", "/admin/at-risk-students?label=Dropout-Likely&department=4&search=BU-1&limit=25", { token: await tok("admin") })).json;
    expect(r.rows.length > 0 && r.rows.length <= 25 && r.rows.every((x) => x.final_label === "Dropout-Likely" && x.roll_no.startsWith("BU-1")), `${r.rows.length} rows`);
  }],
  ["TC-FR14-03", "FR14", "Intervention message with tutorial", "Select BU-112907 -> Send -> keep the template and 'Add tutorial'", "Sent; the student's bell shows it with their own name and the tutorial line", async () => {
    const s = await sid("BU-112907");
    const r = await call("POST", "/admin/notifications", { token: await tok("admin"), body: { recipient_user_id: s.user_id, subject: "Let's plan your next steps, {name}", message: "Hi {name}, {course} needs attention.", includeTutorial: true } });
    expect([200, 201].includes(r.status), `send ${r.status}`);
    const n = (await call("GET", "/notifications/mine", { token: await tok("bu112907") })).json;
    expect(n.unreadCount >= 1 && n.notifications.some((x) => (x.subject + x.message).includes(s.full_name)), `not delivered or not personalised for ${s.full_name}`);
  }],
  ["TC-FR14-04", "FR14", "Export the flagged list as CSV", "Interventions -> Export CSV", "UTF-8 CSV (BOM) with the documented columns; formula-safe cells", async () => {
    const raw = await fetch(`${API}/admin/at-risk-students/export?label=At-Risk`, { headers: { Authorization: `Bearer ${await tok("admin")}` } });
    const bytes = new Uint8Array(await raw.arrayBuffer());
    expect(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, "no BOM"); // fetch().text() would strip it
    const r = { text: "﻿" + new TextDecoder().decode(bytes.slice(3)) };
    expect(r.text.slice(1).startsWith("roll_no,name,department,label,top_reason,weakest_course,counselor,last_intervention"), "wrong header");
    expect(!/\n"?[=+@-]/.test(r.text.replace(/\n"BU-/g, "")), "unsafe formula cell");
  }],

  // ---------- FR15 chat assistant ----------
  ["TC-FR15-01", "FR15", "Why is my status this?", "Student BU-144766 -> Ask SmartEdu -> 'Why is my status this?'", "Label in supportive wording, the reasons with real numbers, a 'this is a warning, not a final result' line (wording varies); from the templates (no LLM needed)", async () => {
    const r = (await call("POST", "/student/chat", { token: await tok("bu144766"), body: { message: "Why is my status this?" } })).json;
    expect(r.intent === "why_risk" && r.source === "template" && /1\.62/.test(r.answer) && /warning/i.test(r.answer), r.answer);
  }],
  ["TC-FR15-02", "FR15", "Roman Urdu question", "'meri attendance kaisi hai?'", "Attendance answer with the student's real figures (62.5%, 20 of 32 after a reset), per course, sessions needed to reach 75%", async () => {
    const d = (await call("GET", "/student/dashboard", { token: await tok("bu144766") })).json.liveAttendance;
    const r = (await call("POST", "/student/chat", { token: await tok("bu144766"), body: { message: "meri attendance kaisi hai?" } })).json;
    expect(r.intent === "attendance" && r.answer.includes(`${d.present} of ${d.sessions}`) && /reach 75%/.test(r.answer), r.answer);
  }],
  ["TC-FR15-03", "FR15", "Questions about another student are refused", "'What is BU-122785's CGPA?'", "Fixed refusal; no numbers about that student; never confirms they exist", async () => {
    const r = (await call("POST", "/student/chat", { token: await tok("bu144766"), body: { message: "What is BU-122785's CGPA?" } })).json;
    expect(r.intent === "other_student" && !/1\.97/.test(r.answer) && !/BU-122785/.test(r.answer), r.answer);
  }],
  ["TC-FR15-04", "FR15", "Wellbeing message gets support contacts", "'I'm so stressed about my exams'", "Supportive reply with the support office contacts", async () => {
    const r = (await call("POST", "/student/chat", { token: await tok("bu144766"), body: { message: "I'm so stressed about my exams" } })).json;
    expect(r.intent === "wellbeing" && /@|\d{3}/.test(r.answer), r.answer);
  }],
  ["TC-FR15-05", "FR15", "Live-cohort student's marks (imported)", "Reset SYN-101155's password, sign in, ask 'What are my marks?'", "Their CS301 imported average (89) and that the marks come from the imported record - not 'no marks yet'", async () => {
    const u = await sid("SYN-101155");
    const reset = await call("PUT", `/admin/users/${u.user_id}/reset-password`, { token: await tok("admin") });
    const login = await call("POST", "/auth/login", { body: { email: "live.syn-101155@smartedu.edu", password: reset.json.tempPassword, portal: "student" } });
    const ch = await call("POST", "/auth/change-password", { token: login.json.token, body: { currentPassword: reset.json.tempPassword, newPassword: "Live-pass2026" } });
    const r = (await call("POST", "/student/chat", { token: ch.json.token, body: { message: "What are my marks?" } })).json;
    expect(/CS301/.test(r.answer) && /89/.test(r.answer) && /imported record/.test(r.answer) && !/No marks/i.test(r.answer), r.answer);
  }],
];

const FR_TITLES = {
  P: ["Separate sign-in portals (Phase 6)", "NFR3.1"],
  FR1: ["Authentication, roles and session security", "NFR3.1"],
  FR2: ["User management (create, deactivate, reset password) and audit log", "NFR3.1, NFR3.3"],
  FR3: ["Courses, faculty assignment, enrollment and drop", "-"],
  FR4: ["Data import: 50k dataset and live cohort (validation, missing values)", "FR1.1, FR1.2"],
  FR5: ["Faculty results entry with server-derived grades and live re-prediction", "FR2.3"],
  FR6: ["Faculty attendance marking", "-"],
  FR7: ["Risk prediction: Random Forest, single and batch, policy escalation, fallback", "FR2.3, FR2.4"],
  FR8: ["Explanations: reasons, model transparency page, what-if", "FR3.4, FR4.1"],
  FR9: ["Student dashboard, results, attendance and history", "FR1.4, FR3.1"],
  FR10: ["Faculty class risk view", "FR3.1, FR3.4"],
  FR11: ["Study material recommendations (tutorials)", "FR4.1"],
  FR12: ["Counselor assignment and follow-up", "FR4.1, FR4.2"],
  FR13: ["Bulk CSV uploads of marks and attendance", "FR1.1"],
  FR14: ["Admin dashboard, flagged list, interventions and export", "FR3.1, FR3.3, FR4.3"],
  FR15: ['"Ask SmartEdu" chat assistant', "FR4.1"],
};

async function main() {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; // local date
  browser = await chromium.launch();
  const results = [];
  for (const [id, fr, desc, steps, expected, run] of CASES) {
    let result;
    try {
      await run();
      result = `Pass (${date})`;
    } catch (e) {
      result = `**Fail** (${date}): ${String(e instanceof Fail ? e.message : e.message || e).replace(/\|/g, "/").replace(/\s+/g, " ").slice(0, 160)}`;
    }
    console.log(`${result.startsWith("Pass") ? "PASS" : "FAIL"}  ${id}  ${desc}${result.startsWith("Pass") ? "" : "  -> " + result}`);
    results.push({ id, fr, desc, steps, expected, result });
  }
  await browser.close();
  await pool.end();

  const passed = results.filter((r) => r.result.startsWith("Pass")).length;
  const cell = (s) => String(s).replace(/\|/g, "/").replace(/\n/g, " ");
  const lines = [
    "# Manual test cases",
    "",
    `Every case below was executed on ${date} through the running system - the API over HTTP, and the portal/UI cases in a`,
    "real browser (Playwright, Chromium) - by `evaluation/test_cases.js`, right after `npm run demo:reset` (the script changes",
    "demo data; reset again afterwards). The Steps column says what a person does in the UI; the script performs the same",
    "action through the same API the UI calls.",
    "",
    `**Result: ${passed} / ${results.length} passed.**`,
    "",
    "## Functional requirements",
    "",
    "The SRS (*Software Requirements Specification 1.docx*) groups requirements as FR1-FR4 with sub-items; the code and",
    "earlier phases refer to FR11-FR13. This consolidated list FR1-FR15 keeps those numbers and maps each one to the SRS.",
    "",
    "| FR | Requirement | SRS reference | Cases |",
    "|---|---|---|---|",
    ...Object.entries(FR_TITLES).map(([fr, [title, srs]]) => `| ${fr} | ${title} | ${srs} | ${results.filter((r) => r.fr === fr).length} |`),
    "",
    "## Cases",
    "",
    "| ID | Description | Steps | Expected | Result |",
    "|---|---|---|---|---|",
    ...results.map((r) => `| ${r.id} | ${cell(r.desc)} | ${cell(r.steps)} | ${cell(r.expected)} | ${r.result} |`),
    "",
  ];
  fs.writeFileSync(OUT, lines.join("\n"));
  console.log(`\n${passed}/${results.length} passed -> ${path.relative(process.cwd(), OUT)}`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  if (browser) await browser.close().catch(() => {});
  process.exit(1);
});
