import { useEffect, useState } from "react";
import client from "../../api/client";
import { PortalShell, Card, RiskBadge } from "../../components/Shell";

const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/assignments", label: "Assignments" },
  { href: "/admin/interventions", label: "Interventions" },
];

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [predictions, setPredictions] = useState([]);

  useEffect(() => {
    client.get("/admin/dashboard").then((res) => setStats(res.data));
    client.get("/admin/predictions").then((res) => setPredictions(res.data));
  }, []);

  if (!stats) return <PortalShell title="Admin" links={LINKS}><p>Loading...</p></PortalShell>;

  // de-duplicate the flat (one row per enrollment) response down to one row per student
  const seen = new Set();
  const studentRows = [];
  for (const row of predictions) {
    if (seen.has(row.student_id)) continue;
    seen.add(row.student_id);
    studentRows.push(row);
  }

  return (
    <PortalShell title="Admin" links={LINKS}>
      <h1 className="font-display text-2xl mb-5">Institution Overview</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
        <Card title="Students"><p className="text-4xl font-display">{stats.totalStudents}</p></Card>
        <Card title="Faculty"><p className="text-4xl font-display">{stats.totalFaculty}</p></Card>
        <Card title="Courses"><p className="text-4xl font-display">{stats.totalCourses}</p></Card>
      </div>

      <Card title="Risk Breakdown (latest predictions)" className="mb-6">
        <div className="flex gap-4 flex-wrap">
          {stats.riskBreakdown.map((r) => (
            <div key={r.predicted_label} className="flex items-center gap-2">
              <RiskBadge label={r.predicted_label} />
              <span className="text-sm text-ink/60">{r.count} students</span>
            </div>
          ))}
          {stats.riskBreakdown.length === 0 && <p className="text-ink/40 text-sm">No predictions generated yet.</p>}
        </div>
      </Card>

      <Card title="Students with Predictions">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink/50 border-b border-black/10">
              <th className="py-2">Roll No</th>
              <th>Name</th>
              <th>Risk</th>
            </tr>
          </thead>
          <tbody>
            {studentRows.map((s) => (
              <tr key={s.student_id} className="border-b border-black/5">
                <td className="py-2">{s.roll_no}</td>
                <td>{s.full_name}</td>
                <td><RiskBadge label={s.predicted_label} /></td>
              </tr>
            ))}
            {studentRows.length === 0 && (
              <tr><td colSpan={3} className="py-6 text-center text-ink/40">No predictions generated yet. Log in as a student and click "Predict my outcome."</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </PortalShell>
  );
}
