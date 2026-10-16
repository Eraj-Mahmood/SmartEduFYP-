const { Pool, types } = require("pg");

// DATE (OID 1082) comes back as the raw 'YYYY-MM-DD' string. The default parser builds a
// local-midnight JS Date, which JSON-serialises in UTC and shifts the day (e.g. 2020-01-01
// became 2019-12-31T19:00:00Z on a +05:00 machine).
types.setTypeParser(1082, (value) => value);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle Postgres client", err);
  process.exit(1);
});

module.exports = pool;
