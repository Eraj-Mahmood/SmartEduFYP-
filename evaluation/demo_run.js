// Runs docs/DEMO_SCRIPT.md end to end in a real browser (Playwright, Chromium, 1280x720), one window
// like the presenter, checks what the audience should see at each step, times every part and records a
// video to docs/demo_recording/. Run right after `npm run demo:reset` with all three services up, and
// reset again afterwards (the demo changes data):
//
//   cd backend; npm run demo:reset -- --yes; node ../evaluation/demo_run.js; npm run demo:reset -- --yes
//
// TALK_SCALE (default 1) scales the pauses that stand in for the presenter talking (0 = no pauses).
const path = require("path");
const fs = require("fs");
const FRONTEND = path.join(__dirname, "..", "frontend");
const { chromium } = require(path.join(FRONTEND, "node_modules", "playwright"));

const WEB = "http://localhost:5173";
const OUT = path.join(__dirname, "..", "docs", "demo_recording");
const UPLOAD = path.join(__dirname, "..", "docs", "demo_files", "demo_marks_upload_CS401_A.csv");
const TALK = Number(process.env.TALK_SCALE ?? 1);

const steps = [];
let failures = 0;
const t0 = Date.now();
const clock = () => {
  const s = Math.round((Date.now() - t0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
function check(ok, id, what) {
  steps.push({ id, at: clock(), ok, what });
  console.log(`${ok ? "PASS" : "FAIL"}  ${clock().padStart(5)}  ${id}  ${what}`);
  if (!ok) failures++;
}
const talk = (page, seconds) => page.waitForTimeout(Math.round(seconds * 1000 * TALK));
const at = (page, p) => page.waitForURL((u) => new URL(u).pathname === p, { timeout: 15000 }).then(() => true).catch(() => false);
const has = async (page, re, timeout = 15000) => page.getByText(re).first().waitFor({ timeout }).then(() => true).catch(() => false);

async function signIn(page, portal, email, password, home) {
  await page.goto(`${WEB}/login/${portal}`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", password);
  await page.click("button[type=submit]");
  return home ? at(page, home) : true;
}
async function logout(page) {
  await page.getByRole("button", { name: /Account/ }).click();
  await page.getByRole("menuitem", { name: /Log out/ }).click();
}
async function ask(page, panel, q) {
  await page.waitForFunction(() => !document.querySelector('[aria-label="SmartEdu is typing"]'));
  await panel.getByLabel("Your question").fill(q);
  await panel.getByLabel("Your question").press("Enter");
  await page.waitForTimeout(400);
  await page.waitForFunction(() => !document.querySelector('[aria-label="SmartEdu is typing"]'));
  return (await panel.locator(".rounded-bl-md").last().textContent()) || "";
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: OUT, size: { width: 1280, height: 720 } } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // the student's chat starts empty, as after a reset
  try {
    // ---------------- 1. portal chooser and admin ----------------
    await page.goto(`${WEB}/`);
    check(await has(page, "Choose how you want to sign in"), "1.1", "portal chooser with three portals");
    await talk(page, 6);
    check(await signIn(page, "admin", "admin@smartedu.edu", "Admin@123", "/admin"), "1.2", "admin signs in");
    check(await has(page, /50,030/), "1.2", "overview shows 50,030 students");
    await talk(page, 6);
    const card = page.locator("section").filter({ has: page.getByRole("heading", { name: /Run predictions/ }) });
    await card.locator("select").selectOption({ label: "Artificial Intelligence" });
    const done = page
      .waitForResponse(async (res) => /\/api\/admin\/predictions\/runs\/\d+$/.test(res.url()) && (await res.json().catch(() => ({}))).status === "completed", { timeout: 90000 })
      .then(() => true)
      .catch(() => false);
    await card.getByRole("button", { name: "Start run" }).click();
    check(await done, "1.3", "AI department run completes; charts refresh");
    await talk(page, 6);
    await page.getByRole("link", { name: "Model", exact: true }).click();
    await at(page, "/admin/model");
    check(await has(page, /RandomForest/), "1.4", "Model page: RandomForestClassifier card");
    check(await has(page, /What the model relies on/), "1.4", "global importance chart");
    await talk(page, 10);
    await logout(page);
    check(await at(page, "/login/admin"), "1.5", "logout returns to the Admin sign-in");

    // ---------------- 2. student portal ----------------
    await page.evaluate(() => {}); // (same window)
    check(await signIn(page, "student", "student144766@smartedu.edu", "Student@123", "/student"), "2.1", "Sobia Butt signs in");
    check(await has(page, "High risk - let's act now"), "2.1", "status: High risk - let's act now");
    await talk(page, 4);
    check(await has(page, /1\.62/) && (await has(page, "Random Forest model")), "2.2", "reasons with CGPA 1.62 and the Random Forest badge");
    await talk(page, 6);
    await page.getByText("What to do next").first().scrollIntoViewIfNeeded();
    await talk(page, 4);
    await page.getByText("Marks by course").first().scrollIntoViewIfNeeded();
    check(await has(page, "Marks by course"), "2.3", "CGPA tiles, What to do next, charts");
    await talk(page, 4);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole("button", { name: "Ask SmartEdu", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "Ask SmartEdu" });
    await panel.waitFor();
    const a1 = await ask(page, panel, "Why am I at risk?");
    check(/1\.62/.test(a1) && /warning/i.test(a1), "2.4", "'Why am I at risk?' -> reasons + 'a warning, not a final result'");
    await talk(page, 6);
    const a2 = await ask(page, panel, "meri attendance kaisi hai?");
    check(/62\.5%/.test(a2) && /20 of 32/.test(a2), "2.5", "Roman Urdu attendance answer: 62.5% (20 of 32)");
    await talk(page, 6);
    const a3 = await ask(page, panel, "What is BU-122785's CGPA?");
    check(/only talk about your own|can't share/i.test(a3) && !/1\.97/.test(a3), "2.6", "another student's CGPA is refused");
    await talk(page, 4);
    await page.keyboard.press("Escape");
    await logout(page);
    check(await at(page, "/login/student"), "2.7", "logout returns to the Student sign-in");

    // ---------------- 3. faculty portal ----------------
    check(await signIn(page, "faculty", "ayesha.khan@smartedu.edu", "Faculty@123", "/faculty"), "3.1", "Dr. Ayesha Khan signs in");
    await talk(page, 3);
    await page.goto(`${WEB}/faculty/class/16/roster`); // "View class" on AI301 · Section A
    check(await has(page, "Risk in this class") && (await has(page, "Needs attention")), "3.2", "AI301 A: risk in this class, charts");
    await talk(page, 5);
    const row = page.locator("tr", { hasText: "BU-112907" });
    await row.getByLabel("Quiz for BU-112907").fill("75");
    await row.getByLabel("Midterm for BU-112907").fill("88");
    await talk(page, 2);
    await row.getByRole("button", { name: "Save" }).click();
    check(await has(page, "BU-112907: At-Risk → Safe"), "3.3", "toast 'BU-112907: At-Risk → Safe', grade C -> B");
    await talk(page, 6);
    await page.getByText("BU-100040").first().click();
    await page.getByRole("tab", { name: "What if?" }).click();
    await page.getByLabel("Attendance").waitFor();
    await page.getByLabel("Attendance").fill("55");
    check(await has(page, "The label would change."), "3.4", "what-if: attendance 55% -> Dropout-Likely, nothing saved");
    check(await has(page, /Dropout-Likely/), "3.4", "scenario label Dropout-Likely");
    await talk(page, 8);
    await page.keyboard.press("Escape");
    await logout(page);
    check(await signIn(page, "faculty", "bilal.raza@smartedu.edu", "Faculty@123", "/faculty"), "3.5", "Mr. Bilal Raza signs in");
    await page.goto(`${WEB}/faculty/class/4/roster?tab=upload`); // CS401 -> Upload tab
    await page.locator('input[type="file"]').setInputFiles(UPLOAD);
    await page.getByText("4. Check before saving").waitFor({ timeout: 15000 });
    check(await has(page, /7 valid/) && (await has(page, /2 with errors?/)), "3.6", "preview: 9 rows, 7 valid, 2 errors highlighted");
    await talk(page, 7);
    await page.getByRole("button", { name: /^Save 7 valid rows?$/ }).click();
    check(await has(page, "Rows saved", 30000) && (await has(page, /BU-145871/)), "3.7", "saved 7, rejected 2, BU-145871 Safe -> At-Risk");
    await talk(page, 6);
    await logout(page);

    // ---------------- 4. admin: counselor and intervention ----------------
    check(await signIn(page, "admin", "admin@smartedu.edu", "Admin@123", "/admin"), "4.1", "admin signs in again");
    await page.goto(`${WEB}/admin/interventions`);
    await page.getByPlaceholder("Roll no, name or email").fill("BU-144766");
    const r = page.locator("tr", { hasText: "BU-144766" });
    await r.waitFor();
    check((await r.textContent()).includes("AI302"), "4.1", "row: weakest course AI302 with its tutorial, counselor Assign");
    await talk(page, 5);
    await r.getByRole("button", { name: "Assign", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "Assign counselor" });
    await modal.getByText("Dr. Ayesha Khan").first().click();
    await modal.getByRole("button", { name: "Assign", exact: true }).click();
    check(await has(page, /Dr\. Ayesha Khan.*not contacted|not contacted yet/), "4.2", "counselor assigned: 'Dr. Ayesha Khan · not contacted yet'");
    await talk(page, 4);
    await page.locator("tr", { hasText: "BU-144766" }).getByRole("button", { name: "Send", exact: true }).click();
    const compose = page.getByRole("dialog");
    check(await compose.getByText(/Recommended for AI302/).first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false), "4.3", "preview ends with 'Recommended for AI302 ...'");
    await talk(page, 4);
    await compose.getByRole("button", { name: "Send", exact: true }).click();
    check(await has(page, /just now/), "4.3", "Last intervention: just now");
    await talk(page, 3);
    await logout(page);
    check(await signIn(page, "student", "student144766@smartedu.edu", "Student@123", "/student"), "4.4", "Sobia signs in again");
    const bell = page.locator("header").getByRole("button", { name: /notification/i }).first();
    check(((await bell.textContent()) || "").includes("2") || (await bell.getAttribute("aria-label") || "").includes("2"), "4.4", "bell shows 2 unread");
    await page.locator("#what-next").scrollIntoViewIfNeeded();
    check(await has(page, "Dr. Ayesha Khan") && (await has(page, /Open tutorial/)), "4.4", "counselor card and Open tutorial");
    await talk(page, 8);
    await logout(page);

    // ---------------- 5. wrong portal ----------------
    await page.goto(`${WEB}/login/faculty`);
    await page.fill("#login-email", "student144766@smartedu.edu");
    await page.fill("#login-password", "Student@123");
    await page.click("button[type=submit]");
    check(await has(page, "This is a student account - please use the Student sign in"), "5.1", "wrong-portal message, no session");
    await talk(page, 5);
    await page.fill("#login-password", "Wrong-pass1");
    await page.click("button[type=submit]");
    check(await has(page, "Invalid email or password"), "5.2", "wrong password: generic message");
    await talk(page, 4);
    await page.goto(`${WEB}/`);
    check(await has(page, "Choose how you want to sign in"), "5.3", "back to the chooser - wrap up");
    await talk(page, 8);
    check(errors.length === 0, "-", `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  } finally {
    const video = page.video();
    await context.close();
    await browser.close();
    const total = clock();
    if (video) {
      const src = await video.path();
      const dest = path.join(OUT, "smartedu_demo_run.webm");
      fs.renameSync(src, dest);
      const mb = (fs.statSync(dest).size / 1024 / 1024).toFixed(1);
      console.log(`\nVideo: ${dest} (${mb} MB)`);
    }
    console.log(`Total: ${total} (talk pauses x${TALK}); ${steps.length - failures}/${steps.length} checks passed`);
    fs.writeFileSync(path.join(OUT, "run.json"), JSON.stringify({ date: new Date().toString(), total, talkScale: TALK, steps }, null, 2));
    process.exit(failures ? 1 : 0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
