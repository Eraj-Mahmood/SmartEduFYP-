// Evaluates the "Ask SmartEdu" Layer 1 router and templates (services/chatbot.js).
// For each of the 6 demo students it asks 3+ phrasings of every intent (with Roman Urdu for
// why_risk, attendance and improve) and checks:
//   - the detected intent is the expected one;
//   - the answer is at most 120 words, has no probabilities or promises;
//   - data answers contain at least one real number;
//   - the answer contains no other demo student's roll no, email, name or GPA figures;
//   - improve / weakest_course answers carry the recommended tutorial (line + link) when the
//     student has one;
//   - who_can_help with a counselor assigned names the counselor and their email (a second pass
//     with a real faculty member as counselor in the context; nothing is written to the database).
//   - counselling_session (Phase 7): with no session booked the answer says so and links the
//     counselling page; a third pass puts a booked session into the context (only there) and checks
//     the date, time, counsellor, place and attended count are quoted. Another student's session is refused.
//   - probation_status / probation_rules (Phase 7, BU rules): answered only from the student's own standing
//     (their label and CGPA used) and the config minimum; "Is <other> on probation?" is refused.
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
const DATA_INTENTS = new Set(["why_risk", "standing", "weakest_course", "my_marks", "course_detail", "attendance", "improve"]);
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
    ["my_marks", "What are my marks?"],
    ["my_marks", "mere marks"],
    ["my_marks", "Show me my grades in every course"],
    ["my_marks", "meri marks kya hain?"],
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
    ["counselling_session", "When is my counselling session?", { noSession: true }],
    ["counselling_session", "meri counselling kab hai?", { noSession: true }],
    ["counselling_session", "Do I have a counselling appointment?", { noSession: true }],
    ["counselling_session", "agla session counsellor ke sath kab hai", { noSession: true }],
    ["other_student", `When is ${otherFirst}'s counselling session?`, { target: other }],
    ["probation_status", "Am I on probation?", { standing: true }],
    ["probation_status", "kya main probation par hoon?", { standing: true }],
    ["probation_status", "What is my academic standing?", { standing: true }],
    ["probation_status", "meri probation ka status kya hai", { standing: true }],
    ["probation_rules", "What happens if my CGPA stays below 2?", { rules: true }],
    ["probation_rules", "agar meri cgpa 2 se kam rahi to kya hoga?", { rules: true }],
    ["probation_rules", "What are the probation rules?", { rules: true }],
    ["probation_rules", "What happens if I get a second probation?", { rules: true }],
    ["other_student", `Is ${otherFirst} on probation?`, { target: other }],
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
      if (opts.standing || opts.rules) {
        const a = me.academic;
        const min = Number(a.minimum).toFixed(2);
        if (!r.answer.includes(min)) problems.push(`minimum ${min} missing`);
        if (opts.standing) {
          const word = { good: "good standing", probation_1: "Probation 1 of 2", probation_2: "Probation 2 of 2", dropped: "dropped", not_evaluated: "Not yet" }[a.status];
          if (!r.answer.includes(word)) problems.push(`own standing (${word}) not stated`);
          if (a.cgpa_used != null && !r.answer.includes(Number(a.cgpa_used).toFixed(2))) problems.push("own CGPA used missing");
          if (!r.answer.includes("separate from your SmartEdu risk prediction")) problems.push("doesn't separate standing from the risk label");
        }
        if (opts.rules && !(/dropped/.test(r.answer) && /5\.5/.test(r.answer) && r.answer.includes(a.label))) problems.push("rules incomplete or own label missing");
        if (!r.links.some((l) => l.href === "/student#standing")) problems.push("no link to the standing card");
      }
      if (opts.noSession) {
        if (me.counselling.next) problems.push("context: a session is booked (the eval expects none)");
        if (!r.answer.includes("don't have a counselling session booked")) problems.push("doesn't say no session is booked");
        if (!r.links.some((l) => l.href === "/student/counselling")) problems.push("no link to the counselling page");
      }
      const leaked = [
        ...leakText.filter((t) => r.answer.toLowerCase().includes(String(t).toLowerCase())),
        ...leakNums.filter((n) => new RegExp(`(^|[^\\d.])${n.replace(".", "\\.")}([^\\d]|$)`).test(r.answer)),
      ];
      if (leaked.length) problems.push(`leaks ${leaked.join(", ")}`);
      if (r.suggestions.length > 3) problems.push("more than 3 suggestions");
      if ((expected === "improve" || expected === "weakest_course") && me.tutorial) {
        if (!r.links.some((l) => l.href === me.tutorial.url)) problems.push("no tutorial link");
        if (!r.answer.includes(me.tutorial.title)) problems.push("no tutorial line");
      }
      results.push({ roll: me.student.roll_no, label: me.status && me.status.label, expected, q, r, words, pass: problems.length === 0, problems });
    });
  });

  // ---- who_can_help with a counselor assigned (context only)
  const { rows: fac } = await pool.query(
    `SELECT f.full_name AS name, f.designation, u.email FROM faculty f JOIN users u ON u.user_id = f.user_id
     WHERE u.email = 'ayesha.khan@smartedu.edu'`
  );
  const counselor = { ...fac[0], assigned_at: new Date().toISOString() };
  const COUNSELOR_QS = ["Who can help me?", "Do I have a counselor?", "kis se baat karun?", "Who should I talk to about my grades?"];
  contexts.forEach((me, i) => {
    const ctx = { ...me, counselor };
    COUNSELOR_QS.forEach((q, k) => {
      const r = respond(q, ctx, { catalog: catalogRows, rng: seeded(50000 + i * 100 + k) });
      const problems = [];
      if (r.intent !== "who_can_help") problems.push(`intent ${r.intent}`);
      if (!r.answer.includes(counselor.name)) problems.push("counselor not named");
      if (!r.answer.includes(counselor.email)) problems.push("no counselor email");
      if (/No counselor is assigned/i.test(r.answer)) problems.push("says no counselor");
      const words = r.answer.split(/\s+/).filter(Boolean).length;
      if (words > MAX_WORDS) problems.push(`${words} words`);
      results.push({ roll: me.student.roll_no, label: me.status && me.status.label, expected: "who_can_help", group: "who_can_help (counselor)", q, r, words, pass: problems.length === 0, problems });
    });
  });

  // ---- counselling_session with a booked session (Phase 7; context only, nothing written)
  const booked = (mode) => ({
    when: "Tue 18 Nov 2026, 11:00 AM",
    counsellor: counselor.name,
    duration_min: 30,
    mode,
    location: mode === "online" ? "https://meet.example.com/abc" : "Room 204",
  });
  const SESSION_QS = [
    ["When is my counselling session?", "in_person"],
    ["meri counselling kab hai?", "in_person"],
    ["When is my next session with my counsellor?", "online"],
    [`When is my session with ${counselor.name}?`, "online"],
  ];
  contexts.forEach((me, i) => {
    SESSION_QS.forEach(([q, mode], k) => {
      const next = booked(mode);
      const ctx = { ...me, counselor, counselling: { next, attended: 2, marked: 3 } };
      const r = respond(q, ctx, { catalog: catalogRows, rng: seeded(55000 + i * 100 + k) });
      const problems = [];
      if (r.intent !== "counselling_session") problems.push(`intent ${r.intent}`);
      if (!r.answer.includes(next.when)) problems.push("date/time missing");
      if (!r.answer.includes(counselor.name)) problems.push("counsellor missing");
      if (mode === "in_person" && !r.answer.includes("Room 204")) problems.push("room missing");
      if (mode === "online" && !r.links.some((l) => l.href === next.location)) problems.push("no meeting link");
      if (!r.answer.includes("attended 2 of 3")) problems.push("attended count missing");
      if (!r.links.some((l) => l.href === "/student/counselling")) problems.push("no link to the counselling page");
      if (FORBIDDEN.test(r.answer)) problems.push("probability/promise");
      const words = r.answer.split(/\s+/).filter(Boolean).length;
      if (words > MAX_WORDS) problems.push(`${words} words`);
      results.push({ roll: me.student.roll_no, label: me.status && me.status.label, expected: "counselling_session", group: "counselling_session (booked)", q, r, words, pass: problems.length === 0, problems });
    });
  });

  // ---- live students (Phase 5/6): imported as a live cohort. This term's marks come from the
  // imported record (no course_results), attendance from the file unless faculty uploaded sessions,
  // several model inputs missing. One student per label; skipped when no cohort has been imported.
  // Phase 6 step 3: the chat must use the imported marks the model used, never "no marks yet".
  const { rows: live } = await pool.query(
    `SELECT DISTINCT ON (p.final_label) s.student_id, sp.assignment_avg, sp.quiz_avg, sp.midterm_marks, sp.final_marks
     FROM students s JOIN predictions p ON p.prediction_id = s.latest_prediction_id
     JOIN student_semester_performance sp ON sp.student_id = s.student_id AND sp.data_source = 'live'
     WHERE s.data_source = 'live'
     ORDER BY p.final_label, s.roll_no`
  );
  const NO_MARKS = /No marks (are )?entered|no marks yet|don't have enough of this term's data/i;
  for (const [i, row] of live.entries()) {
    const me = await buildChatContext(row.student_id);
    const course = me.courses[0];
    const importedMean = Math.round(((+row.assignment_avg) + (+row.quiz_avg) + (+row.midterm_marks) + (+row.final_marks)) / 4);
    const LIVE_QS = [
      ["standing", "What is my CGPA?"],
      ["attendance", "Is my attendance OK?"],
      ["attendance", "meri attendance kaisi hai?"],
      ["my_marks", "What are my marks?"],
      ["my_marks", "mere marks"],
      ["weakest_course", "Which course should I focus on?"],
      ["course_detail", `How am I doing in ${course.code}?`],
      ["improve", "How can I improve?"],
      ["why_risk", "Why is my status this?"],
    ];
    LIVE_QS.forEach(([expected, q], k) => {
      const r = respond(q, me, { catalog: catalogRows, rng: seeded(60000 + i * 100 + k) });
      const problems = [];
      if (r.intent !== expected) problems.push(`intent ${r.intent}`);
      if (/\b(null|NaN|undefined)\b/.test(r.answer)) problems.push("missing value printed");
      if (FORBIDDEN.test(r.answer)) problems.push("probability/promise");
      if (NO_MARKS.test(r.answer)) problems.push('says "no marks" although imported marks feed the model');
      if (!me.standing.term_marks_imported) problems.push("context: imported term marks not detected");
      if (course.marks_source !== "imported" || Math.round(course.mean) !== importedMean) problems.push(`context: ${course.code} mean ${course.mean} != imported ${importedMean}`);
      if (expected === "standing" && !r.answer.includes(Number(me.standing.official_cgpa).toFixed(2))) problems.push("CGPA missing");
      if (["my_marks", "weakest_course", "course_detail"].includes(expected) && !r.answer.includes(String(importedMean))) problems.push(`imported average ${importedMean} not quoted`);
      if (["my_marks", "course_detail"].includes(expected) && !/imported record/.test(r.answer)) problems.push("doesn't say the marks are imported");
      if (expected === "attendance" && me.attendance.source === "live" && !r.answer.includes(`${me.attendance.present} of ${me.attendance.sessions}`)) {
        problems.push("uploaded sessions not quoted");
      }
      if (expected === "attendance" && me.attendance.source !== "live" && !/imported record/.test(r.answer)) problems.push("doesn't say attendance is imported");
      const words = r.answer.split(/\s+/).filter(Boolean).length;
      if (words > MAX_WORDS) problems.push(`${words} words`);
      results.push({ roll: me.student.roll_no, label: me.status && me.status.label, expected, group: "live student (imported marks)", q, r, words, pass: problems.length === 0, problems });
    });
  }

  // ---- report
  const groupOf = (x) => x.group || x.expected;
  const intents = [...new Set(results.map(groupOf))];
  const total = results.filter((x) => x.pass).length;
  const lines = [
    "# Chat evaluation (Layer 1: intent router + templates)",
    "",
    `Generated by \`evaluation/chat_eval.js\` on ${new Date().toISOString().slice(0, 10)}. ` +
      `${results.length} questions: ${results.filter((x) => !x.group).length / DEMO.length} phrasings x ${DEMO.length} demo students, ` +
      `the counselor pass, the booked-session pass and ${results.filter((x) => x.group && x.group.startsWith("live")).length} questions for live-cohort students (this term's marks imported, one per label). ` +
      "A row passes when the intent is right, the answer is at most 120 words with no probabilities or promises, " +
      "data answers contain real numbers, and nothing from another student (roll no, email, name, GPA figures) appears.",
    "",
    `**Overall: ${total}/${results.length} passed.**`,
    "",
    "| Intent | Passed |",
    "|---|---|",
    ...intents.map((it) => {
      const xs = results.filter((x) => groupOf(x) === it);
      return `| ${it} | ${xs.filter((x) => x.pass).length}/${xs.length} |`;
    }),
    "",
    "| Question | Student | Expected | Detected | Result | Answer |",
    "|---|---|---|---|---|---|",
    ...results.map(
      (x) =>
        `| ${cell(x.q)}${x.group ? ` *(${x.group.startsWith("live") ? "live student" : x.group.startsWith("counselling") ? "session booked" : "counselor assigned"})*` : ""} | ${x.roll} (${x.label}) | ${x.expected} | ${x.r.intent} | ${x.pass ? "pass" : `**FAIL** ${cell(x.problems.join("; "))}`} | ${cell(x.r.answer)} |`
    ),
    "",
  ];
  fs.writeFileSync(path.join(__dirname, "../docs/chat_eval.md"), lines.join("\n"));

  for (const it of intents) {
    const xs = results.filter((x) => groupOf(x) === it);
    console.log(`${it.padEnd(25)} ${xs.filter((x) => x.pass).length}/${xs.length}`);
  }
  console.log(`TOTAL ${total}/${results.length}`);
  for (const x of results.filter((y) => !y.pass)) console.log(`FAIL ${x.roll} "${x.q}" -> ${x.r.intent}: ${x.problems.join("; ")}`);
  await pool.end();
  process.exit(total === results.length ? 0 : 1);
})();
