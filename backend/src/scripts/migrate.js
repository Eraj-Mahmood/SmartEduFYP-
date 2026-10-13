// Usage: npm run migrate
// Applies database/migrations/*.sql in filename order, each in its own
// transaction, and records applied files in schema_migrations so re-runs skip them.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../config/db");

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "database", "migrations");

async function appliedFilenames(client) {
  // schema_migrations is created by 000_init_migrations.sql, so it won't exist on a fresh database
  const { rows } = await client.query("SELECT to_regclass('public.schema_migrations') AS t");
  if (!rows[0].t) return new Set();
  const applied = await client.query("SELECT filename FROM schema_migrations");
  return new Set(applied.rows.map((r) => r.filename));
}

async function main() {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const client = await pool.connect();
  let count = 0;
  try {
    const applied = await appliedFilenames(client);
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        e.message = `${file}: ${e.message}`;
        throw e;
      }
      console.log(`Applied ${file}`);
      count++;
    }
  } finally {
    client.release();
  }
  console.log(count === 0 ? "Database is up to date." : `Applied ${count} migration(s).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
