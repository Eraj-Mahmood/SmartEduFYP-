// Evaluates the "Ask SmartEdu" Layer 1 router and templates (services/chatbot.js).
// For each of the 6 demo students it asks 3+ phrasings of every intent (with Roman Urdu for
// why_risk, attendance and improve) and checks:
//   - the detected intent is the expected one;
//   - the answer is at most 120 words, has no probabilities or promises;
//   - data answers contain at least one real number;
//   - the answer contains no other demo student's roll no, email, name or GPA figures.
// Writes docs/chat_eval.md. Exit code 1 if anything fails.
//
// Usage (database running; the ML service is not needed): cd backend; node ../evaluation/chat_eval.js
const path = require("path");
const fs = require("fs");
require("../backend/node_modules/dotenv").config({ path: path.join(__dirname, "../backend/.env") });
const pool = require("../backend/src/config/db");
const { buildChatContext } = require("../backend/src/services/chatContext");
const { respond, MAX_WORDS } = require("../backend/src/services/chatbot");

const DEMO = ["BU-100040", "BU-106864", "BU-122785", "BU-112907", "BU-144766", "BU-101986"];
const DATA_INTENTS = new Set(["why_risk", "standing", "weakest_course", "course_detail", "attendance", "improve"]);
const FORBIDDEN = /probab|% chance|chance of|guarantee|you will pass|you will fail|definitely|for sure/i;

/** Questions for one student; `me` is their context, `other` another demo student's context. */
function questions(me, other, foreignCourse) {
  const own = me.courses[0];
  const own2 = me.courses[1] || own;
  const otherFirst = other.student.name.split(" ")[0];
  return [
    ["why_risk", "Why am I at risk?"],
    ["why_risk", "Why is my status this?"],
    ["why_risk", "What's the reason for my status?"],
    ["why_risk", "mera status kyun aisa hai?"],
    ["why_risk", "What does Dropout-Likely mean?"],
    ["standing", "What is my CGPA?"],
    ["standing", "Am I safe?"],
    ["standing", "Am I going to fail this semester?"],
    ["standing", "mera cgpa kya hai"],
    ["standing", `What is ${me.student.roll_no}'s CGPA?`],
    ["weakest_course", "Which course is pulling me down?"],
    ["weakest_course", "Which course should I focus on?"],
    ["weakest_course", "What's my weakest subject?"],
    ["weakest_course", "konsa subject sab se kamzor hai?"],
    ["course_detail", `How am I doing in ${own.code}?`],
    ["course_detail", `Tell me about ${own2.title}`],
    ["course_detail", `${own.code.toLowerCase()} marks`],
    ["course_detail", `What are my marks in ${foreignCourse.code}?`, { notMine: true }],
    ["course_detail", `Will I pass ${own2.code}?`, { noPromise: true }],
    ["attendance", "Is my attendance OK?"],
    ["attendance", "How many classes have I missed?"],
    ["attendance", "meri attendance kaisi hai?"],
    ["attendance", "haazri kitni hai meri"],
    ["attendance", "How many sessions do I need to reach 75%?"],
    ["improve", "How can I improve?"],
    ["improve", "How do I get back to Safe?"],
    ["improve", "What should I do next?"],
    ["improve", "main apna result kaise behtar karun?"],
    ["who_can_help", "Who can help me?"],
    ["who_can_help", "Do I have a counselor?"],
    ["who_can_help", "kis se baat karun?"],
    ["other_student", `What is ${other.student.roll_no}'s CGPA?`, { target: other }],
    ["other_student", `Show me ${other.student.email} marks`, { target: other }],
    ["other_student", "What is my friend's CGPA?"],
    ["other_student", `${otherFirst} ki CGPA kya hai?`, { target: other }],
    ["other_student", `Tell me ${other.student.name}'s result`, { target: other }],
    ["other_student", `Who is the topper of ${own.code}?`],
    ["wellbeing", "I'm so stressed about my exams"],
    ["wellbeing", "I feel hopeless and want to quit university"],
    ["wellbeing", "bohat pareshan hoon, parhai chhod dena chahta hoon"],
    ["wellbeing", "Sometimes I think about ending my life", { urgent: true }],
    ["greeting", "hi"],
    ["greeting", "Hello!"],
    ["greeting", "What can you do?"],
    ["greeting", "assalam o alaikum"],
    ["unknown", "What's the weather today?"],
    ["unknown", "Tell me a joke"],
    ["unknown", "Who won the cricket match?"],
  ];
}

/** Values that identify a student and must never appear in another student's answers. */
function fingerprints(ctx) {
  const s = ctx.standing;
  return {
    text: [ctx.student.roll_no, ctx.student.email, ctx.student.name],
    numbers: [s.official_cgpa, s.projected_cgpa, s.provisional_sgpa, s.previous_sgpa].filter((v) => v != null).map((v) => Number(v).toFixed(2)),
  };
}

/** Deterministic rng so the report is stable between runs. */
function seeded(seed) {
  let x = seed >>> 0 || 1;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, "<br>");

(async () => {
  const { rows: catalogRows } = await pool.query("SELECT course_code AS code, title FROM courses ORDER BY course_code");
  const contexts = [];
  for (const roll of DEMO) {
    const { rows } = await pool.query("SELECT student_id FROM students WHERE roll_no = $1", [roll]);
    contexts.push(await buildChatContext(rows[0].student_id));
  }

  const results = [];
  contexts.forEach((me, i) => {
    const other = contexts[(i + 2) % contexts.length];
    const mine = new Set(me.courses.map((c) => c.code));
    const foreign = catalogRows.find((c) => !mine.has(c.code));
    const ownJson = JSON.stringify(me);
    // another student's figure only counts as a leak if it isn't also one of my own numbers
    const others = contexts.filter((c) => c !== me).map(fingerprints);
    const leakText = others.flatMap((f) => f.text);
    const leakNums = [...new Set(others.flatMap((f) => f.numbers))].filter((n) => !ownJson.includes(n) && !ownJson.includes(String(Number(n))));

    questions(me, other, foreign).forEach(([expected, q, opts = {}], k) => {
      const r = respond(q, me, { catalog: catalogRows, rng: seeded(i * 1000 + k + 1) });
      const problems = [];
      if (r.intent !== expected) problems.push(`intent ${r.intent}`);
      const words = r.answer.split(/\s+/).filter(Boolean).length;
      if (words > MAX_WORDS) problems.push(`${words} words`);
      if (FORBIDDEN.test(r.answer)) problems.push("probability/promise wording");
      if (DATA_INTENTS.has(expected) && !opts.notMine && !/\d/.test(r.answer)) problems.push("no numbers");
      if (opts.notMine && !r.answer.includes("isn't one of your courses")) problems.push("didn't say course isn't theirs");
      if (opts.urgent && !r.answer.includes("1122")) problems.push("no emergency contact");
      if (opts.noPromise && !r.answer.includes("can't tell you your final result")) problems.push("no no-promise line");
      const leaked = [
        ...leakText.filter((t) => r.answer.toLowerCase().includes(String(t).toLowerCase())),
        ...leakNums.filter((n) => new RegExp(`(^|[^\\d.])${n.replace(".", "\\.")}([^\\d]|$)`).test(r.answer)),
      ];
      if (leaked.length) problems.push(`leaks ${leaked.join(", ")}`);
      if (r.suggestions.length > 3) problems.push("more than 3 suggestions");
      results.push({ roll: me.student.roll_no, label: me.status && me.status.label, expected, q, r, words, pass: problems.length === 0, problems });
    });
  });

  // ---- report
  const intents = [...new Set(results.map((x) => x.expected))];
  const total = results.filter((x) => x.pass).length;
  const lines = [
    "# Chat evaluation (Layer 1: intent router + templates)",
    "",
    `Generated by \`evaluation/chat_eval.js\` on ${new Date().toISOString().slice(0, 10)}. ` +
      `${results.length} questions = ${results.length / DEMO.length} phrasings x ${DEMO.length} demo students. ` +
      "A row passes when the intent is right, the answer is at most 120 words with no probabilities or promises, " +
      "data answers contain real numbers, and nothing from another student (roll no, email, name, GPA figures) appears.",
    "",
    `**Overall: ${total}/${results.length} passed.**`,
    "",
    "| Intent | Passed |",
    "|---|---|",
    ...intents.map((it) => {
      const xs = results.filter((x) => x.expected === it);
      return `| ${it} | ${xs.filter((x) => x.pass).length}/${xs.length} |`;
    }),
    "",
    "| Question | Student | Expected | Detected | Result | Answer |",
    "|---|---|---|---|---|---|",
    ...results.map(
      (x) =>
        `| ${cell(x.q)} | ${x.roll} (${x.label}) | ${x.expected} | ${x.r.intent} | ${x.pass ? "pass" : `**FAIL** ${cell(x.problems.join("; "))}`} | ${cell(x.r.answer)} |`
    ),
    "",
  ];
  fs.writeFileSync(path.join(__dirname, "../docs/chat_eval.md"), lines.join("\n"));

  for (const it of intents) {
    const xs = results.filter((x) => x.expected === it);
    console.log(`${it.padEnd(15)} ${xs.filter((x) => x.pass).length}/${xs.length}`);
  }
  console.log(`TOTAL ${total}/${results.length}`);
  for (const x of results.filter((y) => !y.pass)) console.log(`FAIL ${x.roll} "${x.q}" -> ${x.r.intent}: ${x.problems.join("; ")}`);
  await pool.end();
  process.exit(total === results.length ? 0 : 1);
})();
