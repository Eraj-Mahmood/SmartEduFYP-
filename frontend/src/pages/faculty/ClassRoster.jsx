import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import client from "../../api/client";
import { PortalShell, Card } from "../../components/Shell";

const LINKS = [{ href: "/faculty", label: "My Classes" }];

export default function ClassRoster() {
  const { facultyCourseId } = useParams();
  const [roster, setRoster] = useState([]);
  const [savingId, setSavingId] = useState(null);

  function load() {
    client.get(`/faculty/classes/${facultyCourseId}/roster`).then((res) => setRoster(res.data));
  }

  useEffect(load, [facultyCourseId]);

  function updateField(enrollmentId, field, value) {
    setRoster((prev) =>
      prev.map((r) => (r.enrollment_id === enrollmentId ? { ...r, [field]: value } : r))
    );
  }

  async function saveRow(row) {
    setSavingId(row.enrollment_id);
    try {
      await client.put(`/faculty/results/${row.enrollment_id}`, {
        assignment_avg: row.assignment_avg || 0,
        quiz_avg: row.quiz_avg || 0,
        midterm_marks: row.midterm_marks || 0,
        final_marks: row.final_marks || 0,
        grade: row.grade || null,
      });
    } catch (e) {
      alert(e.response?.data?.error || "Save failed");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <PortalShell title="Faculty" links={LINKS}>
      <Link to="/faculty" className="text-sm text-brand hover:underline">&larr; Back to my classes</Link>
      <h1 className="font-display text-2xl mt-2 mb-5">Enter Results</h1>

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink/50 border-b border-black/10">
              <th className="py-2">Roll No</th>
              <th>Name</th>
              <th className="w-20">Assign.</th>
              <th className="w-20">Quiz</th>
              <th className="w-20">Midterm</th>
              <th className="w-20">Final</th>
              <th className="w-16">Grade</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {roster.map((r) => (
              <tr key={r.enrollment_id} className="border-b border-black/5">
                <td className="py-2">{r.roll_no}</td>
                <td>{r.full_name}</td>
                {["assignment_avg", "quiz_avg", "midterm_marks", "final_marks"].map((field) => (
                  <td key={field}>
                    <input
                      type="number"
                      step="0.1"
                      value={r[field] ?? ""}
                      onChange={(e) => updateField(r.enrollment_id, field, e.target.value)}
                      className="w-16 border border-black/10 rounded px-1.5 py-1"
                    />
                  </td>
                ))}
                <td>
                  <input
                    value={r.grade ?? ""}
                    onChange={(e) => updateField(r.enrollment_id, "grade", e.target.value)}
                    className="w-12 border border-black/10 rounded px-1.5 py-1"
                  />
                </td>
                <td>
                  <button
                    onClick={() => saveRow(r)}
                    disabled={savingId === r.enrollment_id}
                    className="text-xs px-2 py-1 bg-brand text-white rounded hover:bg-brand-dark transition disabled:opacity-60"
                  >
                    {savingId === r.enrollment_id ? "Saving..." : "Save"}
                  </button>
                </td>
              </tr>
            ))}
            {roster.length === 0 && (
              <tr><td colSpan={8} className="py-6 text-center text-ink/40">No students enrolled in this class.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </PortalShell>
  );
}
