import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip, LabelList, Cell } from "recharts";
import { axis, grid, TooltipBox } from "../../components/charts/theme";
import { chart, colors } from "../../components/ui/tokens";
import { shortDate } from "../../lib/format";

const GRADE_COLOR = { A: chart.series[0], B: chart.series[0], C: chart.series[3], D: colors.risk.DEFAULT, F: colors.danger.DEFAULT };

export function GradeDistributionChart({ data }) {
  return (
    <ResponsiveContainer>
      <BarChart data={data} margin={{ top: 18, right: 8, bottom: 0, left: -20 }} barCategoryGap="30%">
        <CartesianGrid {...grid} vertical={false} />
        <XAxis dataKey="grade" {...axis} />
        <YAxis allowDecimals={false} {...axis} width={40} />
        <Tooltip
          cursor={{ fill: colors.brand[50] }}
          content={({ active, payload }) =>
            active && payload?.length ? <TooltipBox rows={[{ label: `Grade ${payload[0].payload.grade}`, value: `${payload[0].value} student${payload[0].value === 1 ? "" : "s"}` }]} /> : null
          }
        />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.grade} fill={GRADE_COLOR[d.grade]} />
          ))}
          <LabelList dataKey="count" position="top" style={{ fontSize: 12, fontWeight: 600, fill: colors.ink }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SessionAttendanceChart({ data, minPct = 75 }) {
  return (
    <ResponsiveContainer>
      <LineChart data={data} margin={{ top: 18, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid {...grid} vertical={false} />
        <XAxis dataKey="date" {...axis} tickFormatter={shortDate} minTickGap={16} />
        <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} {...axis} width={44} tickFormatter={(v) => `${v}%`} />
        <ReferenceLine y={minPct} stroke={colors.risk.DEFAULT} strokeDasharray="4 4" />
        <Tooltip
          content={({ active, payload }) =>
            active && payload?.length ? (
              <TooltipBox
                title={shortDate(payload[0].payload.date)}
                rows={[{ label: "Present", value: `${payload[0].payload.present} of ${payload[0].payload.total} (${Math.round(payload[0].value)}%)` }]}
              />
            ) : null
          }
        />
        <Line type="linear" dataKey="attendance_pct" stroke={chart.series[0]} strokeWidth={2} dot={{ r: 3, fill: chart.series[0] }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
