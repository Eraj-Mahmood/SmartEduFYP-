/**
 * sendError(res, err, message) - the one way a handler answers an error.
 * - An error we raised on purpose carries a 4xx `status` (httpError(404, "Student not found"), a 409 from
 *   startRun, ...): its message is meant for the user and is sent as it is (plus `missing` when present).
 * - Anything else (a database error, a bug) is logged with console.error and answered with a 500 and the
 *   plain-English `message`, so a raw database message ("invalid input syntax for type integer",
 *   "relation ... does not exist") never reaches the client.
 */
const GENERIC = "Something went wrong on the server. Please try again.";

function sendError(res, err, message = GENERIC) {
  const status = Number(err && err.status);
  if (status >= 400 && status < 500) {
    return res.status(status).json({ error: err.message, ...(err.missing ? { missing: err.missing } : {}) });
  }
  console.error(err);
  return res.status(500).json({ error: message });
}

module.exports = { sendError, GENERIC };
