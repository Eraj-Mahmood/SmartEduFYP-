import { useEffect, useState } from "react";
import { Drawer, RiskChip, EmptyState, Icons, SkeletonText, PredictionSource, Tabs, Button, StandingChip } from "../../components/ui";
import WhatIfPanel from "../../components/WhatIfPanel";
import useApi from "../../lib/useApi";
import { gpa, num, timeAgo, pkDateTime } from "../../lib/format";

/** Academic standing (BU rules): current status, history, warning letters and Probation 2 approvals. */
function StandingSection({ studentId }) {
  const { data: st, error } = useApi(studentId ? `/admin/students/${studentId}/standing` : null);
  if (error || !st) return null;
  return (
    <section>
      <h3 className="text-sm font-semibold text-ink mb-2">Academic standing (BU rules)</h3>
      <div className="rounded-card border border-line bg-surface p-3 space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <StandingChip status={st.status} />
          {st.cgpa_used != null && <span className="text-muted">CGPA {Number(st.cgpa_used).toFixed(2)} · minimum {Number(st.minimum).toFixed(2)}</span>}
        </div>
        {st.hold.active && (
          <p className="text-danger-700 inline-flex items-center gap-1">
            <Icons.Lock size={13} /> Enrolment hold - needs the Principal's approval (5.5.5)
          </p>
        )}
        {st.history.length > 0 && (
          <ul className="text-xs text-muted space-y-0.5">
            {st.history.map((h) => (
              <li key={h.id}>
                {h.label}
                {h.cgpa_used != null ? ` · ${h.cgpa_used.toFixed(2)}` : ""}
                {h.term_label ? ` · ${h.term_label}` : h.source === "seed" ? " · starting status" : ""} · {pkDateTime(h.created_at)}
              </li>
            ))}
          </ul>
        )}
        {st.letters.map((l) => (
          <p key={l.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {l.title} · {l.date} ·{" "}
              <span className={l.acknowledged_at ? "text-safe-700" : "text-risk-700"}>{l.acknowledged_at ? "acknowledged" : "not acknowledged"}</span>
            </span>
            <a href={`/admin/warning-letters/${l.id}/print`} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline text-xs">
              Print
            </a>
          </p>
        ))}
        {st.approvals?.map((a) => (
          <p key={a.id} className="text-xs text-safe-700">
            Enrolment approved by {a.approver_role} on {pkDateTime(a.approved_at)}
            {a.note ? ` - ${a.note}` : ""}
          </p>
        ))}
      </div>
    </section>
  );
}

// Admin view of one student (GET /admin/students/:id/full): the latest prediction with staff
// reasons, the staff-worded next steps, the counselor and this term's courses.

function NextSteps({ steps }) {
  if (!steps?.length) return <p className="text-sm text-muted">No steps - not enough of this term's data yet.</p>;
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => (
        <li key={s.id} className="flex gap-2 text-sm leading-snug text-ink/90">
          <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-ink/[0.07] text-[11px] font-semibold flex items-center justify-center" aria-hidden="true">
            {i + 1}
          </span>
          {s.text}
        </li>
      ))}
    </ol>
  );
}

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "whatif", label: "What if?" },
];

/** onSchedule(prefill): optional - shows "Schedule counselling" (pre-fill shape: Interventions' sessionPrefill). */
export default function AdminStudentDrawer({ studentId, onClose, onSchedule }) {
  const { data, error, loading } = useApi(studentId ? `/admin/students/${studentId}/full` : null);
  const [tab, setTab] = useState("overview");
  useEffect(() => setTab("overview"), [studentId]);
  const ready = data && data.profile?.student_id === studentId;
  const p = ready ? data.predictions[0] : null;

  return (
    <Drawer
      open={Boolean(studentId)}
      onClose={onClose}
      width="sm:max-w-lg"
      title={ready ? data.profile.full_name : "Student"}
      subtitle={ready ? <span className="font-mono">{data.profile.roll_no} · {data.profile.department}</span> : null}
    >
      {error ? (
        <EmptyState icon={<Icons.AlertOctagon size={22} />} message="We couldn't load this student" detail={error} />
      ) : !ready || loading ? (
        <SkeletonText lines={8} />
      ) : (
        <>
        <Tabs tabs={TABS} value={tab} onChange={setTab} label="Student details" className="mb-5" />
        {tab === "whatif" ? (
          <WhatIfPanel endpoint={`/admin/students/${studentId}/what-if`} />
        ) : (
        <div className="space-y-5">
          <section className="bg-surface rounded-card border border-line p-4">
            {p ? (
              <>
                <p className="text-xs font-mono uppercase tracking-wider text-muted mb-1.5">Risk prediction (Random Forest)</p>
                <div className="flex items-center justify-between gap-3">
                  <RiskChip label={p.final_label} />
                  <span className="text-xs text-muted inline-flex items-center gap-1">
                    <Icons.Clock size={12} /> Predicted {timeAgo(p.created_at)}
                  </span>
                </div>
                <PredictionSource className="mt-2" source={p.source} modelLabel={p.model_label} finalLabel={p.final_label} staff />
                {p.reasons?.length > 0 && (
                  <ul className="mt-3 space-y-1 text-sm text-ink/90 list-disc pl-5">
                    {p.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                )}
                <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
                  <dt className="text-muted">Projected CGPA</dt>
                  <dd className="text-right tabular-nums">{gpa(p.features?.CGPA)}</dd>
                  <dt className="text-muted">Attendance</dt>
                  <dd className="text-right tabular-nums">{num(p.features?.Attendance_Percentage)}%</dd>
                </dl>
              </>
            ) : (
              <p className="text-sm text-muted">Not predicted yet.</p>
            )}
          </section>

          <StandingSection studentId={studentId} />

          <section>
            <h3 className="text-sm font-semibold text-ink mb-2">Next steps</h3>
            <NextSteps steps={data.nextSteps} />
          </section>

          <section>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
              <h3 className="text-sm font-semibold text-ink">Counselor</h3>
              {onSchedule && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Icons.Calendar size={13} />}
                  onClick={() =>
                    onSchedule({
                      student: {
                        student_id: data.profile.student_id,
                        roll_no: data.profile.roll_no,
                        full_name: data.profile.full_name,
                        final_label: p?.final_label || null,
                        counselor: data.counselor ? { faculty_id: data.counselor.faculty_id, name: data.counselor.name } : null,
                      },
                      reason: p && p.final_label !== "Safe" ? "risk" : "manual",
                      agenda: p?.reasons?.[0] ? `Discuss: ${p.reasons[0]}` : "",
                    })
                  }
                >
                  Schedule counselling
                </Button>
              )}
            </div>
            <p className="text-sm text-ink/90">
              {data.counselor ? `${data.counselor.name} (assigned ${timeAgo(data.counselor.assigned_at)})` : "No counselor assigned."}
            </p>
          </section>

          {data.courseResults?.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-ink mb-2">This term's courses</h3>
              <ul className="divide-y divide-line rounded-card border border-line bg-surface text-sm">
                {data.courseResults.map((c) => (
                  <li key={c.course_code} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 truncate">
                      <span className="font-mono text-xs mr-1.5">{c.course_code}</span>
                      {c.title}
                    </span>
                    <span className="shrink-0 font-semibold">{c.grade || "—"}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        )}
        </>
      )}
    </Drawer>
  );
}
