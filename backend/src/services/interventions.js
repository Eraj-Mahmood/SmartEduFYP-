const pool = require("../config/db");
const { recommendFor } = require("./tutorials");
const { getActiveCounselor } = require("./counselors");
const support = require("../config/support.json");

// Intervention messages from an admin to students: per-student placeholders and an optional
// line with the student's recommended tutorial.
//
// Placeholders: {name} (student's full name), {course} (the course that needs most work, or
// "your coursework" when they have no marked course this term),
// {counselor} (their counselor's name). Anything else in braces is left as it is and reported.

const PLACEHOLDERS = ["name", "course", "counselor"];
const FLAGGED = new Set(["At-Risk", "Dropout-Likely"]);
const MAX_BULK = 500;

/** fillTemplate(text, vars) -> {text, unknown: [...]} (unknown placeholders are kept as-is). Pure. */
function fillTemplate(text, vars) {
  const unknown = new Set();
  const out = String(text).replace(/\{([a-zA-Z_]+)\}/g, (whole, key) => {
    const k = key.toLowerCase();
    if (PLACEHOLDERS.includes(k)) return vars[k];
    unknown.add(whole);
    return whole;
  });
  return { text: out, unknown: [...unknown] };
}

/** The placeholders in a template that aren't supported (for the admin's preview). */
function unknownPlaceholders(...texts) {
  return [...new Set(texts.flatMap((t) => fillTemplate(t || "", {}).unknown))];
}

/** Everything one student's message needs. */
async function studentInfo(studentId) {
  const { rows } = await pool.query(
    `SELECT s.student_id, s.user_id, s.full_name, s.roll_no, s.latest_prediction_id, p.final_label
     FROM students s LEFT JOIN predictions p ON p.prediction_id = s.latest_prediction_id
     WHERE s.student_id = $1`,
    [studentId]
  );
  if (!rows.length) return null;
  const st = rows[0];
  const [rec, counselor] = await Promise.all([recommendFor(studentId, { label: st.final_label }), getActiveCounselor(studentId)]);
  return { ...st, rec, counselor };
}

/** One student's personalised subject/message (+ tutorial line). Pure, given studentInfo(). */
function compose(st, { subject, message, includeTutorial }) {
  const vars = {
    name: st.full_name,
    course: st.rec ? `${st.rec.course.course_code} (${st.rec.course.title})` : "your coursework",
    counselor: st.counselor ? st.counselor.name : `the ${support.office.name}`,
  };
  const s = fillTemplate(subject, vars);
  const m = fillTemplate(message, vars);
  // default: attach the tutorial for flagged students
  const wantTutorial = includeTutorial === undefined || includeTutorial === null ? FLAGGED.has(st.final_label) : !!includeTutorial;
  const t = wantTutorial && st.rec && st.rec.tutorial ? st.rec.tutorial : null;
  const body = t ? `${m.text}\n\nRecommended for ${st.rec.course.course_code}: "${t.title}" - ${t.url}` : m.text;
  return {
    subject: s.text.slice(0, 200),
    message: body,
    tutorial_id: t ? t.tutorial_id : null,
    unknown: [...new Set([...s.unknown, ...m.unknown])],
  };
}

/**
 * sendInterventions(studentIds, {subject, message, includeTutorial, sender}) -> {sent, unknownPlaceholders, notifications}
 * One transaction; unknown student ids are skipped (and counted in `skipped`).
 */
async function sendInterventions(studentIds, { subject, message, includeTutorial, sender }) {
  const ids = [...new Set(studentIds)];
  const infos = [];
  for (let i = 0; i < ids.length; i += 25) {
    infos.push(...(await Promise.all(ids.slice(i, i + 25).map(studentInfo))));
  }
  const found = infos.filter(Boolean);
  const unknown = new Set();
  const client = await pool.connect();
  const out = [];
  try {
    await client.query("BEGIN");
    for (const st of found) {
      const c = compose(st, { subject, message, includeTutorial });
      c.unknown.forEach((u) => unknown.add(u));
      const { rows } = await client.query(
        `INSERT INTO notifications (sender_admin_id, recipient_user_id, subject, message, related_prediction_id,
                                    related_tutorial_id, link, kind)
         VALUES ($1, $2, $3, $4, $5, $6, '/student#what-next', 'intervention') RETURNING notification_id`,
        [sender, st.user_id, c.subject, c.message, st.latest_prediction_id, c.tutorial_id]
      );
      out.push({ notification_id: rows[0].notification_id, student_id: st.student_id, roll_no: st.roll_no, subject: c.subject, message: c.message, related_tutorial_id: c.tutorial_id });
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return { sent: out.length, skipped: ids.length - found.length, unknownPlaceholders: [...unknown], notifications: out };
}

module.exports = { fillTemplate, unknownPlaceholders, compose, studentInfo, sendInterventions, PLACEHOLDERS, MAX_BULK };
