// Usage: cd backend; node src/scripts/removeLiveCohort.js [uploadId]
// Without an id: lists the committed cohort imports. With an id: removes the students that import
// created (and its class section, if the import created it and it is now empty). For demo resets;
// the audit log keeps the original import.
require("dotenv").config();
const pool = require("../config/db");
const { removeCohort } = require("../services/liveCohort");

async function main() {
  const id = parseInt(process.argv[2]);
  if (!id) {
    const { rows } = await pool.query(
      `SELECT u.id, u.filename, u.rows_ok, u.committed_at, u.faculty_course_id,
              (SELECT COUNT(*) FROM student_semester_performance sp WHERE sp.upload_id = u.id)::int AS students
       FROM uploads u WHERE u.kind = 'cohort' AND u.status = 'committed' ORDER BY u.id`
    );
    if (!rows.length) console.log("No committed cohort imports.");
    for (const r of rows) console.log(`#${r.id} ${r.filename}: ${r.students} students, class ${r.faculty_course_id}, ${r.committed_at.toISOString()}`);
    console.log("\nRemove one with: node src/scripts/removeLiveCohort.js <id>");
  } else {
    const out = await removeCohort(id);
    console.log(`Removed cohort #${id}: ${out.students} students${out.class_removed ? " and its class section" : ""}.`);
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
