import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, ReferenceLine,
  Tooltip, LabelList, Cell,
} from "recharts";
import { axis, grid, refLabel, tick, TooltipBox, Legend } from "../../components/charts/theme";
import { chart, colors, riskColor } from "../../components/ui/tokens";
import { RISK, RISK_SEVERITY } from "../../components/ui/risk";
import { gpa, shortDate } from "../../lib/format";

const gpaColor = (v, t) => (v < t.probation_cgpa ? colors.danger.DEFAULT : v < t.at_risk_cgpa ? colors.risk.DEFAULT : colors.safe.DEFAULT);
const attColor = (v, t) =>
  v < t.severe_attendance_pct ? colors.danger.DEFAULT : v < t.min_attendance_pct ? colors.risk.DEFAULT : colors.safe.DEFAULT;

/** Axis tick split over two lines ("Projected" / "CGPA") so three labels fit on a phone. */
function TwoLineTick({ x, y, payload }) {
  const words = String(payload.value).split(" ");
  const last = words.pop();
  return (
    <text x={x} y={y + 12} textAnchor="middle" fontSize={12} fill={chart.axis}>
      <tspan x={x}>{words.join(" ")}</tspan>
      <tspan x={x} dy={14}>{last}</tspan>
    </text>
  );
}

/** "Where you stand": Previous SGPA -> provisional SGPA -> projected CGPA. */
export function StandingChart({ previous, provisional, projected, thresholds: t }) {
  const data = [
    { name: "Previous SGPA", value: previous },
    { name: "This term SGPA", value: provisional },
    { name: "Projected CGPA", value: projected },
  ].filter((d) => d.value != null);

  const Dot = ({ cx, cy, payload }) => (
    <circle cx={cx} cy={cy} r={6} fill={gpaColor(payload.value, t)} stroke="#fff" strokeWidth={2} />
  );
  // Labels go below points that sit under the threshold lines, above the rest, with a white
  // halo so they stay readable where they cross a line.
  const PointLabel = ({ x, y, value }) => (
    <text x={x} y={value < t.at_risk_cgpa && value > 0.8 ? y + 22 : y - 12} textAnchor="middle" fontSize={13} fontWeight={600} fill={colors.ink} stroke="#fff" strokeWidth={4} paintOrder="stroke">
      {gpa(value)}
    </text>
  );

  return (
    <ResponsiveContainer>
      <LineChart data={data} margin={{ top: 24, right: 48, bottom: 4, left: -8 }}>
        <CartesianGrid {...grid} vertical={false} />
        <XAxis dataKey="name" {...axis} interval={0} padding={{ left: 28, right: 28 }} tick={<TwoLineTick />} height={40} />
        <YAxis domain={[0, 4]} ticks={[0, 1, 2, 3, 4]} {...axis} width={40} />
        <ReferenceLine y={t.probation_cgpa} stroke={colors.danger.DEFAULT} strokeDasharray="4 4" label={refLabel(gpa(t.probation_cgpa), "right", colors.danger[700])} />
        <ReferenceLine y={t.at_risk_cgpa} stroke={colors.risk.DEFAULT} strokeDasharray="4 4" label={refLabel(gpa(t.at_risk_cgpa), "right", colors.risk[700])} />
        <Tooltip
          cursor={false}
          content={({ active, payload }) =>
            active && payload?.length ? <TooltipBox rows={[{ label: payload[0].payload.name, value: gpa(payload[0].value) }]} /> : null
          }
        />
        <Line type="linear" dataKey="value" stroke={chart.neutral} strokeWidth={2} dot={<Dot />} activeDot={false} isAnimationActive={false}>
          <LabelList dataKey="value" content={<PointLabel />} />
        </Line>
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Attendance per course, horizontal bars coloured by the policy thresholds. */
export function AttendanceChart({ courses, thresholds: t }) {
  const data = courses.filter((c) => c.attendance_pct != null);
  return (
    <ResponsiveContainer>
      <BarChart layout="vertical" data={data} margin={{ top: 18, right: 44, bottom: 0, left: 0 }} barCategoryGap="28%">
        <CartesianGrid {...grid} horizontal={false} />
        <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} {...axis} tickFormatter={(v) => `${v}%`} />
        <YAxis type="category" dataKey="course_code" {...axis} width={58} />
        <ReferenceLine x={t.min_attendance_pct} stroke={colors.risk.DEFAULT} strokeDasharray="4 4" label={refLabel(`${t.min_attendance_pct}%`, "top", colors.risk[700])} />
        <ReferenceLine x={t.severe_attendance_pct} stroke={colors.danger.DEFAULT} strokeDasharray="4 4" label={refLabel(`${t.severe_attendance_pct}%`, "top", colors.danger[700])} />
        <Tooltip
          cursor={{ fill: colors.brand[50] }}
          content={({ active, payload }) =>
            active && payload?.length ? (
              <TooltipBox
                title={`${payload[0].payload.course_code} · ${payload[0].payload.title}`}
                rows={[{ label: "Present", value: `${payload[0].payload.present} of ${payload[0].payload.sessions}` }]}
              />
            ) : null
          }
        />
        <Bar dataKey="attendance_pct" radius={[0, 4, 4, 0]} isAnimationActive={false}>
          {data.map((c) => (
            <Cell key={c.course_code} fill={attColor(c.attendance_pct, t)} />
          ))}
          <LabelList dataKey="attendance_pct" position="right" formatter={(v) => `${Math.round(v)}%`} style={{ fontSize: 12, fontWeight: 600, fill: colors.ink, stroke: "#fff", strokeWidth: 3, paintOrder: "stroke" }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export const standingLegend = (t) => [
  { label: `Below ${gpa(t.probation_cgpa)}: probation`, color: colors.danger.DEFAULT },
  { label: `${gpa(t.probation_cgpa)}-${gpa(t.at_risk_cgpa)}: below good standing`, color: colors.risk.DEFAULT },
  { label: `${gpa(t.at_risk_cgpa)}+: good standing`, color: colors.safe.DEFAULT },
];

export const attendanceLegend = (t) => [
  { label: `${t.min_attendance_pct}% or more`, color: colors.safe.DEFAULT },
  { label: `${t.severe_attendance_pct}-${t.min_attendance_pct}%`, color: colors.risk.DEFAULT },
  { label: `Below ${t.severe_attendance_pct}%`, color: colors.danger.DEFAULT },
];

const MARK_SERIES = [
  { key: "assignment_avg", label: "Assignment" },
  { key: "quiz_avg", label: "Quiz" },
  { key: "midterm_marks", label: "Midterm" },
  { key: "final_marks", label: "Final" },
];
export const marksLegend = (passMark) => [
  ...MARK_SERIES.map((s, i) => ({ label: s.label, color: chart.series[i] })),
  { label: `Dashed line: pass mark (${passMark})`, color: colors.danger.DEFAULT },
];

/** Grouped bars per course; the weakest course is emphasised and labelled "Focus here". */
export function MarksChart({ courses, weakestCode, passMark }) {
  const data = courses.filter((c) => c.mean != null);
  const FocusTick = ({ x, y, payload }) => {
    const focus = payload.value === weakestCode;
    return (
      <g transform={`translate(${x},${y})`}>
        <text dy={14} textAnchor="middle" fontSize={12} fill={focus ? colors.ink : chart.axis} fontWeight={focus ? 600 : 400}>
          {payload.value}
        </text>
        {focus && (
          <text dy={30} textAnchor="middle" fontSize={11} fontWeight={600} fill={colors.risk[700]}>
            ▲ Focus here
          </text>
        )}
      </g>
    );
  };
  return (
    <ResponsiveContainer>
      <BarChart data={data} margin={{ top: 12, right: 8, bottom: 18, left: -12 }} barGap={2} barCategoryGap="22%">
        <CartesianGrid {...grid} vertical={false} />
        <XAxis dataKey="course_code" {...axis} tick={<FocusTick />} interval={0} />
        <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} {...axis} width={40} />
        <ReferenceLine y={passMark} stroke={colors.danger.DEFAULT} strokeDasharray="4 4" />
        <Tooltip
          cursor={{ fill: colors.brand[50] }}
          content={({ active, payload }) =>
            active && payload?.length ? (
              <TooltipBox
                title={`${payload[0].payload.course_code} · ${payload[0].payload.title}`}
                rows={MARK_SERIES.map((s, i) => ({ label: s.label, value: Math.round(payload[0].payload[s.key]), color: chart.series[i] }))}
              />
            ) : null
          }
        />
        {MARK_SERIES.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={chart.series[i]} radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.map((c) => (
              <Cell key={c.course_code} fillOpacity={weakestCode && c.course_code !== weakestCode ? 0.45 : 1} />
            ))}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Step chart of the final label over time. */
export function TimelineChart({ points }) {
  const data = points.map((p) => ({ ...p, severity: RISK_SEVERITY[p.final_label] }));
  const Dot = ({ cx, cy, payload }) => <circle cx={cx} cy={cy} r={5} fill={riskColor[payload.final_label]} stroke="#fff" strokeWidth={2} />;
  return (
    <ResponsiveContainer>
      <LineChart data={data} margin={{ top: 12, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid {...grid} vertical={false} />
        <XAxis dataKey="date" {...axis} tickFormatter={shortDate} />
        <YAxis
          type="number"
          domain={[0, 2]}
          ticks={[0, 1, 2]}
          reversed
          {...axis}
          tick={{ ...tick, fontSize: 11 }}
          width={92}
          tickFormatter={(v) => RISK[["Safe", "At-Risk", "Dropout-Likely"][v]].short}
        />
        <Tooltip
          content={({ active, payload }) =>
            active && payload?.length ? (
              <TooltipBox
                title={shortDate(payload[0].payload.date)}
                rows={[
                  { label: "Status", value: payload[0].payload.final_label, color: riskColor[payload[0].payload.final_label] },
                  { label: "Projected CGPA", value: gpa(payload[0].payload.projected_cgpa) },
                ]}
              />
            ) : null
          }
        />
        <Line type="stepAfter" dataKey="severity" stroke={chart.neutral} strokeWidth={2} dot={<Dot />} activeDot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
