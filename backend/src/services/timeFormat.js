// Times are stored as TIMESTAMPTZ and shown in Pakistan time, e.g. "Mon 16 Nov 2026, 11:00 AM".
// Used in API messages and notifications (Phase 7: counselling sessions).

const TIME_ZONE = "Asia/Karachi";

const fmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function parts(date) {
  const p = {};
  for (const { type, value } of fmt.formatToParts(new Date(date))) p[type] = value;
  return p;
}

/** "11:00 AM" */
function formatTime(date) {
  const p = parts(date);
  return `${p.hour}:${p.minute} ${p.dayPeriod.toUpperCase()}`;
}

/** "Mon 16 Nov 2026" */
function formatDay(date) {
  const p = parts(date);
  return `${p.weekday} ${p.day} ${p.month} ${p.year}`;
}

/** "Mon 16 Nov 2026, 11:00 AM" */
function formatDateTime(date) {
  return `${formatDay(date)}, ${formatTime(date)}`;
}

/** "Mon 16 Nov 2026, 11:00 AM to 11:30 AM" */
function formatRange(start, durationMin) {
  const end = new Date(new Date(start).getTime() + durationMin * 60000);
  return `${formatDateTime(start)} to ${formatTime(end)}`;
}

module.exports = { TIME_ZONE, formatTime, formatDay, formatDateTime, formatRange };
