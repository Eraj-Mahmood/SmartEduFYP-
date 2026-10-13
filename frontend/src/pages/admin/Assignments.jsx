import { useEffect, useState } from "react";
import client from "../../api/client";
import { PortalShell, Card } from "../../components/Shell";

const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/assignments", label: "Assignments" },
  { href: "/admin/interventions", label: "Interventions" },
];

export default function Assignments() {
  const [departments, setDepartments] = useState([]);
  const [faculty, setFaculty] = useState([]);
  const [courses, setCourses] = useState([]);
  const [classes, setClasses] = useState([]);
  const [enrollments, setEnrollments] = useState([]);

  const [courseForm, setCourseForm] = useState({});
  const [assignForm, setAssignForm] = useState({});
  const [enrollForm, setEnrollForm] = useState({});
  const [dropId, setDropId] = useState("");

  const [studentQuery, setStudentQuery] = useState("");
  const [studentResults, setStudentResults] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function loadAll() {
    client.get("/admin/departments").then((res) => setDepartments(res.data));
    client.get("/admin/faculty").then((res) => setFaculty(res.data));
    client.get("/admin/courses").then((res) => setCourses(res.data));
    client.get("/admin/faculty-courses").then((res) => setClasses(res.data));
    client.get("/admin/enrollments").then((res) => setEnrollments(res.data));
  }
  useEffect(loadAll, []);

  // debounced student search-as-you-type for the enroll form
  useEffect(() => {
    if (!studentQuery.trim()) {
      setStudentResults([]);
      return;
    }
    const t = setTimeout(() => {
      client
        .get("/admin/students", { params: { page: 1, limit: 8, search: studentQuery } })
        .then((res) => setStudentResults(res.data.rows));
    }, 300);
    return () => clearTimeout(t);
  }, [studentQuery]);

  function pickStudent(s) {
    setSelectedStudent(s);
    setEnrollForm({ ...enrollForm, student_id: s.student_id });
    setStudentQuery(`${s.roll_no} — ${s.full_name}`);
    setStudentResults([]);
  }

  async function createCourse(e) {
    e.preventDefault();
    setError(""); setMessage("");
    try {
      await client.post("/admin/courses", courseForm);
      setMessage("Course created.");
      setCourseForm({});
      loadAll();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create course");
    }
  }

  async function assignFaculty(e) {
    e.preventDefault();
    setError(""); setMessage("");
    try {
      await client.post("/admin/faculty-courses", assignForm);
      setMessage("Faculty assigned to course/section.");
      setAssignForm({});
      loadAll();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to assign faculty");
    }
  }

  async function enrollStudent(e) {
    e.preventDefault();
    setError(""); setMessage("");
    try {
      await client.post("/admin/enrollments", enrollForm);
      setMessage("Student enrolled (course assigned).");
      setEnrollForm({});
      setSelectedStudent(null);
      setStudentQuery("");
      loadAll();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to enroll student");
    }
  }

  async function dropCourse(e) {
    e.preventDefault();
    setError(""); setMessage("");
    try {
      await client.put(`/admin/enrollments/${dropId}/drop`);
      setMessage(`Enrollment #${dropId} marked dropped.`);
      setDropId("");
      loadAll();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to drop enrollment");
    }
  }

  return (
    <PortalShell title="Admin" links={LINKS}>
      <h1 className="font-display text-2xl mb-5">Courses &amp; Assignments</h1>
      {message && <p className="text-safe text-sm mb-4">{message}</p>}
      {error && <p className="text-danger text-sm mb-4">{error}</p>}

      {/* ---------- EXISTING RECORDS (shown first, so you can see what's already there) ---------- */}
      <div className="grid md:grid-cols-2 gap-5 mb-8">
        <Card title={`Existing Courses (${courses.length})`}>
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink/50 border-b border-black/10 sticky top-0 bg-white">
                  <th className="py-2">Code</th><th>Title</th><th>Dept</th><th>Credits</th>
                </tr>
              </thead>
              <tbody>
                {courses.map((c) => (
                  <tr key={c.course_id} className="border-b border-black/5">
                    <td className="py-1.5">{c.course_code}</td><td>{c.title}</td><td>{c.department}</td><td>{c.credit_hours}</td>
                  </tr>
                ))}
                {courses.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-ink/40">No courses yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title={`Existing Class Sections (${classes.length})`}>
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink/50 border-b border-black/10 sticky top-0 bg-white">
                  <th className="py-2">Course</th><th>Sec</th><th>Faculty</th><th>Enrolled</th>
                </tr>
              </thead>
              <tbody>
                {classes.map((c) => (
                  <tr key={c.faculty_course_id} className="border-b border-black/5">
                    <td className="py-1.5">{c.course_code}</td><td>{c.section}</td><td>{c.faculty_name}</td><td>{c.enrolled_count}</td>
                  </tr>
                ))}
                {classes.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-ink/40">No class sections yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title={`Current Enrollments (${enrollments.length})`} className="md:col-span-2">
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink/50 border-b border-black/10 sticky top-0 bg-white">
                  <th className="py-2">Enrollment ID</th><th>Student</th><th>Course</th><th>Section</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {enrollments.map((e) => (
                  <tr key={e.enrollment_id} className="border-b border-black/5">
                    <td className="py-1.5">{e.enrollment_id}</td>
                    <td>{e.roll_no} — {e.student_name}</td>
                    <td>{e.course_code}</td><td>{e.section}</td>
                    <td className={e.status === "dropped" ? "text-danger" : e.status === "completed" ? "text-ink/50" : "text-safe"}>{e.status}</td>
                  </tr>
                ))}
                {enrollments.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-ink/40">No enrollments yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* ---------- ACTION FORMS ---------- */}
      <div className="grid md:grid-cols-2 gap-5">
        <Card title="Create Course">
          <form onSubmit={createCourse} className="space-y-3">
            <input required placeholder="Course code (e.g. CS301)" value={courseForm.course_code || ""} onChange={(e) => setCourseForm({ ...courseForm, course_code: e.target.value })} className="w-full border border-black/10 rounded px-3 py-2" />
            <input required placeholder="Title" value={courseForm.title || ""} onChange={(e) => setCourseForm({ ...courseForm, title: e.target.value })} className="w-full border border-black/10 rounded px-3 py-2" />
            <select required value={courseForm.department_id || ""} onChange={(e) => setCourseForm({ ...courseForm, department_id: Number(e.target.value) })} className="w-full border border-black/10 rounded px-3 py-2 text-ink/80">
              <option value="" disabled>Select department</option>
              {departments.map((d) => <option key={d.department_id} value={d.department_id}>{d.name}</option>)}
            </select>
            <input type="number" placeholder="Credit hours (default 3)" value={courseForm.credit_hours || ""} onChange={(e) => setCourseForm({ ...courseForm, credit_hours: Number(e.target.value) })} className="w-full border border-black/10 rounded px-3 py-2" />
            <button className="w-full bg-brand text-white rounded py-2 hover:bg-brand-dark transition">Create course</button>
          </form>
        </Card>

        <Card title="Assign Faculty to Course (they can teach multiple)">
          <form onSubmit={assignFaculty} className="space-y-3">
            <select required value={assignForm.faculty_id || ""} onChange={(e) => setAssignForm({ ...assignForm, faculty_id: Number(e.target.value) })} className="w-full border border-black/10 rounded px-3 py-2 text-ink/80">
              <option value="" disabled>Select faculty</option>
              {faculty.map((f) => <option key={f.faculty_id} value={f.faculty_id}>{f.full_name} ({f.department})</option>)}
            </select>
            <select required value={assignForm.course_id || ""} onChange={(e) => setAssignForm({ ...assignForm, course_id: Number(e.target.value) })} className="w-full border border-black/10 rounded px-3 py-2 text-ink/80">
              <option value="" disabled>Select course</option>
              {courses.map((c) => <option key={c.course_id} value={c.course_id}>{c.course_code} — {c.title}</option>)}
            </select>
            <input placeholder="Section (default A)" value={assignForm.section || ""} onChange={(e) => setAssignForm({ ...assignForm, section: e.target.value })} className="w-full border border-black/10 rounded px-3 py-2" />
            <input required type="number" placeholder="Semester" value={assignForm.semester || ""} onChange={(e) => setAssignForm({ ...assignForm, semester: Number(e.target.value) })} className="w-full border border-black/10 rounded px-3 py-2" />
            <input required placeholder="Academic year (e.g. 2025-2026)" value={assignForm.academic_year || ""} onChange={(e) => setAssignForm({ ...assignForm, academic_year: e.target.value })} className="w-full border border-black/10 rounded px-3 py-2" />
            <button className="w-full bg-brand text-white rounded py-2 hover:bg-brand-dark transition">Assign faculty</button>
          </form>
        </Card>

        <Card title="Enroll Student in a Class (course assigning)">
          <form onSubmit={enrollStudent} className="space-y-3">
            <div className="relative">
              <input
                required
                placeholder="Search student by roll no, name, or email..."
                value={studentQuery}
                onChange={(e) => { setStudentQuery(e.target.value); setSelectedStudent(null); setEnrollForm({ ...enrollForm, student_id: undefined }); }}
                className="w-full border border-black/10 rounded px-3 py-2"
              />
              {studentResults.length > 0 && (
                <div className="absolute z-10 w-full bg-white border border-black/10 rounded mt-1 shadow-lg max-h-48 overflow-y-auto">
                  {studentResults.map((s) => (
                    <button
                      type="button"
                      key={s.student_id}
                      onClick={() => pickStudent(s)}
                      className="block w-full text-left px-3 py-2 text-sm hover:bg-paper transition"
                    >
                      {s.roll_no} — {s.full_name} ({s.department})
                    </button>
                  ))}
                </div>
              )}
            </div>
            <select required value={enrollForm.faculty_course_id || ""} onChange={(e) => setEnrollForm({ ...enrollForm, faculty_course_id: Number(e.target.value) })} className="w-full border border-black/10 rounded px-3 py-2 text-ink/80">
              <option value="" disabled>Select class</option>
              {classes.map((c) => (
                <option key={c.faculty_course_id} value={c.faculty_course_id}>
                  {c.course_code} — {c.title} (Sec {c.section}, {c.faculty_name})
                </option>
              ))}
            </select>
            <button className="w-full bg-brand text-white rounded py-2 hover:bg-brand-dark transition">Enroll student</button>
          </form>
        </Card>

        <Card title="Drop a Course (course dropping)">
          <form onSubmit={dropCourse} className="space-y-3">
            <select required value={dropId} onChange={(e) => setDropId(e.target.value)} className="w-full border border-black/10 rounded px-3 py-2 text-ink/80">
              <option value="" disabled>Select enrollment to drop</option>
              {enrollments.filter((e) => e.status === "enrolled").map((e) => (
                <option key={e.enrollment_id} value={e.enrollment_id}>
                  #{e.enrollment_id} — {e.roll_no} in {e.course_code} (Sec {e.section})
                </option>
              ))}
            </select>
            <button className="w-full bg-danger text-white rounded py-2 hover:opacity-90 transition">Drop enrollment</button>
          </form>
        </Card>
      </div>
    </PortalShell>
  );
}
