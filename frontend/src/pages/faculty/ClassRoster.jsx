import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import client from "../../api/client";
import { PortalShell } from "../../components/Shell";
import {
  Card, ChartCard, DataTable, Drawer, EmptyState, RiskChip, Button, Skeleton, useToast, Icons, RISK_SEVERITY,
} from "../../components/ui";
import useApi from "../../lib/useApi";
import { gpa, pct, num, timeAgo } from "../../lib/format";
import { GradeDistributionChart, SessionAttendanceChart } from "./ClassCharts";
import RiskBar from "./RiskBar";

const MARKS = [
  { key: "assignment_avg", label: "Assign." , full: "Assignment" },
  { key: "quiz_avg", label: "Quiz", full: "Quiz" },
  { key: "midterm_marks", label: "Midterm", full: "Midterm" },
  { key: "final_marks", label: "Final", full: "Final" },
];
const TABS = [
  { key: "all", label: "All" },
  { key: "At-Risk", label: "Needs attention" },
  { key: "Dropout-Likely", label: "High risk" },
];

const validMark = (v) => v === "" || v == null || (!Number.isNaN(Number(v)) && Number(v) >= 0 && Number(v) <= 100);

function MarkInput({ value, onChange, onEnter, label, invalid }) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step="0.01"
      min="0"
      max="100"
      aria-label={label}
      aria-invalid={invalid || undefined}
      value={value ?? ""}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") onEnter();
      }}
      onChange={(e) => onChange(e.target.value)}
      className={`w-[72px] rounded-md border bg-surface px-2 py-1.5 text-right text-sm tabular-nums focus:outline-none focus:ring-2 ${
        invalid ? "border-danger ring-danger/30 focus:ring-danger/40" : "border-line focus:ring-brand/30 focus:border-brand"
      }`}
    />
  );
}

function StudentDrawer({ row, onClose, classId }) {
  if (!row) return <Drawer open={false} onClose={onClose} />;
  return (
    <Drawer
      open
      onClose={onClose}
      title={row.full_name}
      subtitle={<span className="font-mono">{row.roll_no}</span>}
      footer={
        <Link to={`/faculty/class/${classId}/attendance`} className="text-sm font-medium text-brand hover:underline">
          Mark attendance for this class →
        </Link>
      }
    >
      <div className="space-y-5">
        <div className="bg-surface rounded-card border border-line p-4">
          <div className="flex items-center justify-between gap-3">
            <RiskChip label={row.final_label} />
            <span className="text-xs text-muted inline-flex items-center gap-1">
              <Icons.Clock size={12} /> {row.last_predicted_at ? `Predicted ${timeAgo(row.last_predicted_at)}` : "Not predicted yet"}
            </span>
          </div>
          {row.reasons?.length > 0 && (
            <>
              <h3 className="mt-4 text-sm font-semibold">Why</h3>
              <ul className="mt-1.5 space-y-1 text-sm text-ink/90 list-disc pl-5">
                {row.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </>
          )}
          {row.policy_reason && <p className="mt-3 text-xs text-muted">Policy: {row.policy_reason}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-surface rounded-card border border-line p-4">
            <p className="text-xs text-muted">Projected CGPA</p>
            <p className="font-display text-2xl mt-1">{gpa(row.projected_cgpa)}</p>
          </div>
          <div className="bg-surface rounded-card border border-line p-4">
            <p className="text-xs text-muted">Attendance in this class</p>
            <p className="font-display text-2xl mt-1">{pct(row.attendance_pct)}</p>
            <p className="text-xs text-muted">{row.sessions ? `${row.present} of ${row.sessions} sessions` : "No sessions yet"}</p>
          </div>
        </div>

        <div className="bg-surface rounded-card border border-line p-4">
          <h3 className="text-sm font-semibold mb-2">Marks in this class</h3>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            {MARKS.map((m) => (
              <div key={m.key} className="contents">
                <dt className="text-muted">{m.full}</dt>
                <dd className="text-right tabular-nums">{num(row[m.key])}</dd>
              </div>
            ))}
            <dt className="text-muted">Grade</dt>
            <dd className="text-right font-semibold">{row.grade || "—"}</dd>
          </dl>
        </div>
      </div>
    </Drawer>
  );
}

export default function ClassRoster() {
  const { facultyCourseId } = useParams();
  const { toast } = useToast();
  const classes = useApi("/faculty/classes");
  const roster = useApi(`/faculty/classes/${facultyCourseId}/roster`);
  const summary = useApi(`/faculty/classes/${facultyCourseId}/risk-summary`);
  const [edits, setEdits] = useState({}); // enrollment_id -> {field: value}
  const [savingId, setSavingId] = useState(null);
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState(null);
  const [justSaved, setJustSaved] = useState(null); // highlights the row after a save (it may re-sort)

  const cls = classes.data?.find((c) => String(c.faculty_course_id) === String(facultyCourseId));
  const rows = roster.data || [];
  const current = (r) => ({ ...r, ...(edits[r.enrollment_id] || {}) });

  const counts = useMemo(() => {
    const c = { all: rows.length, "At-Risk": 0, "Dropout-Likely": 0 };
    rows.forEach((r) => r.final_label in c && c[r.final_label]++);
    return c;
  }, [rows]);

  const visible = rows
    .filter((r) => tab === "all" || r.final_label === tab)
    .filter((r) => {
      const q = query.trim().toLowerCase();
      return !q || r.full_name.toLowerCase().includes(q) || r.roll_no.toLowerCase().includes(q);
    })
    .map(current);

  function setMark(id, key, value) {
    setEdits((e) => ({ ...e, [id]: { ...(e[id] || {}), [key]: value } }));
  }

  async function save(row) {
    const r = current(row);
    if (!MARKS.every((m) => validMark(r[m.key]))) return;
    setSavingId(row.enrollment_id);
    try {
      const body = Object.fromEntries(MARKS.map((m) => [m.key, r[m.key] === "" || r[m.key] == null ? 0 : Number(r[m.key])]));
      const { data } = await client.put(`/faculty/results/${row.enrollment_id}`, body);
      const p = data.prediction;
      roster.setData((prev) =>
        prev.map((x) =>
          x.enrollment_id === row.enrollment_id
            ? {
                ...x,
                ...Object.fromEntries(MARKS.map((m) => [m.key, data[m.key]])),
                grade: data.grade,
                ...(p ? { final_label: p.new_label, reasons: p.reasons, projected_cgpa: p.projected_cgpa, last_predicted_at: p.created_at } : {}),
              }
            : x
        )
      );
      setEdits(({ [row.enrollment_id]: _, ...rest }) => rest);
      setJustSaved(row.enrollment_id);
      setTimeout(() => setJustSaved((id) => (id === row.enrollment_id ? null : id)), 4000);
      summary.reload({ quiet: true });
      if (p?.changed) {
        toast(`${row.roll_no}: ${p.old_label || "No prediction"} → ${p.new_label}`, { type: RISK_SEVERITY[p.new_label] > RISK_SEVERITY[p.old_label] ? "warning" : "success", title: "Prediction updated" });
      } else {
        toast(`${row.roll_no} saved · grade ${data.grade}${p ? ` · still ${p.new_label}` : ""}`, { type: "success", duration: 3000 });
      }
    } catch (e) {
      toast(e.response?.data?.error || "Could not save marks", { type: "error" });
    } finally {
      setSavingId(null);
    }
  }

  const columns = [
    {
      key: "full_name",
      header: "Student",
      className: "whitespace-nowrap",
      render: (r) => (
        <span>
          <span className="block font-medium">{r.full_name}</span>
          <span className="block font-mono text-xs text-muted">{r.roll_no}</span>
        </span>
      ),
    },
    {
      key: "final_label",
      header: "Risk",
      sortValue: (r) => (r.final_label ? RISK_SEVERITY[r.final_label] : -1),
      render: (r) => <RiskChip label={r.final_label} size="sm" short />,
    },
    { key: "projected_cgpa", header: "Proj. CGPA", align: "right", sortValue: (r) => Number(r.projected_cgpa), render: (r) => gpa(r.projected_cgpa) },
    { key: "attendance_pct", header: "Attend.", align: "right", sortValue: (r) => (r.attendance_pct == null ? null : Number(r.attendance_pct)), render: (r) => pct(r.attendance_pct) },
    ...MARKS.map((m) => ({
      key: m.key,
      header: m.label,
      align: "right",
      sortValue: (r) => (r[m.key] === "" || r[m.key] == null ? null : Number(r[m.key])),
      render: (r) => (
        <MarkInput
          label={`${m.full} for ${r.roll_no}`}
          value={r[m.key]}
          invalid={!validMark(r[m.key])}
          onChange={(v) => setMark(r.enrollment_id, m.key, v)}
          onEnter={() => save(r)}
        />
      ),
    })),
    { key: "grade", header: "Grade", align: "center", render: (r) => <span className="font-semibold">{r.grade || "—"}</span> },
    {
      key: "save",
      header: "",
      sortable: false,
      render: (r) => {
        const dirty = Boolean(edits[r.enrollment_id]);
        const valid = MARKS.every((m) => validMark(r[m.key]));
        return (
          <span onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant={dirty ? "primary" : "secondary"} disabled={!dirty || !valid} loading={savingId === r.enrollment_id} onClick={() => save(r)}>
              Save
            </Button>
          </span>
        );
      },
    },
  ];

  const s = summary.data;
  const openRow = rows.find((r) => r.enrollment_id === openId);

  return (
    <PortalShell>
      <Link to="/faculty" className="inline-flex items-center gap-1 text-sm text-brand hover:underline">
        ← My classes
      </Link>
      <div className="mt-2 mb-5 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          {cls ? (
            <>
              <p className="font-mono text-xs text-muted">
                {cls.course_code} · Section {cls.section} · {cls.academic_year}
              </p>
              <h1 className="font-display text-2xl sm:text-[28px] leading-tight">{cls.title}</h1>
            </>
          ) : (
            <Skeleton className="h-9 w-64" />
          )}
        </div>
        <Link
          to={`/faculty/class/${facultyCourseId}/attendance`}
          className="self-start sm:self-auto inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium hover:bg-ink/5"
        >
          <Icons.Calendar size={15} /> Mark attendance
        </Link>
      </div>

      {roster.error ? (
        <Card>
          <EmptyState icon={<Icons.AlertOctagon size={22} />} message="We couldn't load this class" detail={roster.error} />
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Risk in this class" subtitle="Latest prediction per student">
              {s ? <RiskBar counts={s.counts} /> : <Skeleton className="h-10" />}
              {s && s.counts.at_risk + s.counts.dropout_likely > 0 && (
                <button type="button" onClick={() => setTab("Dropout-Likely")} className="mt-4 text-sm font-medium text-brand hover:underline">
                  Show high-risk students →
                </button>
              )}
            </Card>
            <ChartCard title="Grade distribution" loading={summary.loading && !s} empty={s && s.gradeDistribution.every((g) => !g.count)} emptyMessage="No grades yet" height={170}>
              {s && <GradeDistributionChart data={s.gradeDistribution} />}
            </ChartCard>
            <ChartCard title="Attendance by session" subtitle="Dashed line: 75% target" loading={summary.loading && !s} empty={s && s.attendanceBySession.length === 0} emptyMessage="No sessions marked yet" height={170}>
              {s && <SessionAttendanceChart data={s.attendanceBySession} />}
            </ChartCard>
          </div>

          <Card>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
              <div role="tablist" aria-label="Filter students" className="inline-flex rounded-lg bg-ink/[0.05] p-1 self-start overflow-x-auto max-w-full">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    role="tab"
                    aria-selected={tab === t.key}
                    onClick={() => setTab(t.key)}
                    className={`whitespace-nowrap rounded-md px-2.5 sm:px-3 py-1.5 text-sm transition ${tab === t.key ? "bg-surface shadow-card font-medium text-ink" : "text-muted hover:text-ink"}`}
                  >
                    {t.label} <span className="tabular-nums text-muted">({counts[t.key] ?? 0})</span>
                  </button>
                ))}
              </div>
              <label className="relative md:w-64">
                <span className="sr-only">Search students</span>
                <Icons.Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name or roll no"
                  className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
                />
              </label>
            </div>
            <p className="text-xs text-muted mb-2">Edit marks in the row and press Save (or Enter). Click a student for details.</p>
            <DataTable
              loading={roster.loading}
              rows={visible}
              rowKey={(r) => r.enrollment_id}
              columns={columns}
              initialSort={{ key: "final_label", dir: "desc" }}
              onRowClick={(r) => setOpenId(r.enrollment_id)}
              rowClassName={(r) => (r.enrollment_id === justSaved ? "bg-brand-50" : "")}
              minWidth={940}
              emptyMessage={rows.length ? "No students match this filter" : "No students enrolled in this class"}
            />
          </Card>
        </div>
      )}

      <StudentDrawer row={openRow} onClose={() => setOpenId(null)} classId={facultyCourseId} />
    </PortalShell>
  );
}
