// Performs every Phase 7 demo action in docs/DEMO_ACCOUNTS.md ("Counselling and probation demo") in a
// real browser, exactly as written, and checks each result. It CHANGES the demo data (a session booked,
// one marked, the semester closed, a letter acknowledged): run `npm run demo:reset` before a presentation.
//
// Needs all three services running and a fresh `npm run demo:reset` (same day: the seeded sessions are
// dated from --as-of). Usage: cd backend; node ../evaluation/phase7_demo_check.mjs
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const { chromium } = require(join(HERE, "../frontend/node_modules/playwright"));
const BASE = process.env.APP_URL || "http://localhost:5173";
const OUT = join(HERE, "../docs/screenshots/phase7_demo");
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok, extra });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` - ${extra}` : ""}`);
};
const portalOf = (email) => (email.startsWith("admin@") ? "admin" : /^student\d+/.test(email) ? "student" : "faculty");
const browser = await chromium.launch();
const errors = [];

async function signIn(email, password) {
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  p.on("pageerror", (e) => errors.push(`${email}: ${e.message}`));
  await p.goto(`${BASE}/login/${portalOf(email)}`);
  await p.locator("#login-email").fill(email);
  await p.locator("#login-password").fill(password);
  await p.getByRole("button", { name: /Sign in/i }).click();
  await p.waitForURL((u) => !/\/login\//.test(u.pathname), { timeout: 20000 });
  return p;
}
const shot = (p, name) => p.screenshot({ path: join(OUT, `${name}.png`) });

// tomorrow in Pakistan time, YYYY-MM-DD
const pkToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
const tomorrow = (() => {
  const d = new Date(`${pkToday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
})();

try {
  const admin = await signIn("admin@smartedu.edu", "Admin@123");
  const ayesha = await signIn("ayesha.khan@smartedu.edu", "Faculty@123");

  // ---- 1. Admin schedules a session; both are notified
  await admin.goto(`${BASE}/admin/counselling`);
  await admin.getByRole("button", { name: "Schedule session" }).first().click();
  const dlg = admin.getByRole("dialog");
  await dlg.getByPlaceholder(/Roll no or name/).fill("BU-122785");
  await dlg.getByRole("button", { name: /BU-122785/ }).click();
  await dlg.getByText("counsellor Dr. Ayesha Khan").waitFor({ timeout: 15000 });
  const chosen = await dlg.locator("#cs-faculty option:checked").textContent();
  check("1. counsellor defaults to Dr. Ayesha Khan", /Dr\. Ayesha Khan/.test(chosen), chosen);
  await dlg.locator("#cs-date").fill(tomorrow);
  await dlg.locator("#cs-time").fill("10:00");
  await dlg.locator("#cs-location").fill("Room 204");
  await dlg.locator("#cs-agenda").fill("Plan for the final exams");
  await dlg.getByRole("button", { name: "Schedule session" }).click();
  await admin.getByText(/Session booked for .* 10:00 AM/).waitFor({ timeout: 15000 });
  check("1. session booked (toast)", true);
  await shot(admin, "1_admin_booked");
  const s122785 = await signIn("student122785@smartedu.edu", "Student@123");
  await s122785.getByRole("button", { name: /Notifications/ }).click();
  check("1. student bell: 'Counselling session with Dr. Ayesha Khan on ... 10:00 AM'", await s122785.getByText(/Counselling session with Dr\. Ayesha Khan on .* 10:00 AM \(30 min\), Room 204/).first().isVisible());
  await shot(s122785, "1_student_bell");
  await ayesha.reload();
  await ayesha.getByRole("button", { name: /Notifications/ }).click();
  check("1. teacher bell: 'Counselling session with Ayesha Akhtar (BU-122785)'", await ayesha.getByText(/Counselling session with Ayesha Akhtar \(BU-122785\) on .* 10:00 AM/).first().isVisible());
  await ayesha.keyboard.press("Escape");

  // ---- 2. Teacher marks yesterday's session Present
  await ayesha.goto(`${BASE}/faculty/counselling`);
  const row = ayesha.locator("tbody tr", { hasText: "Zain Khan" }).filter({ hasText: "Awaiting attendance" });
  await row.first().waitFor({ timeout: 15000 });
  check("2. Zain Khan's session yesterday shows 'Awaiting attendance' first", (await ayesha.locator("tbody tr").first().textContent()).includes("Awaiting attendance"));
  await row.first().getByRole("button", { name: "Present" }).click();
  await ayesha.getByRole("dialog").locator("#cs-notes").fill("Reviewed the study plan; on track for the midterm.");
  await ayesha.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await ayesha.getByText("Marked Present").waitFor({ timeout: 10000 });
  check("2. marked Present", true);
  await ayesha.getByRole("tab", { name: "History" }).click();
  await ayesha.locator("tbody tr", { hasText: "Reviewed the study plan" }).first().waitFor();
  await shot(ayesha, "2_teacher_history");
  const s112907 = await signIn("student112907@smartedu.edu", "Student@123");
  await s112907.goto(`${BASE}/student/counselling`);
  await s112907.getByText("All sessions").waitFor();
  check("2. student sees Present and 'Attended 3 of 3'", (await s112907.getByText("Attended 3 of 3 sessions so far.").isVisible()) && (await s112907.getByText("Present").first().isVisible()));
  check("2. student never sees the notes", !(await s112907.locator("body").innerText()).includes("Reviewed the study plan"));
  await shot(s112907, "2_student_counselling");

  // ---- 3. Close the semester: Bushra Awan goes onto Probation 1
  await admin.goto(`${BASE}/admin/academic-standing`);
  await admin.locator("#close-term").fill("Fall 2026");
  await admin.getByRole("button", { name: "Preview" }).click();
  await admin.getByText(/Only students whose standing changes/).waitFor({ timeout: 20000 });
  const bushra = admin.locator("tbody tr", { hasText: "BU-114400" });
  check("3. preview: BU-114400 Bushra Awan Good -> Probation 1, letter 1", (await bushra.textContent()).match(/Good.*Probation 1.*Level 1/) !== null, (await bushra.textContent()).replace(/\s+/g, " "));
  await admin.getByText(/including FYP, are final/).click();
  await shot(admin, "3_close_preview");
  await admin.getByRole("button", { name: "Close Fall 2026" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Close the semester" }).click();
  await admin.getByText("Fall 2026 closed").waitFor({ timeout: 30000 });
  check("3. semester closed", true);
  const s114400 = await signIn("student114400@smartedu.edu", "Student@123");
  await s114400.getByRole("button", { name: /Notifications/ }).click();
  check("3. Bushra notified: 'Academic standing: Probation 1 of 2'", await s114400.getByText("Academic standing: Probation 1 of 2").first().isVisible());
  await s114400.keyboard.press("Escape");

  // ---- 4. Schedule counselling for her from the probation list
  await admin.reload();
  await admin.getByPlaceholder("Roll no or name").fill("BU-114400");
  const prow = admin.locator("tbody tr", { hasText: "BU-114400" });
  await prow.first().waitFor({ timeout: 15000 });
  check("4. probation list shows Probation 1 with letter 1 (not acknowledged)", /Probation 1 of 2[\s\S]*Letter 1[\s\S]*not acknowledged/.test(await prow.first().textContent()));
  await prow.first().getByRole("button", { name: "Schedule session" }).click();
  const d2 = admin.getByRole("dialog");
  const agenda = await d2.locator("#cs-agenda").inputValue();
  check("4. form pre-filled (counsellor Dr. Khan, probation agenda)", agenda.startsWith("Probation follow-up (Probation 1 of 2, Fall 2026)") && /Dr\. Ayesha Khan/.test(await d2.locator("#cs-faculty option:checked").textContent()), agenda);
  await d2.locator("#cs-date").fill(tomorrow);
  await d2.locator("#cs-time").fill("15:00");
  await d2.locator("#cs-location").fill("Room 204");
  await d2.getByRole("button", { name: "Schedule session" }).click();
  await admin.getByText(/Session booked for .* 3:00 PM/).waitFor({ timeout: 15000 });
  check("4. probation session booked", true);
  await shot(admin, "4_probation_list");

  // ---- 5. The student acknowledges the letter
  await s114400.goto(`${BASE}/student`);
  await s114400.getByText("Academic warning - Probation 1 of 2").waitFor({ timeout: 15000 });
  await s114400.getByRole("button", { name: "I acknowledge this letter" }).click();
  await s114400.getByText("Letter acknowledged").waitFor({ timeout: 10000 });
  check("5. letter acknowledged", await s114400.getByText(/Acknowledged by the student on/).isVisible());
  await s114400.locator("#standing").scrollIntoViewIfNeeded();
  await shot(s114400, "5_student_letter");
  await admin.reload();
  await admin.getByPlaceholder("Roll no or name").fill("BU-114400");
  await admin.locator("tbody tr", { hasText: "acknowledged" }).first().waitFor({ timeout: 15000 });
  check("5. admin sees the letter acknowledged", !(await admin.locator("tbody tr", { hasText: "BU-114400" }).first().textContent()).includes("not acknowledged"));
} catch (e) {
  check("script ran to the end", false, e.message.split("\n")[0]);
} finally {
  await browser.close();
}
check("no page errors", errors.length === 0, errors.join(" | "));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed. The demo data was changed: run npm run demo:reset.`);
process.exit(failed ? 1 : 0);
