import { useEffect, useState } from "react";
import client from "../../api/client";
import { PortalShell, Card } from "../../components/Shell";

const LINKS = [
  { href: "/student", label: "Overview" },
  { href: "/student/results", label: "Results" },
  { href: "/student/attendance", label: "Attendance" },
];

export default function StudentResults() {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    client.get("/student/results").then((res) => setRows(res.data));
  }, []);

  return (
    <PortalShell title="Student" links={LINKS}>
      <h1 className="font-display text-2xl mb-5">My Results</h1>
      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink/50 border-b border-black/10">
              <th className="py-2">Course</th>
              <th>Semester</th>
              <th>Assignment</th>
              <th>Quiz</th>
              <th>Midterm</th>
              <th>Final</th>
              <th>Grade</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-black/5">
                <td className="py-2">{r.course_code} — {r.title}</td>
                <td>{r.semester}</td>
                <td>{r.assignment_avg ?? "—"}</td>
                <td>{r.quiz_avg ?? "—"}</td>
                <td>{r.midterm_marks ?? "—"}</td>
                <td>{r.final_marks ?? "—"}</td>
                <td>{r.grade ?? "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="py-6 text-center text-ink/40">No results recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </PortalShell>
  );
}
