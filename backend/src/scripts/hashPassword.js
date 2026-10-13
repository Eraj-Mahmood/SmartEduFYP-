// Usage: node src/scripts/hashPassword.js "YourPassword123"
const bcrypt = require("bcrypt");

const pw = process.argv[2];
if (!pw) {
  console.error("Usage: node hashPassword.js <password>");
  process.exit(1);
}
bcrypt.hash(pw, 10).then((hash) => console.log(hash));
