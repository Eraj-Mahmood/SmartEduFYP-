import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import client from "../../api/client";
import { PortalShell } from "../../components/Shell";
import { Card, EmptyState, Button, Skeleton, RiskChip, useToast, Icons } from "../../components/ui";
import useApi from "../../lib/useApi";
import { shortDate } from "../../lib/format";

const STATUSES = [
  { key: "present", label: "Present", on: "bg-safe-50 text-safe-700 ring-safe-500/40" },
  { key: "absent", label: "Absent", on: "bg-danger-50 text-danger-700 ring-danger-500/40" },
  { key: "leave", label: "Leave", on: "bg-risk-50 text-risk-700 ring-risk-500/40" },
];

// Local calendar date (toISOString would give the UTC date, a day early in the morning here)
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function MarkAttendance() {
  const { facultyCourseId } = useParams();
  const { toast } = useToast();
  const classes = useApi("/faculty/classes");
  const roster = useApi(`/faculty/classes/${facultyCourseId}/roster`);
  const [date, setDate] = useState(localToday());
  const existing = useApi(`/faculty/classes/${facultyCourseId}/attendance`, { params: { date } });
  const [statuses, setStatuses] = useState({});
  const [saving, setSaving] = useState(false);

  const cls = classes.data?.find((c) => String(c.faculty_course_id) === String(facultyCourseId));
  const students = (roster.data || []).filter((r) => r.status === "enrolled");
  const alreadyMarked = (existing.data || []).length > 0;

  // Start from what is already saved for this date; default everyone else to present.
  useEffect(() => {
    if (!roster.data || !existing.data) return;
    const saved = Object.fromEntries(existing.data.map((a) => [a.enrollment_id, a.status]));
    setStatuses(Object.fromEntries(students.map((s) => [s.enrollment_id, saved[s.enrollment_id] || "present"])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster.data, existing.data]);

  const tally = useMemo(() => {
    const t = { present: 0, absent: 0, leave: 0 };
    Object.values(statuses).forEach((s) => t[s]++);
    return t;
  }, [statuses]);

  const markAll = (status) => setStatuses(Object.fromEntries(students.map((s) => [s.enrollment_id, status])));

  async function submit() {
    setSaving(true);
    try {
      const entries = Object.entries(statuses).map(([enrollmentId, status]) => ({ enrollmentId: Number(enrollmentId), status }));
      await client.post("/faculty/attendance", { facultyCourseId: Number(facultyCourseId), classDate: date, entries });
      toast(`${tally.present} present · ${tally.absent} absent · ${tally.leave} on leave`, { type: "success", title: `Attendance saved for ${shortDate(date)}` });
      existing.reload({ quiet: true });
    } catch (e) {
      toast(e.response?.data?.error || "Could not save attendance", { type: "error" });
    } finally {
      setSaving(false);
    }
  }

  const loading = roster.loading || (existing.loading && !existing.data);

  return (
    <PortalShell>
      <Link to={`/faculty/class/${facultyCourseId}/roster`} className="inline-flex items-center gap-1 text-sm text-brand hover:underline">
        ← Back to class
      </Link>
      <div className="mt-2 mb-5">
        {cls ? (
          <p className="font-mono text-xs text-muted">
            {cls.course_code} · Section {cls.section} · {cls.title}
          </p>
        ) : (
          <Skeleton className="h-4 w-48" />
        )}
        <h1 className="font-display text-2xl sm:text-[28px] leading-tight">Mark attendance</h1>
      </div>

      <Card>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 pb-4 border-b border-line">
          <label className="block">
            <span className="block text-sm text-muted mb-1">Class date</span>
            <input
              type="date"
              value={date}
              max={localToday()}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" icon={<Icons.CheckCircle size={15} />} onClick={() => markAll("present")} disabled={!students.length}>
              Mark all present
            </Button>
          </div>
        </div>

        {alreadyMarked && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-brand">
            <Icons.Info size={13} /> Attendance for {shortDate(date)} was already saved - saving again updates it.
          </p>
        )}

        {loading ? (
          <div className="space-y-3 py-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : students.length === 0 ? (
          <EmptyState icon={<Icons.Users size={22} />} message="No students enrolled in this class" />
        ) : (
          <ul className="divide-y divide-line">
            {students.map((s) => (
              <li key={s.enrollment_id} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{s.full_name}</p>
                  <p className="text-xs text-muted flex items-center gap-2">
                    <span className="font-mono">{s.roll_no}</span>
                    {s.final_label && s.final_label !== "Safe" && <RiskChip label={s.final_label} size="sm" short />}
                  </p>
                </div>
                <div role="radiogroup" aria-label={`Attendance for ${s.full_name}`} className="inline-flex gap-1.5">
                  {STATUSES.map((st) => {
                    const on = statuses[s.enrollment_id] === st.key;
                    return (
                      <button
                        key={st.key}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setStatuses((x) => ({ ...x, [s.enrollment_id]: st.key }))}
                        className={`rounded-lg px-3 py-1.5 text-sm ring-1 ring-inset transition ${on ? `${st.on} font-medium` : "ring-line text-muted hover:bg-ink/5"}`}
                      >
                        {st.label}
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 pt-4 border-t border-line flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-sm text-muted" aria-live="polite">
            <span className="font-semibold text-safe-700">{tally.present}</span> present ·{" "}
            <span className="font-semibold text-danger-700">{tally.absent}</span> absent ·{" "}
            <span className="font-semibold text-risk-700">{tally.leave}</span> on leave
          </p>
          <Button onClick={submit} loading={saving} disabled={!students.length}>
            Save attendance
          </Button>
        </div>
      </Card>
    </PortalShell>
  );
}
