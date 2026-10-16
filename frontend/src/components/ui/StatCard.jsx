import Tooltip from "./Tooltip";
import { Info } from "./icons";

const TREND = {
  good: "text-safe-700 bg-safe-50",
  bad: "text-danger-700 bg-danger-50",
  neutral: "text-muted bg-ink/5",
};
const ARROW = { up: "▲", down: "▼", flat: "▬" };

/**
 * StatCard label value sublabel trend={{direction: "up"|"down"|"flat", text, tone: "good"|"bad"|"neutral"}}
 * info: optional tooltip text explaining the number.
 */
export default function StatCard({ label, value, sublabel, trend, info, icon, tone, className = "" }) {
  const accent = { safe: "before:bg-safe", risk: "before:bg-risk", danger: "before:bg-danger", brand: "before:bg-brand" }[tone];
  return (
    <div
      className={`relative bg-surface rounded-card border border-line shadow-card px-4 py-4 min-w-0 overflow-hidden ${
        accent ? `before:absolute before:left-0 before:top-0 before:h-full before:w-1 ${accent}` : ""
      } ${className}`}
    >
      <div className="flex items-start gap-1.5 text-[13px] text-muted">
        {icon}
        <span className="leading-tight">{label}</span>
        {info && (
          <Tooltip content={info}>
            <button type="button" className="text-muted hover:text-ink rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand" aria-label={`About ${label}`}>
              <Info size={14} />
            </button>
          </Tooltip>
        )}
      </div>
      <div className="mt-1.5 font-display text-[28px] leading-none text-ink tabular-nums">{value ?? "—"}</div>
      {(sublabel || trend) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {trend && (
            <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium ${TREND[trend.tone || "neutral"]}`}>
              <span aria-hidden="true" className="text-[9px]">{ARROW[trend.direction || "flat"]}</span>
              {trend.text}
            </span>
          )}
          {sublabel && <span className="text-muted">{sublabel}</span>}
        </div>
      )}
    </div>
  );
}
