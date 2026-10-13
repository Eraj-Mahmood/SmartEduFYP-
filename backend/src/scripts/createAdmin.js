// Usage: node src/scripts/createAdmin.js admin@smartedu.edu "Admin@123"
require("dotenv").config();
const bcrypt = require("bcrypt");
const pool = require("../config/db");

async function main() {
  const [, , email, password] = process.argv;
  if (!email || !password) {
    console.error('Usage: node createAdmin.js "admin@smartedu.edu" "Admin@123"');
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, role, must_reset_pw)
     VALUES ($1, $2, 'admin', FALSE)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING user_id, email, role`,
    [email.toLowerCase().trim(), hash]
  );
  console.log("Admin ready:", rows[0]);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
