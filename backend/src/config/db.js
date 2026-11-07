const { Pool, types } = require("pg");

// DATE (OID 1082) comes back as the raw 'YYYY-MM-DD' string. The default parser builds a
// local-midnight JS Date, which JSON-serialises in UTC and shifts the day (e.g. 2020-01-01
// became 2019-12-31T19:00:00Z on a +05:00 machine).
types.setTypeParser(1082, (value) => value);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// An idle client can die under us (database restarted, or `npm run demo:reset` dropping the
// database WITH (FORCE)). pg removes that client from the pool and the next query opens a new
// connection, so log it and keep serving instead of exiting.
pool.on("error", (err) => {
  console.error("Idle Postgres client lost (the pool will reconnect):", err.message);
});

module.exports = pool;
