// Performs every demo action in docs/DEMO_ACCOUNTS.md through the real API (in-process, the same
// routes the UI calls), checks the documented outcome, and reverts it. Run right after
// `npm run demo:reset`, with the ML service running:
//
//   cd backend; node ../evaluation/demo_actions_check.js [--write-demo-files]
//
// --write-demo-files first rewrites docs/demo_files/*.csv from the current class 4 marks.
// Exit code 1 if any check fails. Reverting re-saves the original marks, so those rows end up tagged
// `live` and extra prediction rows exist: run `npm run demo:reset` again for a pristine database.
process.env.NODE_ENV = process.env.NODE_ENV || "development";
const path = require("path");
const fs = require("fs");
const BACKEND = path.join(__dirname, "..", "backend");
require(path.join(BACKEND, "node_modules", "dotenv")).config({ path: path.join(BACKEND, ".env") });
const request = require(path.join(BACKEND, "node_modules", "supertest"));
const app = require(path.join(BACKEND, "src", "app"));
const pool = require(path.join(BACKEND, "src", "config", "db"));

const DEMO_FILES = path.join(__dirname, "..", "docs", "demo_files");
const UPLOAD_FILE = path.join(DEMO_FILES, "demo_marks_upload_CS401_A.csv");
const UNDO_FILE = path.join(DEMO_FILES, "demo_marks_undo_CS401_A.csv");

// ---- what docs/DEMO_ACCOUNTS.md promises -------------------------------------------------------
const DEMO_STUDENTS = {
  "BU-100040": "Safe", "BU-106864": "Safe",
  "BU-122785": "At-Risk", "BU-112907": "At-Risk",
  "BU-144766": "Dropout-Likely", "BU-101986": "Dropout-Likely",
};
const MARK_DEMO = { roll: "BU-112907", course: "AI301", quiz: 75, midterm: 88 };        // At-Risk -> Safe
const WHATIF_DEMO = { roll: "BU-100040", attendance: 55, expect: "Dropout-Likely" };     // Safe -> Dropout-Likely
const UPLOAD_DEMO = {
  classId: 4, course: "CS401", flip: "BU-145871", weak: [55, 40, 28, 30],                  // Safe -> At-Risk
  badQuiz: "BU-127235", wrongRoll: "BU-100099",
};
const COUNSEL_DEMO = { roll: "BU-144766", counselor: "Dr. Ayesha Khan", weakest: "AI302" };
const CHAT_QUESTIONS = [
  ["Why is my status this?", "why_risk"],
  ["meri attendance kaisi hai?", "attendance"],
  ["How can I improve?", "improve"],
  ["What is BU-122785's CGPA?", "other_student"],
];

let failures = 0;
function check(ok, label, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}
const as = (t) => ({ Authorization: `Bearer ${t}` });
async function login(email, password, portal) {
  const r = await request(app).post("/api/auth/login").send({ email, password, portal: portal || (email.startsWith("admin@") ? "admin" : email.startsWith("student") ? "student" : "faculty") });
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.token;
}
const sid = async (roll) => (await pool.query("SELECT student_id, user_id FROM students WHERE roll_no = $1", [roll])).rows[0];
const marksOf = (r) => ({ assignment_avg: +r.assignment_avg, quiz_avg: +r.quiz_avg, midterm_marks: +r.midterm_marks, final_marks: +r.final_marks });
const latest = async (studentId) =>
  (await pool.query("SELECT p.* FROM students s JOIN predictions p ON p.prediction_id = s.latest_prediction_id WHERE s.student_id = $1", [studentId])).rows[0];

async function classMarks(classId) {
  const { rows } = await pool.query(
    `SELECT s.roll_no, s.full_name, cr.* FROM enrollments e JOIN students s USING (student_id)
     JOIN course_results cr USING (enrollment_id) WHERE e.faculty_course_id = $1 ORDER BY s.roll_no`,
    [classId]
  );
  return rows;
}

const n = (v) => String(Number(v));
function writeDemoFiles(rows) {
  const header = "roll_no,name,assignment_avg,quiz_avg,midterm_marks,final_marks";
  const lines = rows.map((r) => {
    if (r.roll_no === UPLOAD_DEMO.flip) return [r.roll_no, r.full_name, ...UPLOAD_DEMO.weak].join(",");
    const quiz = r.roll_no === UPLOAD_DEMO.badQuiz ? "8O" : n(r.quiz_avg); // letter O: a typo the preview must catch
    return [r.roll_no, r.full_name, n(r.assignment_avg), quiz, n(r.midterm_marks), n(r.final_marks)].join(",");
  });
  lines.push(`${UPLOAD_DEMO.wrongRoll},Wrong Class,80,80,80,80`);
  fs.writeFileSync(UPLOAD_FILE, [header, ...lines].join("\n") + "\n");
  const f = rows.find((r) => r.roll_no === UPLOAD_DEMO.flip);
  fs.writeFileSync(UNDO_FILE, [header, [f.roll_no, f.full_name, n(f.assignment_avg), n(f.quiz_avg), n(f.midterm_marks), n(f.final_marks)].join(",")].join("\n") + "\n");
  console.log(`wrote ${path.relative(process.cwd(), UPLOAD_FILE)} and ${path.relative(process.cwd(), UNDO_FILE)}`);
}

async function main() {
  const t0 = new Date();
  const health = await fetch(process.env.ML_SERVICE_URL.replace(/\/predict\/?$/, "") + "/health").then((r) => r.json()).catch(() => null);
  if (!health) throw new Error("the ML service is not running (the demo needs real model labels)");

  const [admin, ayesha, bilal] = await Promise.all([
    login("admin@smartedu.edu", "Admin@123"),
    login("ayesha.khan@smartedu.edu", "Faculty@123"),
    login("bilal.raza@smartedu.edu", "Faculty@123"),
  ]);

  console.log("\n== Demo students ==");
  for (const [roll, label] of Object.entries(DEMO_STUDENTS)) {
    const s = await sid(roll);
    const p = await latest(s.student_id);
    const { rows: [x] } = await pool.query(
      `SELECT st.full_name, sp.cgpa, sp.target_label,
              string_agg(cr.grade, ', ' ORDER BY c.course_code) AS grades,
              AVG(CASE cr.grade WHEN 'A' THEN 4 WHEN 'B' THEN 3 WHEN 'C' THEN 2 WHEN 'D' THEN 1 ELSE 0 END) AS pts
       FROM students st JOIN student_semester_performance sp USING (student_id)
       JOIN enrollments e USING (student_id) JOIN course_results cr USING (enrollment_id)
       JOIN faculty_courses fc USING (faculty_course_id) JOIN courses c USING (course_id)
       WHERE st.student_id = $1 GROUP BY 1, 2, 3`,
      [s.student_id]
    );
    const ok = p.final_label === label && p.model_label === label && p.source === "model" && x.target_label === label && Math.abs(x.pts - x.cgpa) <= 0.5;
    check(ok, `${roll} ${x.full_name}: ${label}`, `model ${p.model_label}, dataset ${x.target_label}, CGPA ${x.cgpa}, grades ${x.grades}`);
  }

  console.log("\n== Live re-prediction (faculty mark change) ==");
  {
    const s = await sid(MARK_DEMO.roll);
    const { rows: [r] } = await pool.query(
      `SELECT e.enrollment_id, e.faculty_course_id, cr.* FROM enrollments e JOIN course_results cr USING (enrollment_id)
       JOIN faculty_courses fc USING (faculty_course_id) JOIN courses c USING (course_id)
       WHERE e.student_id = $1 AND c.course_code = $2 AND fc.section = 'A'`,
      [s.student_id, MARK_DEMO.course]
    );
    const orig = marksOf(r);
    console.log(`      ${MARK_DEMO.roll} ${MARK_DEMO.course} (class ${r.faculty_course_id}) today: assignment ${orig.assignment_avg}, quiz ${orig.quiz_avg}, midterm ${orig.midterm_marks}, final ${orig.final_marks}, grade ${r.grade}`);
    const put = (body) => request(app).put(`/api/faculty/results/${r.enrollment_id}`).set(as(ayesha)).send(body);
    const a = await put({ ...orig, quiz_avg: MARK_DEMO.quiz, midterm_marks: MARK_DEMO.midterm });
    check(a.status === 200 && a.body.grade === "B" && a.body.prediction.old_label === "At-Risk" && a.body.prediction.new_label === "Safe",
      `quiz ${MARK_DEMO.quiz}, midterm ${MARK_DEMO.midterm}: ${r.grade} -> ${a.body.grade}, ${a.body.prediction?.old_label} -> ${a.body.prediction?.new_label}`,
      `projected CGPA ${a.body.prediction?.projected_cgpa}`);
    const st = await login(`student${MARK_DEMO.roll.slice(3)}@smartedu.edu`, "Student@123");
    const dash = await request(app).get("/api/student/dashboard").set(as(st));
    check(dash.body.latestPrediction?.final_label === "Safe", "student dashboard shows Safe", `projected CGPA ${dash.body.projectedCgpa?.value ?? JSON.stringify(dash.body.projectedCgpa)}`);
    const b = await put(orig);
    check(b.body.grade === r.grade && b.body.prediction.new_label === "At-Risk", `undo (original marks): back to ${b.body.grade}, ${b.body.prediction.new_label}`);
  }

  console.log("\n== What-if (nothing saved) ==");
  {
    const s = await sid(WHATIF_DEMO.roll);
    const before = (await pool.query("SELECT COUNT(*)::int AS n FROM predictions WHERE student_id = $1", [s.student_id])).rows[0].n;
    const w = await request(app).post(`/api/faculty/students/${s.student_id}/what-if`).set(as(ayesha)).send({ overrides: { Attendance_Percentage: WHATIF_DEMO.attendance } });
    const top = (w.body.scenario?.drivers || [])[0] || {};
    check(w.status === 200 && w.body.baseline.final_label === "Safe" && w.body.scenario.final_label === WHATIF_DEMO.expect && w.body.scenario.source === "model",
      `${WHATIF_DEMO.roll} attendance ${WHATIF_DEMO.attendance}%: ${w.body.baseline?.final_label} -> ${w.body.scenario?.final_label} (model said ${w.body.scenario?.model_label})`,
      `top driver ${top.feature} ${top.direction}`);
    const after = (await pool.query("SELECT COUNT(*)::int AS n FROM predictions WHERE student_id = $1", [s.student_id])).rows[0].n;
    check(after === before, "no prediction row saved");
  }

  console.log("\n== Upload with errors (CS401 A as bilal.raza) ==");
  {
    if (process.argv.includes("--write-demo-files")) writeDemoFiles(await classMarks(UPLOAD_DEMO.classId));
    const flip = await sid(UPLOAD_DEMO.flip);
    const p0 = await latest(flip.student_id);
    const up = (file, mode) =>
      request(app).post(`/api/faculty/classes/${UPLOAD_DEMO.classId}/upload?kind=results&mode=${mode}`).set(as(bilal))
        .attach("file", fs.readFileSync(file), { filename: path.basename(file), contentType: "text/csv" });
    const pv = await up(UPLOAD_FILE, "preview");
    check(pv.status === 200 && pv.body.summary.rows_total === 9 && pv.body.summary.rows_ok === 7 && pv.body.summary.rows_failed === 2,
      `preview: ${pv.body.summary?.rows_total} rows, ${pv.body.summary?.rows_ok} valid, ${pv.body.summary?.rows_failed} with errors`,
      (pv.body.errors || []).map((e) => `row ${e.row} ${e.roll_no} ${e.column}: ${e.message}`).join("; "));
    const cm = await up(UPLOAD_FILE, "commit");
    const changed = cm.body.labels_changed || [];
    const c = changed.find((x) => x.roll_no === UPLOAD_DEMO.flip) || {};
    const p1 = await latest(flip.student_id);
    check(cm.status === 200 && cm.body.summary.rows_ok === 7 && cm.body.summary.rows_failed === 2 && changed.length === 1 && p0.final_label === "Safe" && p1.final_label === "At-Risk",
      `commit: saved ${cm.body.summary?.rows_ok}, rejected ${cm.body.summary?.rows_failed}, re-predicted ${cm.body.repredicted}, labels changed ${changed.length}: ${UPLOAD_DEMO.flip} ${c.name || ""} ${p0.final_label} -> ${p1.final_label}`,
      `projected CGPA ${p0.features.CGPA} -> ${p1.features.CGPA}`);
    const un = await up(UNDO_FILE, "commit");
    const p2 = await latest(flip.student_id);
    check(un.status === 200 && un.body.summary.rows_ok === 1 && p2.final_label === "Safe", `undo file: ${UPLOAD_DEMO.flip} back to ${p2.final_label}`, `projected CGPA ${p2.features.CGPA}`);
  }

  console.log("\n== Interventions / counselor demo ==");
  {
    const s = await sid(COUNSEL_DEMO.roll);
    const { rows: [fac] } = await pool.query("SELECT faculty_id, user_id FROM faculty WHERE full_name = $1", [COUNSEL_DEMO.counselor]);
    const list = await request(app).get(`/api/admin/at-risk-students?search=${COUNSEL_DEMO.roll}`).set(as(admin));
    const row = list.body.rows[0];
    check(row && row.weakest_course?.course_code === COUNSEL_DEMO.weakest && row.tutorial && !row.counselor && !row.last_intervention_at,
      `${COUNSEL_DEMO.roll} row: weakest ${row?.weakest_course?.course_code} (avg ${Math.round(row?.weakest_course?.mean)}), tutorial "${row?.tutorial?.title}", counselor ${row?.counselor ? "set" : "none"}, last intervention ${row?.last_intervention_at || "never"}`);
    const asg = await request(app).post("/api/admin/counselors").set(as(admin)).send({ studentId: s.student_id, facultyId: fac.faculty_id });
    check(asg.status === 201, `assign ${COUNSEL_DEMO.counselor}`, `status ${asg.status}`);
    const msg = {
      subject: "Let's plan your next steps, {name}",
      message: "Hi {name}, your recent results show {course} needs some extra attention. Please meet {counselor} this week - they can help you plan.",
      includeTutorial: true,
    };
    const pre = await request(app).post("/api/admin/notifications/preview").set(as(admin)).send({ studentId: s.student_id, ...msg });
    const tail = String(pre.body.message || "").split("\n").pop();
    check(pre.status === 200 && tail.includes(`Recommended for ${COUNSEL_DEMO.weakest}`), "preview ends with the tutorial line", tail);
    const sent = await request(app).post("/api/admin/notifications").set(as(admin)).send({ recipient_user_id: s.user_id, ...msg });
    check([200, 201].includes(sent.status), "intervention sent", `status ${sent.status}`);
    const st = await login(`student${COUNSEL_DEMO.roll.slice(3)}@smartedu.edu`, "Student@123");
    const bell = await request(app).get("/api/notifications/mine").set(as(st));
    check(bell.body.unreadCount === 2, `student bell: ${bell.body.unreadCount} unread`);
    const dash = await request(app).get("/api/student/dashboard").set(as(st));
    check(dash.body.counselor?.name === COUNSEL_DEMO.counselor && !!dash.body.recommendation?.tutorial,
      `dashboard: counselor ${dash.body.counselor?.name}, tutorial "${dash.body.recommendation?.tutorial?.title}"`);
    const who = await request(app).post("/api/student/chat").set(as(st)).send({ message: "Who can help me?" });
    check(String(who.body.answer).includes("Ayesha Khan"), `chat "Who can help me?" names ${COUNSEL_DEMO.counselor}`);
    const cs = await request(app).get("/api/faculty/counselees").set(as(ayesha));
    check((cs.body || []).some((x) => x.student_id === s.student_id || x.roll_no === COUNSEL_DEMO.roll), "listed in Dr. Khan's My counselees");
    const fbell = await request(app).get("/api/notifications/mine").set(as(ayesha));
    check(fbell.body.notifications.some((x) => /assigned as counselor/.test(`${x.subject} ${x.message}`)), "faculty bell has the assignment notice");
    // undo
    const close = await request(app).put(`/api/admin/counselors/${asg.body.id}/close`).set(as(admin));
    check(close.status === 200, "undo: assignment closed");
    await pool.query("DELETE FROM notifications WHERE recipient_user_id = ANY($1) AND sent_at >= $2", [[s.user_id, fac.user_id], t0]);
    await pool.query("DELETE FROM chat_messages WHERE student_id = $1 AND created_at >= $2", [s.student_id, t0]);
    const after = await request(app).get(`/api/admin/at-risk-students?search=${COUNSEL_DEMO.roll}`).set(as(admin));
    check(!after.body.rows[0].counselor, "undo: row shows Assign again");
  }

  console.log("\n== Chat demo (Layer 1) ==");
  {
    const s = await sid(COUNSEL_DEMO.roll);
    const st = await login(`student${COUNSEL_DEMO.roll.slice(3)}@smartedu.edu`, "Student@123");
    for (const [q, intent] of CHAT_QUESTIONS) {
      const r = await request(app).post("/api/student/chat").set(as(st)).send({ message: q });
      check(r.status === 200 && r.body.intent === intent && r.body.source === "template", `"${q}" -> ${r.body.intent} (${r.body.source})`);
      console.log(`      ${String(r.body.answer).replace(/\n+/g, " | ")}`);
    }
    await pool.query("DELETE FROM chat_messages WHERE student_id = $1 AND created_at >= $2", [s.student_id, t0]);
  }

  console.log(`\n${failures === 0 ? "ALL DEMO ACTIONS PASS" : `${failures} CHECK(S) FAILED`}`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});
