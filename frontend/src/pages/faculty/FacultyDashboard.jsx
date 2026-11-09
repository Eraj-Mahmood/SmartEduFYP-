import { Link } from "react-router-dom";
import { PortalShell } from "../../components/Shell";
import { Card, StatCard, EmptyState, Skeleton, Button, Icons } from "../../components/ui";
import useApi from "../../lib/useApi";
import RiskBar from "./RiskBar";
import { pkDate, pkTime } from "../../lib/format";

/** "Counselling today / awaiting attendance" (Phase 7). Hidden when there is nothing to show. */
function CounsellingCard() {
  const { data } = useApi("/faculty/counselling-sessions", { params: { view: "upcoming" } });
  const sessions = data?.sessions || [];
  const today = pkDate(new Date());
  const todays = sessions.filter((s) => s.display_status === "upcoming" && pkDate(s.scheduled_at) === today);
  const awaiting = sessions.filter((s) => s.display_status === "awaiting_attendance").length;
  if (!todays.length && !awaiting) return null;
  return (
    <Card className="mb-6" title="Counselling" subtitle="Today's sessions and attendance still to mark">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-mono uppercase tracking-wider text-muted mb-1.5">Today</p>
          {todays.length ? (
            <ul className="space-y-1.5">
              {todays.map((s) => (
                <li key={s.session_id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="font-medium tabular-nums">{pkTime(s.scheduled_at)}</span>
                  <span className="text-ink">{s.student_name}</span>
                  <span className="text-xs text-muted">{s.mode === "online" ? "Online" : s.location}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No sessions today.</p>
          )}
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          {awaiting > 0 && (
            <p className="inline-flex items-center gap-1.5 text-sm font-medium text-risk-700">
              <Icons.Warning size={15} /> {awaiting} awaiting attendance
            </p>
          )}
          <Link to="/faculty/counselling" className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
            Open counselling <Icons.ChevronRight size={15} />
          </Link>
        </div>
      </div>
    </Card>
  );
}

/** Unique students across all my classes (a student in two of them counts once): one request. */
function useUniqueStudents() {
  const { data, error } = useApi("/faculty/summary");
  if (error) return { error: true };
  return data && { total: data.total, atRisk: data.at_risk, dropout: data.dropout_likely };
}

function ClassCard({ c }) {
  const flagged = c.at_risk + c.dropout_likely;
  return (
    <Card className="flex flex-col" bodyClassName="flex flex-col flex-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-muted">
            {c.course_code} · Section {c.section}
          </p>
          <h2 className="font-display text-lg leading-snug text-ink">{c.title}</h2>
          <p className="text-sm text-muted mt-0.5">
            Semester {c.semester} · {c.academic_year} · {c.enrolled_count} student{c.enrolled_count === 1 ? "" : "s"}
          </p>
        </div>
        {flagged > 0 && (
          <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-risk-50 px-2 py-0.5 text-xs font-medium text-risk-700 ring-1 ring-inset ring-risk-500/30">
            <Icons.Warning size={12} /> {flagged} flagged
          </span>
        )}
      </div>

      <div className="mt-4 flex-1">
        {c.enrolled_count > 0 ? <RiskBar counts={c} /> : <p className="text-sm text-muted">No students enrolled yet.</p>}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Link
          to={`/faculty/class/${c.faculty_course_id}/roster`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
        >
          View class <Icons.ChevronRight size={15} />
        </Link>
        <Link
          to={`/faculty/class/${c.faculty_course_id}/attendance`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-ink/5"
        >
          <Icons.Calendar size={15} /> Mark attendance
        </Link>
      </div>
    </Card>
  );
}

export default function FacultyDashboard() {
  const { data: classes, error, loading, reload } = useApi("/faculty/classes");
  const summary = useUniqueStudents();

  return (
    <PortalShell>
      <h1 className="font-display text-2xl sm:text-[28px] mb-1">My classes</h1>
      <p className="text-muted text-sm mb-5">Who needs attention across the classes you teach, from each student's latest prediction.</p>

      <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-6">
        {summary && !summary.error ? (
          <>
            <StatCard label="Students" value={summary.total} sublabel="across your classes" icon={<Icons.Users size={14} />} />
            <StatCard label="Needs attention" value={summary.atRisk} tone="risk" sublabel="At-Risk" />
            <StatCard label="High risk" value={summary.dropout} tone="danger" sublabel="Dropout-Likely" />
          </>
        ) : (
          [0, 1, 2].map((i) => <Skeleton key={i} className="h-[104px]" rounded="rounded-card" />)
        )}
      </div>

      <CounsellingCard />

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-56" rounded="rounded-card" />
          <Skeleton className="h-56" rounded="rounded-card" />
        </div>
      ) : error ? (
        <Card>
          <EmptyState icon={<Icons.AlertOctagon size={22} />} message="We couldn't load your classes" detail={error} action={<Button variant="secondary" onClick={() => reload()}>Try again</Button>} />
        </Card>
      ) : classes.length === 0 ? (
        <Card>
          <EmptyState icon={<Icons.Book size={22} />} message="No classes assigned yet" detail="Ask an administrator to assign you to a course section." />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {[...classes]
            .sort((a, b) => b.enrolled_count - a.enrolled_count)
            .map((c) => (
              <ClassCard key={c.faculty_course_id} c={c} />
            ))}
        </div>
      )}
    </PortalShell>
  );
}
