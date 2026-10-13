import { useEffect, useState } from "react";
import client from "../../api/client";
import { PortalShell, Card } from "../../components/Shell";

const LINKS = [
  { href: "/student", label: "Overview" },
  { href: "/student/results", label: "Results" },
  { href: "/student/attendance", label: "Attendance" },
];

export default function StudentAttendance() {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    client.get("/student/attendance").then((res) => setRows(res.data));
  }, []);

  return (
    <PortalShell title="Student" links={LINKS}>
      <h1 className="font-display text-2xl mb-5">My Attendance</h1>
      <div className="grid gap-4 md:grid-cols-2">
        {rows.map((r, i) => (
          <Card key={i} title={`${r.course_code} — ${r.title}`}>
            <div className="flex items-end justify-between">
              <p className="text-3xl font-display">{r.attendance_pct ?? 0}%</p>
              <p className="text-sm text-ink/50">{r.present_count} / {r.total_classes} classes</p>
            </div>
            <div className="w-full bg-black/5 rounded-full h-2 mt-3">
              <div
                className={`h-2 rounded-full ${r.attendance_pct >= 75 ? "bg-safe" : "bg-danger"}`}
                style={{ width: `${Math.min(r.attendance_pct || 0, 100)}%` }}
              />
            </div>
          </Card>
        ))}
        {rows.length === 0 && <p className="text-ink/40">No attendance records yet.</p>}
      </div>
    </PortalShell>
  );
}
