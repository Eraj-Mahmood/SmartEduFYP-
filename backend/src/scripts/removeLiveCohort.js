// Usage: cd backend; node src/scripts/removeLiveCohort.js [uploadId] [--actor <email>]
// Without an id: lists the committed cohort imports. With an id: removes the students that import
// created (and its class section, if the import created it and it is now empty). For demo resets.
// The audit log keeps the original import and gets a REMOVE_LIVE_COHORT entry for the removal
// (actor: the --actor account, else none - a script run has no signed-in user).
require("dotenv").config();
const pool = require("../config/db");
const { removeCohort } = require("../services/liveCohort");

async function main() {
  const args = process.argv.slice(2);
  const a = args.indexOf("--actor");
  const actorEmail = a >= 0 ? args[a + 1] : null;
  const id = parseInt(args.find((x, i) => /^\d+$/.test(x) && args[i - 1] !== "--actor"));
  if (!id) {
    const { rows } = await pool.query(
      `SELECT u.id, u.filename, u.rows_ok, u.committed_at, u.faculty_course_id,
              (SELECT COUNT(*) FROM student_semester_performance sp WHERE sp.upload_id = u.id)::int AS students
       FROM uploads u WHERE u.kind = 'cohort' AND u.status = 'committed' ORDER BY u.id`
    );
    if (!rows.length) console.log("No committed cohort imports.");
    for (const r of rows) console.log(`#${r.id} ${r.filename}: ${r.students} students, class ${r.faculty_course_id}, ${r.committed_at.toISOString()}`);
    console.log("\nRemove one with: node src/scripts/removeLiveCohort.js <id> [--actor admin@smartedu.edu]");
  } else {
    let actorUserId = null;
    if (actorEmail) {
      const { rows } = await pool.query("SELECT user_id FROM users WHERE email = $1", [actorEmail.toLowerCase().trim()]);
      if (!rows.length) throw new Error(`--actor: no account ${actorEmail}`);
      actorUserId = rows[0].user_id;
    }
    const out = await removeCohort(id, { audit: { actorUserId, via: "removeLiveCohort.js" } });
    console.log(`Removed cohort #${id}: ${out.students} students${out.class_removed ? " and its class section" : ""}. Audit-logged (REMOVE_LIVE_COHORT).`);
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
