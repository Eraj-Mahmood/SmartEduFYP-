import { CheckCircle, Warning, AlertOctagon, Info, Close } from "./icons";

// Academic standing under the BU rules (Phase 7) - deliberately a different shape and wording from the
// risk chip: it is a rule outcome, not a prediction. Icon + text, never colour alone.
const STANDING = {
  good: { text: "Good standing", short: "Good", chip: "bg-safe-50 text-safe-700 ring-safe-500/30", Icon: CheckCircle },
  probation_1: { text: "Probation 1 of 2", short: "Probation 1", chip: "bg-risk-50 text-risk-700 ring-risk-500/35", Icon: Warning },
  probation_2: { text: "Probation 2 of 2", short: "Probation 2", chip: "bg-danger-50 text-danger-700 ring-danger-500/30", Icon: AlertOctagon },
  dropped: { text: "Dropped", short: "Dropped", chip: "bg-ink text-white ring-ink", Icon: Close },
  not_evaluated: { text: "Not evaluated yet", short: "Not evaluated", chip: "bg-ink/5 text-muted ring-ink/10", Icon: Info },
};
export const STANDING_OPTIONS = Object.entries(STANDING).map(([value, s]) => ({ value, label: s.text }));
export const standingText = (status) => (STANDING[status] || STANDING.not_evaluated).text;

export default function StandingChip({ status, size = "sm", short = false, className = "" }) {
  const s = STANDING[status] || STANDING.not_evaluated;
  const box = size === "sm" ? "text-xs px-2 py-0.5 gap-1" : size === "lg" ? "text-base px-3.5 py-1.5 gap-2" : "text-sm px-2.5 py-1 gap-1.5";
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-md font-medium ring-1 ring-inset ${s.chip} ${box} ${className}`}>
      <s.Icon size={size === "sm" ? 13 : size === "lg" ? 19 : 15} />
      {short ? s.short : s.text}
    </span>
  );
}
