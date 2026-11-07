import { Link } from "react-router-dom";
import { Card } from "../../components/ui";
import { timeAgo } from "../../lib/format";

// Synthetic vs live data (GET /admin/dashboard -> dataSources). Live = entered in the app,
// uploaded by faculty, or imported as a live cohort.

const ROWS = [
  { key: "students", label: "Students" },
  { key: "course_results", label: "Course marks" },
  { key: "attendance", label: "Attendance records" },
  { key: "performance", label: "Academic records" },
];

export default function DataSourcesCard({ sources }) {
  if (!sources) return null;
  return (
    <Card
      title="Data sources"
      subtitle="Synthetic (the 50,000-student dataset) vs live (entered, uploaded or imported)"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-xs text-muted">
              <th scope="col" className="text-left font-medium pb-1.5">Data</th>
              <th scope="col" className="text-right font-medium pb-1.5 px-2">Synthetic</th>
              <th scope="col" className="text-right font-medium pb-1.5 px-2">Live</th>
              <th scope="col" className="text-right font-medium pb-1.5 pl-2 whitespace-nowrap">From uploads</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => {
              const v = sources[r.key] || {};
              return (
                <tr key={r.key} className="border-t border-line">
                  <th scope="row" className="text-left font-normal py-1.5">{r.label}</th>
                  <td className="text-right px-2 text-muted">{(v.synthetic ?? 0).toLocaleString()}</td>
                  <td className={`text-right px-2 ${v.live ? "font-semibold text-brand-dark" : "text-muted"}`}>{(v.live ?? 0).toLocaleString()}</td>
                  <td className="text-right pl-2 text-muted">{v.from_uploads == null ? "—" : v.from_uploads.toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-ink/90">
        <strong className="tabular-nums">{sources.students_with_live_data.toLocaleString()}</strong> student{sources.students_with_live_data === 1 ? " has" : "s have"} live data ·{" "}
        <strong className="tabular-nums">{sources.uploads.committed}</strong> upload{sources.uploads.committed === 1 ? "" : "s"} saved
        {sources.uploads.cohorts ? ` (${sources.uploads.cohorts} cohort import${sources.uploads.cohorts === 1 ? "" : "s"})` : ""}
        {sources.uploads.last_committed_at ? `, last ${timeAgo(sources.uploads.last_committed_at)}` : ""}.{" "}
        <Link to="/admin/interventions" className="font-medium text-brand hover:underline whitespace-nowrap">
          Filter flagged students by source →
        </Link>{" "}
        <Link to="/admin/live-cohort" className="font-medium text-brand hover:underline whitespace-nowrap">
          Import a live cohort →
        </Link>
      </p>
    </Card>
  );
}
