// Small display helpers shared by the dashboards.

export function timeAgo(value) {
  if (!value) return "never";
  const then = new Date(value).getTime();
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(value).toLocaleDateString();
}

export const gpa = (v) => (v == null || Number.isNaN(Number(v)) ? "—" : Number(v).toFixed(2));
export const pct = (v, digits = 0) => (v == null ? "—" : `${Number(v).toFixed(digits)}%`);
export const num = (v, digits = 1) => (v == null ? "—" : Number(v).toFixed(digits).replace(/\.0+$/, ""));

export function shortDate(value) {
  if (!value) return "";
  // DATE columns arrive as 'YYYY-MM-DD'; parse as a local date so the day never shifts
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** "16 Oct 2026" */
export function longDate(value) {
  if (!value) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function firstName(fullName) {
  return (fullName || "").split(" ")[0] || "there";
}

// ---- Pakistan time (Phase 7: counselling sessions) ----
// Session times are stored as TIMESTAMPTZ and always shown in Asia/Karachi time, whatever the
// browser's own zone: "Mon 16 Nov 2026, 11:00 AM". Pakistan has no daylight saving (UTC+5 all year).
export const PK_TIME_ZONE = "Asia/Karachi";
const PK_OFFSET = "+05:00";
const pkFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: PK_TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hourCycle: "h12",
});
const pkIso = new Intl.DateTimeFormat("en-CA", {
  timeZone: PK_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
function pkParts(fmt, value) {
  const p = {};
  for (const { type, value: v } of fmt.formatToParts(new Date(value))) p[type] = v;
  return p;
}

/** "Mon 16 Nov 2026" */
export function pkDate(value) {
  if (!value) return "";
  const p = pkParts(pkFmt, value);
  return `${p.weekday} ${p.day} ${p.month} ${p.year}`;
}
/** "11:00 AM" */
export function pkTime(value) {
  if (!value) return "";
  const p = pkParts(pkFmt, value);
  return `${p.hour}:${p.minute} ${p.dayPeriod.toUpperCase()}`;
}
/** "Mon 16 Nov 2026, 11:00 AM" */
export const pkDateTime = (value) => (value ? `${pkDate(value)}, ${pkTime(value)}` : "");

/** {date: "2026-11-16", time: "11:00"} in Pakistan time, for <input type="date"> / <input type="time">. */
export function pkInputs(value = new Date()) {
  const p = pkParts(pkIso, value);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === "24" ? "00" : p.hour}:${p.minute}` };
}
/** "2026-11-16" + "11:00" (Pakistan time) -> "2026-11-16T11:00:00+05:00" for the API. */
export const pkToIso = (date, time) => `${date}T${time}:00${PK_OFFSET}`;
/** Adds days to a YYYY-MM-DD string. */
export function addDays(ymd, days) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
