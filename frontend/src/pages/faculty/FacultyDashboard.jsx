import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import client from "../../api/client";
import { PortalShell, Card } from "../../components/Shell";

const LINKS = [{ href: "/faculty", label: "My Classes" }];

export default function FacultyDashboard() {
  const [classes, setClasses] = useState([]);

  useEffect(() => {
    client.get("/faculty/classes").then((res) => setClasses(res.data));
  }, []);

  return (
    <PortalShell title="Faculty" links={LINKS}>
      <h1 className="font-display text-2xl mb-1">My Classes</h1>
      <p className="text-ink/50 text-sm mb-5">Every subject and section you're assigned to teach.</p>

      <div className="grid gap-4 md:grid-cols-2">
        {classes.map((c) => (
          <Card key={c.faculty_course_id}>
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-display text-lg">{c.course_code} — {c.title}</h3>
                <p className="text-sm text-ink/50">Section {c.section} · Semester {c.semester} · {c.academic_year}</p>
                <p className="text-sm text-ink/50 mt-1">{c.enrolled_count} students enrolled</p>
              </div>
            </div>
            <div className="flex gap-3 mt-4">
              <Link
                to={`/faculty/class/${c.faculty_course_id}/roster`}
                className="text-sm px-3 py-1.5 rounded border border-brand text-brand hover:bg-brand hover:text-white transition"
              >
                Enter results
              </Link>
              <Link
                to={`/faculty/class/${c.faculty_course_id}/attendance`}
                className="text-sm px-3 py-1.5 rounded border border-brand text-brand hover:bg-brand hover:text-white transition"
              >
                Mark attendance
              </Link>
            </div>
          </Card>
        ))}
        {classes.length === 0 && <p className="text-ink/40">No classes assigned yet — contact admin.</p>}
      </div>
    </PortalShell>
  );
}
