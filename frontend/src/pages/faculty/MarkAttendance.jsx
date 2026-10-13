import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import client from "../../api/client";
import { PortalShell, Card } from "../../components/Shell";

const LINKS = [{ href: "/faculty", label: "My Classes" }];
const TODAY = new Date().toISOString().slice(0, 10);

export default function MarkAttendance() {
  const { facultyCourseId } = useParams();
  const [roster, setRoster] = useState([]);
  const [date, setDate] = useState(TODAY);
  const [statuses, setStatuses] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    client.get(`/faculty/classes/${facultyCourseId}/roster`).then((res) => {
      setRoster(res.data);
      const initial = {};
      res.data.forEach((r) => (initial[r.enrollment_id] = "present"));
      setStatuses(initial);
    });
  }, [facultyCourseId]);

  async function submit() {
    setSaving(true);
    try {
      const entries = Object.entries(statuses).map(([enrollmentId, status]) => ({
        enrollmentId: Number(enrollmentId),
        status,
      }));
      await client.post("/faculty/attendance", { facultyCourseId: Number(facultyCourseId), classDate: date, entries });
      alert("Attendance saved");
    } catch (e) {
      alert(e.response?.data?.error || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <PortalShell title="Faculty" links={LINKS}>
      <Link to="/faculty" className="text-sm text-brand hover:underline">&larr; Back to my classes</Link>
      <h1 className="font-display text-2xl mt-2 mb-5">Mark Attendance</h1>

      <Card>
        <div className="mb-4 flex items-center gap-3">
          <label className="text-sm text-ink/60">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border border-black/10 rounded px-2 py-1 text-sm"
          />
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink/50 border-b border-black/10">
              <th className="py-2">Roll No</th>
              <th>Name</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((r) => (
              <tr key={r.enrollment_id} className="border-b border-black/5">
                <td className="py-2">{r.roll_no}</td>
                <td>{r.full_name}</td>
                <td>
                  <select
                    value={statuses[r.enrollment_id] || "present"}
                    onChange={(e) => setStatuses((s) => ({ ...s, [r.enrollment_id]: e.target.value }))}
                    className="border border-black/10 rounded px-2 py-1"
                  >
                    <option value="present">Present</option>
                    <option value="absent">Absent</option>
                    <option value="leave">Leave</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <button
          onClick={submit}
          disabled={saving || roster.length === 0}
          className="mt-5 px-4 py-2 bg-brand text-white rounded hover:bg-brand-dark transition disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save attendance"}
        </button>
      </Card>
    </PortalShell>
  );
}
