import { CheckCircle, Warning, AlertOctagon, Clock, Close } from "./icons";

// Counselling-session status (computed by the API as display_status). Icon + text, never colour alone.
const STATUS = {
  upcoming: { text: "Upcoming", chip: "bg-brand-50 text-brand-dark ring-brand/30", Icon: Clock },
  awaiting_attendance: { text: "Awaiting attendance", chip: "bg-risk-50 text-risk-700 ring-risk-500/35", Icon: Warning },
  present: { text: "Present", chip: "bg-safe-50 text-safe-700 ring-safe-500/30", Icon: CheckCircle },
  absent: { text: "Absent", chip: "bg-danger-50 text-danger-700 ring-danger-500/30", Icon: AlertOctagon },
  cancelled: { text: "Cancelled", chip: "bg-ink/5 text-muted ring-ink/10", Icon: Close },
};
export const SESSION_STATUSES = Object.entries(STATUS).map(([value, s]) => ({ value, label: s.text }));

export default function SessionStatusChip({ status, size = "sm", className = "" }) {
  const s = STATUS[status] || STATUS.upcoming;
  const box = size === "sm" ? "text-xs px-2 py-0.5 gap-1" : "text-sm px-2.5 py-1 gap-1.5";
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full font-medium ring-1 ring-inset ${s.chip} ${box} ${className}`}>
      <s.Icon size={size === "sm" ? 13 : 15} />
      {s.text}
    </span>
  );
}
