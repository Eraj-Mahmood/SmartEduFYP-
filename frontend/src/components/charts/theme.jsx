import { chart, colors } from "../ui/tokens";

// Shared recharts styling so every chart reads the same.
export const tick = { fontSize: 12, fill: chart.axis };
export const axis = { tick, axisLine: { stroke: colors.line }, tickLine: false };
export const grid = { stroke: chart.grid, strokeDasharray: "0" };

/** Reference-line label, e.g. refLabel("2.30 good standing") */
export function refLabel(value, position = "insideTopRight", fill = chart.reference) {
  return { value, position, fill, fontSize: 11, fontWeight: 500 };
}

/** Compact tooltip box. rows: [{label, value, color?}] */
export function TooltipBox({ title, rows }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-pop">
      {title && <p className="font-medium text-ink mb-1">{title}</p>}
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2 text-muted">
          {r.color && <span className="h-2 w-2 rounded-sm" style={{ background: r.color }} />}
          <span>{r.label}</span>
          <span className="ml-auto pl-3 font-medium text-ink tabular-nums">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

/** Legend as plain HTML (wraps nicely on phones). items: [{label, color}] */
export function Legend({ items, className = "" }) {
  return (
    <ul className={`flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted ${className}`}>
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}
