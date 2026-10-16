import { PortalShell } from "../../components/Shell";
import { Card, EmptyState, SkeletonCard, Button, Icons } from "../../components/ui";
import useApi from "../../lib/useApi";

// Same thresholds as config/policy.json (min 75%, severe below 60%)
const MIN = 75;
const SEVERE = 60;

function status(pct) {
  if (pct >= MIN) return { text: "On track", bar: "bg-safe", cls: "text-safe-700", Icon: Icons.CheckCircle };
  if (pct >= SEVERE) return { text: `Below ${MIN}%`, bar: "bg-risk", cls: "text-risk-700", Icon: Icons.Warning };
  return { text: `Below ${SEVERE}%`, bar: "bg-danger", cls: "text-danger-700", Icon: Icons.AlertOctagon };
}

export default function StudentAttendance() {
  const { data, error, loading, reload } = useApi("/student/attendance");
  const rows = data || [];

  return (
    <PortalShell>
      <h1 className="font-display text-2xl sm:text-[28px] mb-1">My attendance</h1>
      <p className="text-sm text-muted mb-5">Aim for {MIN}% or more in every course.</p>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <SkeletonCard height="h-16" />
          <SkeletonCard height="h-16" />
        </div>
      ) : error ? (
        <Card>
          <EmptyState icon={<Icons.AlertOctagon size={22} />} message="We couldn't load your attendance" detail={error} action={<Button variant="secondary" onClick={() => reload()}>Try again</Button>} />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={<Icons.Calendar size={22} />} message="No attendance marked yet" detail="Your classes will appear here once your teachers mark attendance." />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map((r) => {
            const value = Number(r.attendance_pct || 0);
            const s = status(value);
            return (
              <Card key={r.course_code} title={r.course_code} subtitle={r.title}>
                <div className="flex items-end justify-between gap-3">
                  <p className="font-display text-[32px] leading-none tabular-nums">{Math.round(value)}%</p>
                  <p className="text-sm text-muted">
                    {r.present_count} of {r.total_classes} classes
                  </p>
                </div>
                <div className="relative w-full bg-ink/[0.06] rounded-full h-2.5 mt-3" role="img" aria-label={`${Math.round(value)}% attendance`}>
                  <div className={`h-2.5 rounded-full ${s.bar}`} style={{ width: `${Math.min(value, 100)}%` }} />
                  <span className="absolute top-[-3px] h-4 w-px bg-ink/40" style={{ left: `${MIN}%` }} aria-hidden="true" />
                </div>
                <p className={`mt-2 inline-flex items-center gap-1 text-xs font-medium ${s.cls}`}>
                  <s.Icon size={13} /> {s.text}
                </p>
              </Card>
            );
          })}
        </div>
      )}
    </PortalShell>
  );
}
