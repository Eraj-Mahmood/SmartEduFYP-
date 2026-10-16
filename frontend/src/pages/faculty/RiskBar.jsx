import { colors } from "../../components/ui/tokens";

const SEGMENTS = [
  { key: "safe", label: "on track", color: colors.safe.DEFAULT },
  { key: "at_risk", label: "need attention", color: colors.risk.DEFAULT },
  { key: "dropout_likely", label: "high risk", color: colors.danger.DEFAULT },
];

/** Mini stacked bar of risk counts, with the counts spelled out (never colour alone). */
export default function RiskBar({ counts, showText = true }) {
  const total = SEGMENTS.reduce((n, s) => n + (counts[s.key] || 0), 0);
  if (!total) return <p className="text-sm text-muted">No predictions yet</p>;
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-ink/[0.06]" role="img" aria-label={SEGMENTS.map((s) => `${counts[s.key] || 0} ${s.label}`).join(", ")}>
        {SEGMENTS.map((s) =>
          counts[s.key] ? <span key={s.key} style={{ width: `${(100 * counts[s.key]) / total}%`, background: s.color }} className="h-full first:rounded-l-full last:rounded-r-full border-r-2 border-surface last:border-r-0" /> : null
        )}
      </div>
      {showText && (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
          {SEGMENTS.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} aria-hidden="true" />
              <span className="font-semibold text-ink tabular-nums">{counts[s.key] || 0}</span> {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
