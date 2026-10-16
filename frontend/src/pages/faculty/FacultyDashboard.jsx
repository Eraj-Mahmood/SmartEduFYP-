import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import client from "../../api/client";
import { PortalShell } from "../../components/Shell";
import { Card, StatCard, EmptyState, Skeleton, Button, Icons } from "../../components/ui";
import useApi from "../../lib/useApi";
import RiskBar from "./RiskBar";

/** Unique students across all classes (a student can be in several of this teacher's classes). */
function useUniqueStudents(classes) {
  const [summary, setSummary] = useState(null);
  useEffect(() => {
    if (!classes) return;
    const withStudents = classes.filter((c) => c.enrolled_count > 0);
    Promise.all(withStudents.map((c) => client.get(`/faculty/classes/${c.faculty_course_id}/roster`).then((r) => r.data)))
      .then((rosters) => {
        const byStudent = new Map();
        rosters.flat().forEach((r) => r.status === "enrolled" && byStudent.set(r.student_id, r.final_label));
        const labels = [...byStudent.values()];
        setSummary({
          total: labels.length,
          atRisk: labels.filter((l) => l === "At-Risk").length,
          dropout: labels.filter((l) => l === "Dropout-Likely").length,
        });
      })
      .catch(() => setSummary({ error: true }));
  }, [classes]);
  return summary;
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
  const summary = useUniqueStudents(classes);

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
