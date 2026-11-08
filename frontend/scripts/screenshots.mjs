// npm run screenshots
// Full-page screenshots of every main screen at 1280px and 390px, saved to docs/screenshots/,
// plus the "Ask SmartEdu" panel after 3 questions for one student of each label, and the
// Phase 4 intervention screens (see phase4Screenshots).
// Needs the three services running (frontend dev server, backend, ML service) and a
// Chromium for Playwright (one-time: npx playwright install chromium).
// BASE_URL defaults to http://localhost:5173.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const BASE = process.env.BASE_URL || "http://localhost:5173";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "screenshots");
const WIDTHS = [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
];
const DEMO_STUDENTS = ["100040", "106864", "122785", "112907", "144766", "101986"];

// ---- class 4 snapshot/restore ----------------------------------------------------------------
// The upload screens re-save class 4's marks (CS401 A). Its course_results rows, its students'
// latest-prediction pointers, the upload rows and the 'upload' predictions are snapshotted before
// the run and restored at the end - also when the run fails - using backend/.env's DATABASE_URL.
const BACKEND = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "backend");
const backendRequire = createRequire(join(BACKEND, "package.json"));
backendRequire("dotenv").config({ path: join(BACKEND, ".env") });
const RESTORE_CLASS = 4;

async function snapshotClass(pool, classId) {
  const enr = (await pool.query("SELECT enrollment_id, student_id FROM enrollments WHERE faculty_course_id = $1", [classId])).rows;
  const eids = enr.map((e) => e.enrollment_id);
  const sids = enr.map((e) => e.student_id);
  return {
    classId, eids, sids,
    at: (await pool.query("SELECT NOW() AS t")).rows[0].t,
    // updated_at as text: a JS Date would drop the microseconds and the row would no longer be identical
    results: (await pool.query("SELECT *, updated_at::text AS updated_at_text FROM course_results WHERE enrollment_id = ANY($1) ORDER BY result_id", [eids])).rows,
    pointers: (await pool.query("SELECT student_id, latest_prediction_id FROM students WHERE student_id = ANY($1)", [sids])).rows,
    maxUpload: (await pool.query("SELECT COALESCE(MAX(id), 0) AS m FROM uploads")).rows[0].m,
    hash: await classHash(pool, classId),
  };
}

/** md5 over class's course_results rows (every column), its uploads and its students' pointers. */
async function classHash(pool, classId) {
  const { rows: [h] } = await pool.query(
    `SELECT md5(
       COALESCE((SELECT string_agg(cr::text, '|' ORDER BY cr.result_id) FROM course_results cr
                 JOIN enrollments e ON e.enrollment_id = cr.enrollment_id WHERE e.faculty_course_id = $1), '') || '#' ||
       COALESCE((SELECT string_agg(u.id::text, ',' ORDER BY u.id) FROM uploads u WHERE u.faculty_course_id = $1), '') || '#' ||
       COALESCE((SELECT string_agg(s.student_id || ':' || COALESCE(s.latest_prediction_id::text, ''), ',' ORDER BY s.student_id)
                 FROM students s JOIN enrollments e ON e.student_id = s.student_id WHERE e.faculty_course_id = $1), '')
     ) AS h`,
    [classId]
  );
  return h.h;
}

async function restoreClass(pool, snap) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    for (const p of snap.pointers) await c.query("UPDATE students SET latest_prediction_id = $2 WHERE student_id = $1", [p.student_id, p.latest_prediction_id]);
    await c.query("DELETE FROM predictions WHERE student_id = ANY($1) AND created_at >= $2 AND triggered_by = 'upload'", [snap.sids, snap.at]);
    for (const r of snap.results) {
      await c.query(
        `UPDATE course_results SET assignment_avg = $2, quiz_avg = $3, midterm_marks = $4, final_marks = $5, grade = $6,
           updated_by = $7, updated_at = $8::timestamptz, data_source = $9, upload_id = $10 WHERE result_id = $1`,
        [r.result_id, r.assignment_avg, r.quiz_avg, r.midterm_marks, r.final_marks, r.grade, r.updated_by, r.updated_at_text, r.data_source, r.upload_id]
      );
    }
    const up = await c.query("DELETE FROM uploads WHERE id > $1 AND faculty_course_id = $2 RETURNING id", [snap.maxUpload, snap.classId]);
    await c.query("DELETE FROM audit_log WHERE entity = 'uploads' AND entity_id = ANY($1)", [up.rows.map((r) => r.id)]);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  const after = await classHash(pool, snap.classId);
  return after === snap.hash;
}

const ACCOUNTS = [
  { name: "admin", email: "admin@smartedu.edu", password: "Admin@123", pages: async () => [
    ["overview", "/admin"],
    ["interventions", "/admin/interventions"],
    ["model", "/admin/model"],
    ["live-cohort", "/admin/live-cohort"],
    ["users", "/admin/users"],
    ["assignments", "/admin/assignments"],
    ["tutorials", "/admin/tutorials"],
    ["audit-log", "/admin/audit-log"],
  ] },
  { name: "faculty-ayesha", email: "ayesha.khan@smartedu.edu", password: "Faculty@123", pages: async (api) => {
    // the class with the most students
    const classes = await api("/api/faculty/classes");
    const id = [...classes].sort((a, b) => b.enrolled_count - a.enrolled_count)[0].faculty_course_id;
    return [
      ["classes", "/faculty"],
      ["roster", `/faculty/class/${id}/roster`],
      ["attendance", `/faculty/class/${id}/attendance`],
    ];
  } },
  ...DEMO_STUDENTS.map((id) => ({
    name: `student-BU-${id}`,
    email: `student${id}@smartedu.edu`,
    password: "Student@123",
    pages: async () => [
      ["dashboard", "/student"],
      ["results", "/student/results"],
      ["attendance", "/student/attendance"],
    ],
  })),
];

// Chat panel after 3 questions, for one student of each label (Safe, At-Risk, Dropout-Likely).
// The student's chat history is cleared before and after, so the demo accounts stay clean.
const CHAT_STUDENTS = ["100040", "112907", "144766"];
const CHAT_QUESTIONS = ["Why is my status this?", "meri attendance kaisi hai?", "How can I improve?"];

async function chatScreenshot(page, account, viewport, problems) {
  const clear = () =>
    page.evaluate(() => fetch("/api/student/chat/history", { method: "DELETE", headers: { Authorization: `Bearer ${localStorage.getItem("smartedu_token")}` } }));
  await clear();
  await page.goto(`${BASE}/student`);
  await settle(page);
  await page.getByRole("button", { name: "Ask SmartEdu", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Ask SmartEdu" });
  await panel.waitFor();
  // first question from a starter chip, the others typed (Enter sends)
  await panel.getByRole("button", { name: CHAT_QUESTIONS[0] }).click();
  for (const q of CHAT_QUESTIONS.slice(1)) {
    await panel.getByRole("button", { name: "Send" }).waitFor();
    await page.waitForFunction(() => !document.querySelector('[aria-label="SmartEdu is typing"]'));
    await panel.getByLabel("Your question").fill(q);
    await panel.getByLabel("Your question").press("Enter");
  }
  await page.waitForTimeout(300);
  await page.waitForFunction(() => !document.querySelector('[aria-label="SmartEdu is typing"]'));
  const answers = await panel.locator(".rounded-bl-md").count();
  if (answers !== 3) problems.push(`${account.name}/chat @${viewport.width}px: expected 3 answers, saw ${answers}`);
  const overflow = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return d.scrollWidth - d.clientWidth;
  });
  if (overflow > 0) problems.push(`${account.name}/chat @${viewport.width}px: panel overflows by ${overflow}px`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, `${account.name}-chat-${viewport.width}.png`) });
  await clear();
}

// Phase 4 screens. A non-demo flagged student (BU-115624) gets a non-demo counselor (Mr. Zain
// Abbas) for the duration of the run, so the demo accounts' notifications stay untouched; the
// assignment is closed again at the end.
const P4 = { student: "115624", counselor: "zain.abbas@smartedu.edu" };

/** The sign-in portal an account belongs to (POST /api/auth/login needs it). */
const portalOf = (email) => (email.startsWith("admin@") ? "admin" : /^(student\d+|live\.)/.test(email) ? "student" : "faculty");

async function apiAs(page, email, password) {
  return page.evaluate(
    async ({ email, password, portal }) => {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, portal }) });
      const data = await res.json();
      localStorage.setItem("smartedu_token", data.token);
      localStorage.setItem("smartedu_role", data.role);
      localStorage.removeItem("smartedu_must_reset");
      return data.token;
    },
    { email, password, portal: portalOf(email) }
  );
}

const call = (page, method, path, body) =>
  page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(path, {
        method,
        headers: { Authorization: `Bearer ${localStorage.getItem("smartedu_token")}`, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { method, path, body }
  );

/** Assigns the screenshot counselor (admin session on `page`); returns the assignment id. */
async function phase4Setup(page) {
  await page.goto(`${BASE}/`);
  await apiAs(page, "admin@smartedu.edu", "Admin@123");
  const st = await call(page, "GET", `/api/admin/students?search=BU-${P4.student}`);
  const fac = await call(page, "GET", "/api/admin/faculty");
  const studentId = st.body.rows[0].student_id;
  const facultyId = fac.body.find((f) => f.email === P4.counselor).faculty_id;
  const res = await call(page, "POST", "/api/admin/counselors", { studentId, facultyId });
  if (res.status === 201) return res.body.id;
  // already assigned from an interrupted run: find it
  const list = await call(page, "GET", `/api/admin/counselors?status=active&faculty=${facultyId}&limit=100`);
  return list.body.rows.find((r) => r.roll_no === `BU-${P4.student}`)?.id;
}

async function phase4Teardown(page, assignmentId) {
  await page.goto(`${BASE}/`);
  await apiAs(page, "admin@smartedu.edu", "Admin@123");
  if (assignmentId) await call(page, "PUT", `/api/admin/counselors/${assignmentId}/close`);
}

/**
 * Full-page screenshot that keeps the charts. Playwright's fullPage mode resizes the page for the capture;
 * recharts' ResponsiveContainer re-renders on that resize and the charts come out blank. So the viewport is
 * made as tall as the page first, the charts get time to redraw, and a normal screenshot is taken.
 */
async function fullPageShot(page, file, viewport) {
  // a capture taken while scrolled down draws the sticky header mid-page
  await page.evaluate(() => window.scrollTo(0, 0));
  const height = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
  await page.setViewportSize({ width: viewport.width, height: Math.max(viewport.height, height) });
  await page.waitForTimeout(900);
  await page.screenshot({ path: file });
  await page.setViewportSize(viewport);
}

async function shot(page, name, viewport, problems, { fullPage = true } = {}) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 0) problems.push(`${name} @${viewport.width}px overflows by ${overflow}px`);
  const file = join(OUT, `${name}-${viewport.width}.png`);
  if (fullPage) await fullPageShot(page, file, viewport);
  else await page.screenshot({ path: file });
}

async function phase4Screenshots(page, viewport, problems) {
  let n = 0;
  // admin: assign modal and the bulk intervention composer with its preview
  await page.goto(`${BASE}/`);
  await apiAs(page, "admin@smartedu.edu", "Admin@123");
  await page.goto(`${BASE}/admin/interventions`);
  await settle(page);
  await page.getByRole("button", { name: "Assign", exact: true }).first().click();
  await page.getByRole("dialog", { name: "Assign counselor" }).getByText(/counselees?$/).first().waitFor();
  await page.waitForTimeout(500);
  await shot(page, "admin-assign-modal", viewport, problems, { fullPage: false });
  n++;
  await page.keyboard.press("Escape");
  const boxes = page.locator('tbody input[type="checkbox"]');
  for (let i = 0; i < 3; i++) await boxes.nth(i).check();
  await page.getByRole("button", { name: /^Send to 3$/ }).click();
  const compose = page.getByRole("dialog");
  await compose.getByText(/Recommended for|Hi /).first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(600);
  await shot(page, "admin-send-intervention", viewport, problems, { fullPage: false });
  n++;
  await page.keyboard.press("Escape");

  // faculty: My counselees list and the drawer
  await page.goto(`${BASE}/`);
  await apiAs(page, P4.counselor, "Faculty@123");
  await page.goto(`${BASE}/faculty/counselees`);
  await settle(page);
  await shot(page, "faculty-zain-counselees", viewport, problems);
  n++;
  await page.locator("ul li button").first().click();
  await page.getByRole("heading", { name: "Recommended tutorial" }).waitFor();
  await page.waitForTimeout(600);
  await shot(page, "faculty-zain-counselee-drawer", viewport, problems, { fullPage: false });
  n++;

  // student: the "What to do next" card with counselor and tutorial
  await page.goto(`${BASE}/`);
  await apiAs(page, `student${P4.student}@smartedu.edu`, "Student@123");
  await page.goto(`${BASE}/student#what-next`);
  await settle(page);
  await page.locator("#what-next").scrollIntoViewIfNeeded();
  await page.locator("section", { has: page.locator("#what-next") }).screenshot({ path: join(OUT, `student-BU-${P4.student}-what-next-${viewport.width}.png`) });
  n++;

  // Change Password: forced (temporary password) and voluntary
  await page.evaluate(() => localStorage.setItem("smartedu_must_reset", "1"));
  await page.goto(`${BASE}/change-password`);
  await settle(page);
  await page.fill("#new-password", "Temp-pass");
  await shot(page, "change-password-forced", viewport, problems);
  n++;
  await page.evaluate(() => localStorage.removeItem("smartedu_must_reset"));
  await page.goto(`${BASE}/change-password`);
  await settle(page);
  await shot(page, "change-password", viewport, problems);
  n++;
  return n;
}

// Phase 5 screens: the data sources panel, the what-if tab (BU-100040 at 55% attendance flips the
// label; nothing is saved) for faculty and admin, and the faculty Upload tab (preview with errors,
// then the result). The upload re-saves class 4 (CS401 A, bilal.raza, no demo students) with its
// CURRENT marks plus 2 deliberate bad rows, so values and labels don't change - those rows are
// only tagged live / uploaded.
const P5 = { uploadClass: 4, uploadFaculty: "bilal.raza@smartedu.edu", whatIfStudent: "BU-100040", whatIfFaculty: "ayesha.khan@smartedu.edu" };

async function phase5Screenshots(page, viewport, problems) {
  let n = 0;
  await page.goto(`${BASE}/`);
  await apiAs(page, "admin@smartedu.edu", "Admin@123");
  await page.goto(`${BASE}/admin`);
  await settle(page);
  await page.getByRole("heading", { name: "Data sources" }).locator("xpath=ancestor::section[1]").screenshot({ path: join(OUT, `admin-data-sources-${viewport.width}.png`) });
  n++;
  await page.goto(`${BASE}/admin/interventions`);
  await settle(page);
  await page.locator('button[title="Open student details"]').first().click();
  await page.getByRole("tab", { name: "What if?" }).click();
  await page.getByLabel("Attendance").waitFor();
  await page.getByLabel("Attendance").fill("90");
  await page.waitForTimeout(1500);
  await shot(page, "admin-whatif", viewport, problems, { fullPage: false });
  n++;

  // faculty what-if: BU-100040 (Safe) at 55% attendance
  await page.goto(`${BASE}/`);
  await apiAs(page, P5.whatIfFaculty, "Faculty@123");
  const classes = (await call(page, "GET", "/api/faculty/classes")).body;
  let classId = null;
  for (const c of classes) {
    const r = (await call(page, "GET", `/api/faculty/classes/${c.faculty_course_id}/roster`)).body;
    if (r.some((x) => x.roll_no === P5.whatIfStudent)) classId = c.faculty_course_id;
  }
  await page.goto(`${BASE}/faculty/class/${classId}/roster`);
  await settle(page);
  await page.getByText(P5.whatIfStudent).first().click();
  await page.getByRole("tab", { name: "What if?" }).click();
  await page.getByLabel("Attendance").waitFor();
  await page.getByLabel("Attendance").fill("55");
  await page.getByText("The label would change.").waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  await shot(page, "faculty-whatif", viewport, problems, { fullPage: false });
  n++;

  // faculty upload: preview with 2 errors, then the result
  await page.goto(`${BASE}/`);
  await apiAs(page, P5.uploadFaculty, "Faculty@123");
  const roster = (await call(page, "GET", `/api/faculty/classes/${P5.uploadClass}/roster`)).body;
  const lines = ["roll_no,name,assignment_avg,quiz_avg,midterm_marks,final_marks"];
  roster.forEach((r, i) => {
    const m = [r.assignment_avg, r.quiz_avg, r.midterm_marks, r.final_marks].map((v) => (v == null ? "" : Number(v)));
    if (i === 1) m[1] = "7O"; // a typo: letter O
    lines.push([r.roll_no, r.full_name, ...m].join(","));
  });
  lines.push("BU-100099,Wrong Student,80,80,80,80"); // not in this class
  const file = join(tmpdir(), `smartedu_marks_${viewport.width}.csv`);
  writeFileSync(file, lines.join("\r\n"));
  await page.goto(`${BASE}/faculty/class/${P5.uploadClass}/roster?tab=upload`);
  await settle(page);
  await shot(page, "faculty-upload", viewport, problems);
  n++;
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.getByText("4. Check before saving").waitFor();
  await page.waitForTimeout(800);
  await shot(page, "faculty-upload-preview", viewport, problems);
  n++;
  await page.getByRole("button", { name: /^Save \d+ valid rows?$/ }).click();
  await page.getByText("Rows saved").waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  await shot(page, "faculty-upload-result", viewport, problems);
  n++;
  return n;
}

async function settle(page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800); // let charts finish layout
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const { Pool } = backendRequire("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const snap = await snapshotClass(pool, RESTORE_CLASS);
  let restored = null;
  const restore = () =>
    (restored ||= restoreClass(pool, snap).then((same) => {
      console.log(same ? `Class ${RESTORE_CLASS} restored: identical to before the run.` : `WARNING: class ${RESTORE_CLASS} differs from its snapshot after the restore.`);
      if (!same) process.exitCode = 1;
    }));
  // Ctrl+C skips `finally`: restore first, then stop
  process.once("SIGINT", () => {
    console.log("Interrupted - restoring class 4 first...");
    restore().finally(() => process.exit(130));
  });
  try {
    await run();
  } finally {
    await restore();
    await pool.end();
  }
}

async function run() {
  const browser = await chromium.launch();
  let count = 0;
  const problems = [];

  const setupCtx = await browser.newContext();
  const setupPage = await setupCtx.newPage();
  const assignmentId = await phase4Setup(setupPage);

  try {
    for (const viewport of WIDTHS) {
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => problems.push(`${page.url()}: ${e.message}`));

      // the portal chooser and the three sign-in pages
      for (const [label, path] of [["portals", "/"], ["login-student", "/login/student"], ["login-faculty", "/login/faculty"], ["login-admin", "/login/admin"]]) {
        await page.goto(`${BASE}${path}`);
        await settle(page);
        await fullPageShot(page, join(OUT, `${label}-${viewport.width}.png`), viewport);
        count++;
      }

      for (const account of ACCOUNTS) {
        // log in through the API and store the session the way the app does
        await page.goto(`${BASE}/`);
        const ok = await page.evaluate(async ({ email, password, portal }) => {
          const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, portal }) });
          if (!res.ok) return false;
          const data = await res.json();
          localStorage.setItem("smartedu_token", data.token);
          localStorage.setItem("smartedu_role", data.role);
          return true;
        }, { email: account.email, password: account.password, portal: portalOf(account.email) });
        if (!ok) {
          problems.push(`login failed for ${account.email}`);
          continue;
        }
        const api = (path) =>
          page.evaluate(async (p) => (await fetch(p, { headers: { Authorization: `Bearer ${localStorage.getItem("smartedu_token")}` } })).json(), path);

        for (const [label, path] of await account.pages(api)) {
          await page.goto(`${BASE}${path}`);
          await settle(page);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          if (overflow > 0) problems.push(`${account.name}/${label} @${viewport.width}px overflows by ${overflow}px`);
          await fullPageShot(page, join(OUT, `${account.name}-${label}-${viewport.width}.png`), viewport);
          count++;
        }
        if (CHAT_STUDENTS.some((id) => account.email === `student${id}@smartedu.edu`)) {
          await chatScreenshot(page, account, viewport, problems);
          count++;
        }
      }
      try {
        count += await phase4Screenshots(page, viewport, problems);
      } catch (e) {
        problems.push(`phase 4 screens @${viewport.width}px: ${e.message.split("\n")[0]}`);
      }
      try {
        count += await phase5Screenshots(page, viewport, problems);
      } catch (e) {
        problems.push(`phase 5 screens @${viewport.width}px: ${e.message.split("\n")[0]}`);
      }
      await ctx.close();
    }
  } finally {
    await phase4Teardown(setupPage, assignmentId);
    await setupCtx.close();
    await browser.close();
  }
  console.log(`Saved ${count} screenshots to ${OUT}`);
  if (problems.length) {
    console.log("Problems:\n  " + problems.join("\n  "));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
