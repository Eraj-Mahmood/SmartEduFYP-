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

const NAMES = { safe: "On track", at_risk: "Needs attention", dropout_likely: "High risk" };

/** Fuller version for the class page's "Risk in this class" card: the bar, then one row per label
 *  with count and share, so the card fills the height of the charts beside it. */
export function RiskBreakdown({ counts }) {
  const total = SEGMENTS.reduce((n, s) => n + (counts[s.key] || 0), 0);
  if (!total) return <p className="text-sm text-muted">No predictions yet</p>;
  return (
    <div>
      <RiskBar counts={counts} showText={false} />
      <ul className="mt-4 divide-y divide-line">
        {SEGMENTS.map((s) => {
          const n = counts[s.key] || 0;
          return (
            <li key={s.key} className="flex items-center gap-2.5 py-2 text-sm">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden="true" />
              <span className="flex-1 text-ink">{NAMES[s.key]}</span>
              <span className="font-semibold tabular-nums text-ink">{n}</span>
              <span className="w-11 text-right tabular-nums text-muted">{Math.round((100 * n) / total)}%</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-xs text-muted">{total} students with a prediction</p>
    </div>
  );
}
