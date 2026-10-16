import { CheckCircle, Warning, AlertOctagon, Info } from "./icons";
import { riskMeta } from "./risk";

// Icon + text, never colour alone.
const TONE = {
  safe: { chip: "bg-safe-50 text-safe-700 ring-safe-500/30", Icon: CheckCircle },
  risk: { chip: "bg-risk-50 text-risk-700 ring-risk-500/35", Icon: Warning },
  danger: { chip: "bg-danger-50 text-danger-700 ring-danger-500/30", Icon: AlertOctagon },
  neutral: { chip: "bg-ink/5 text-muted ring-ink/10", Icon: Info },
};

const SIZE = {
  sm: { box: "text-xs px-2 py-0.5 gap-1", icon: 13 },
  md: { box: "text-sm px-2.5 py-1 gap-1.5", icon: 15 },
  lg: { box: "text-base px-3.5 py-1.5 gap-2", icon: 19 },
};

/**
 * RiskChip label="At-Risk"
 *  - supportive: show the student wording ("Needs attention") with the formal label underneath
 *  - short: compact staff wording ("High risk") instead of the formal label
 */
export default function RiskChip({ label, size = "md", supportive = false, short = false, className = "" }) {
  const meta = riskMeta(label);
  const tone = TONE[meta.tone];
  const s = SIZE[size];
  const text = supportive ? meta.supportive : short ? meta.short : meta.formal;

  const chip = (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full font-medium ring-1 ring-inset ${tone.chip} ${s.box} ${supportive ? "" : className}`}
    >
      <tone.Icon size={s.icon} />
      {text}
    </span>
  );
  if (!supportive) return chip;
  return (
    <span className={`inline-flex flex-col items-start gap-1 ${className}`}>
      {chip}
      <span className="text-xs text-muted pl-1">
        Formal label: <span className="font-medium text-ink/80">{meta.formal}</span>
      </span>
    </span>
  );
}
