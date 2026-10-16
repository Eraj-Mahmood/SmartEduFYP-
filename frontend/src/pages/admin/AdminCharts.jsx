import { ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { axis, grid, TooltipBox } from "../../components/charts/theme";
import { colors, riskColor } from "../../components/ui/tokens";
import { RISK, riskMeta } from "../../components/ui/risk";
import { Icons } from "../../components/ui";

const ICON = { Safe: Icons.CheckCircle, "At-Risk": Icons.Warning, "Dropout-Likely": Icons.AlertOctagon };

/** Donut of the latest label per student, with counts and % in the legend. */
export function RiskDonut({ counts }) {
  const total = counts.reduce((n, c) => n + c.count, 0);
  const pctOf = (n) => (total ? `${((100 * n) / total).toFixed(1)}%` : "0%");
  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <div className="relative h-[190px] w-[190px] shrink-0">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={counts} dataKey="count" nameKey="label" innerRadius={62} outerRadius={90} paddingAngle={2} stroke="none" isAnimationActive={false}>
              {counts.map((c) => (
                <Cell key={c.label} fill={riskColor[c.label]} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <TooltipBox rows={[{ label: payload[0].name, value: `${payload[0].value.toLocaleString()} (${pctOf(payload[0].value)})`, color: riskColor[payload[0].name] }]} />
                ) : null
              }
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-2xl tabular-nums">{total.toLocaleString()}</span>
          <span className="text-xs text-muted">students</span>
        </div>
      </div>
      <ul className="w-full space-y-2.5">
        {counts.map((c) => {
          const Icon = ICON[c.label];
          return (
            <li key={c.label} className="flex items-center gap-3">
              <span className="h-3 w-3 rounded-sm shrink-0" style={{ background: riskColor[c.label] }} aria-hidden="true" />
              <span className="flex items-center gap-1.5 text-sm text-ink">
                <Icon size={14} className="text-muted" /> {RISK[c.label].formal}
              </span>
              <span className="ml-auto text-sm font-semibold tabular-nums">{c.count.toLocaleString()}</span>
              <span className="w-14 text-right text-sm text-muted tabular-nums">{pctOf(c.count)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const STACK = [
  { key: "safe", label: "Safe" },
  { key: "at_risk", label: "At-Risk" },
  { key: "dropout_likely", label: "Dropout-Likely" },
];
export const stackLegend = STACK.map((s) => ({ label: s.label, color: riskColor[s.label] }));

/** Stacked bars of latest label counts per department. */
export function DepartmentRiskChart({ rows }) {
  return (
    <ResponsiveContainer>
      <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
        <CartesianGrid {...grid} vertical={false} />
        <XAxis dataKey="code" {...axis} interval={0} />
        <YAxis {...axis} width={48} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
        <Tooltip
          cursor={{ fill: colors.brand[50] }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload;
            return (
              <TooltipBox
                title={`${d.name} (${d.total.toLocaleString()})`}
                rows={STACK.slice().reverse().map((s) => ({
                  label: riskMeta(s.label).formal,
                  value: `${d[s.key].toLocaleString()} · ${d.total ? Math.round((100 * d[s.key]) / d.total) : 0}%`,
                  color: riskColor[s.label],
                }))}
              />
            );
          }}
        />
        {STACK.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} stackId="risk" fill={riskColor[s.label]} radius={i === STACK.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
