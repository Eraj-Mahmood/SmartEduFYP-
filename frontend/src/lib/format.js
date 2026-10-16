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
