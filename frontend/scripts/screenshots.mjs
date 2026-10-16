// npm run screenshots
// Full-page screenshots of every main screen at 1280px and 390px, saved to docs/screenshots/,
// plus the "Ask SmartEdu" panel after 3 questions for one student of each label.
// Needs the three services running (frontend dev server, backend, ML service) and a
// Chromium for Playwright (one-time: npx playwright install chromium).
// BASE_URL defaults to http://localhost:5173.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE_URL || "http://localhost:5173";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "screenshots");
const WIDTHS = [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
];
const DEMO_STUDENTS = ["100040", "106864", "122785", "112907", "144766", "101986"];

const ACCOUNTS = [
  { name: "admin", email: "admin@smartedu.edu", password: "Admin@123", pages: async () => [
    ["overview", "/admin"],
    ["interventions", "/admin/interventions"],
    ["users", "/admin/users"],
    ["assignments", "/admin/assignments"],
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

async function settle(page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800); // let charts finish layout
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  let count = 0;
  const problems = [];

  for (const viewport of WIDTHS) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => problems.push(`${page.url()}: ${e.message}`));

    await page.goto(`${BASE}/login`);
    await settle(page);
    await page.screenshot({ path: join(OUT, `login-${viewport.width}.png`), fullPage: true });
    count++;

    for (const account of ACCOUNTS) {
      // log in through the API and store the session the way the app does
      await page.goto(`${BASE}/login`);
      const ok = await page.evaluate(async ({ email, password }) => {
        const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
        if (!res.ok) return false;
        const data = await res.json();
        localStorage.setItem("smartedu_token", data.token);
        localStorage.setItem("smartedu_role", data.role);
        return true;
      }, { email: account.email, password: account.password });
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
        await page.screenshot({ path: join(OUT, `${account.name}-${label}-${viewport.width}.png`), fullPage: true });
        count++;
      }
      if (CHAT_STUDENTS.some((id) => account.email === `student${id}@smartedu.edu`)) {
        await chatScreenshot(page, account, viewport, problems);
        count++;
      }
    }
    await ctx.close();
  }
  await browser.close();
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
