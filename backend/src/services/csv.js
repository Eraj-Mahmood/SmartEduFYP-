const { parse } = require("csv-parse/sync");

// CSV in and out for uploads and templates. Parsing uses csv-parse (quoted fields, BOM, CRLF).

const MAX_ROWS = 2000;
const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

/** Header names are matched loosely: "Roll No" / "roll_no" / " ROLL-NO " -> "roll_no". */
const normHeader = (h) => String(h || "").trim().toLowerCase().replace(/[\s-]+/g, "_");

/**
 * parseCsv(buffer, {required}) -> {headers, records: [{row, data}]}
 * row = the line number in the file (the header is line 1), so people can find it in Excel.
 * 400 when the file is not valid CSV, misses a required column, has no data or > MAX_ROWS rows.
 */
function parseCsv(buffer, { required = [] } = {}) {
  let out;
  try {
    out = parse(buffer, {
      columns: (header) => header.map(normHeader),
      bom: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      info: true,
    });
  } catch (e) {
    throw httpError(400, `This file is not valid CSV: ${e.message.split("\n")[0]}`);
  }
  if (!out.length) throw httpError(400, "The file has no data rows under the header.");
  const headers = Object.keys(out[0].record);
  const missing = required.filter((c) => !headers.includes(c));
  if (missing.length) throw httpError(400, `Missing column(s): ${missing.join(", ")}. Download the template to see the expected header.`, { missing });
  if (out.length > MAX_ROWS) throw httpError(400, `The file has ${out.length} rows; the limit is ${MAX_ROWS}.`);
  // a row that is entirely blank apart from separators (e.g. ",,,,") is skipped like an empty line
  const records = out
    .map(({ record, info }) => ({ row: info.lines, data: record }))
    .filter((r) => Object.values(r.data).some((v) => v !== "" && v != null));
  if (!records.length) throw httpError(400, "The file has no data rows under the header.");
  return { headers, records };
}

/** One CSV field: quoted when needed; a leading = + - @ is prefixed with ' so Excel won't run it. */
function csvField(v) {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV text (UTF-8 BOM so Excel reads names correctly, CRLF lines). */
function toCsv(header, rows) {
  return "﻿" + [header, ...rows].map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}

/** Today's date as YYYY-MM-DD in the server's local time zone. */
function todayLocal(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** True for a real calendar date written as YYYY-MM-DD. */
function isIsoDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** "" -> null (keep), a number in [lo, hi] -> number, anything else -> NaN. */
function parseNumber(v, lo = 0, hi = 100) {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const s = String(v).trim().replace(/%$/, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  const n = Number(s);
  return n >= lo && n <= hi ? n : NaN;
}

module.exports = { parseCsv, toCsv, csvField, normHeader, todayLocal, isIsoDate, parseNumber, MAX_ROWS, httpError };
