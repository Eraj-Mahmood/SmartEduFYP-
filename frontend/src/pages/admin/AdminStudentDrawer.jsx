import { Drawer, RiskChip, EmptyState, Icons, SkeletonText } from "../../components/ui";
import useApi from "../../lib/useApi";
import { gpa, num, timeAgo } from "../../lib/format";

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

export default function AdminStudentDrawer({ studentId, onClose }) {
  const { data, error, loading } = useApi(studentId ? `/admin/students/${studentId}/full` : null);
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
        <div className="space-y-5">
          <section className="bg-surface rounded-card border border-line p-4">
            {p ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <RiskChip label={p.final_label} />
                  <span className="text-xs text-muted inline-flex items-center gap-1">
                    <Icons.Clock size={12} /> Predicted {timeAgo(p.created_at)}
                  </span>
                </div>
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

          <section>
            <h3 className="text-sm font-semibold text-ink mb-2">Next steps</h3>
            <NextSteps steps={data.nextSteps} />
          </section>

          <section>
            <h3 className="text-sm font-semibold text-ink mb-1">Counselor</h3>
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
    </Drawer>
  );
}
