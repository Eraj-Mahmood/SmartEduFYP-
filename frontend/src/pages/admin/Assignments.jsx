import { useEffect, useState } from "react";
import client from "../../api/client";
import { PortalShell } from "../../components/Shell";
import { Card, Button, DataTable, Icons } from "../../components/ui";

// Read-only lists keep their original order (no sorting) and scroll inside their card.
const col = (key, header, extra = {}) => ({ key, header, sortable: false, ...extra });
function Scroll({ children }) {
  return <div className="-mx-5 px-5 max-h-72 overflow-y-auto">{children}</div>;
}

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
    <PortalShell>
      <h1 className="font-display text-2xl sm:text-[28px] mb-5">Courses &amp; assignments</h1>
      {message && (
        <p role="status" className="mb-4 flex items-center gap-2 rounded-card border border-safe-500/30 bg-safe-50 px-4 py-2.5 text-sm text-safe-700">
          <Icons.CheckCircle size={16} /> {message}
        </p>
      )}
      {error && (
        <p role="alert" className="mb-4 flex items-center gap-2 rounded-card border border-danger-500/30 bg-danger-50 px-4 py-2.5 text-sm text-danger-700">
          <Icons.AlertOctagon size={16} /> {error}
        </p>
      )}

      {/* ---------- EXISTING RECORDS (shown first, so you can see what's already there) ---------- */}
      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <Card title={`Existing courses (${courses.length})`}>
          <Scroll>
            <DataTable
              rows={courses}
              rowKey={(c) => c.course_id}
              minWidth={420}
              emptyMessage="No courses yet."
              columns={[col("course_code", "Code", { className: "font-mono text-xs" }), col("title", "Title"), col("department", "Dept"), col("credit_hours", "Credits", { align: "right" })]}
            />
          </Scroll>
        </Card>

        <Card title={`Existing class sections (${classes.length})`}>
          <Scroll>
            <DataTable
              rows={classes}
              rowKey={(c) => c.faculty_course_id}
              minWidth={420}
              emptyMessage="No class sections yet."
              columns={[col("course_code", "Course", { className: "font-mono text-xs" }), col("section", "Sec"), col("faculty_name", "Faculty"), col("enrolled_count", "Enrolled", { align: "right" })]}
            />
          </Scroll>
        </Card>

        <Card title={`Current enrollments (${enrollments.length})`} className="md:col-span-2">
          <Scroll>
            <DataTable
              rows={enrollments}
              rowKey={(e) => e.enrollment_id}
              minWidth={560}
              emptyMessage="No enrollments yet."
              columns={[
                col("enrollment_id", "Enrollment ID", { className: "tabular-nums" }),
                col("student", "Student", { render: (e) => `${e.roll_no} — ${e.student_name}` }),
                col("course_code", "Course"),
                col("section", "Section"),
                col("status", "Status", {
                  render: (e) => (
                    <span className={`font-medium ${e.status === "dropped" ? "text-danger-700" : e.status === "completed" ? "text-muted" : "text-safe-700"}`}>{e.status}</span>
                  ),
                }),
              ]}
            />
          </Scroll>
        </Card>
      </div>

      {/* ---------- ACTION FORMS ---------- */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Create course">
          <form onSubmit={createCourse} className="space-y-3">
            <input required placeholder="Course code (e.g. CS301)" value={courseForm.course_code || ""} onChange={(e) => setCourseForm({ ...courseForm, course_code: e.target.value })} className="field" />
            <input required placeholder="Title" value={courseForm.title || ""} onChange={(e) => setCourseForm({ ...courseForm, title: e.target.value })} className="field" />
            <select required value={courseForm.department_id || ""} onChange={(e) => setCourseForm({ ...courseForm, department_id: Number(e.target.value) })} className="field">
              <option value="" disabled>Select department</option>
              {departments.map((d) => <option key={d.department_id} value={d.department_id}>{d.name}</option>)}
            </select>
            <input type="number" placeholder="Credit hours (default 3)" value={courseForm.credit_hours || ""} onChange={(e) => setCourseForm({ ...courseForm, credit_hours: Number(e.target.value) })} className="field" />
            <Button type="submit" className="w-full">Create course</Button>
          </form>
        </Card>

        <Card title="Assign faculty to course" subtitle="A faculty member can teach several courses and sections">
          <form onSubmit={assignFaculty} className="space-y-3">
            <select required value={assignForm.faculty_id || ""} onChange={(e) => setAssignForm({ ...assignForm, faculty_id: Number(e.target.value) })} className="field">
              <option value="" disabled>Select faculty</option>
              {faculty.map((f) => <option key={f.faculty_id} value={f.faculty_id}>{f.full_name} ({f.department})</option>)}
            </select>
            <select required value={assignForm.course_id || ""} onChange={(e) => setAssignForm({ ...assignForm, course_id: Number(e.target.value) })} className="field">
              <option value="" disabled>Select course</option>
              {courses.map((c) => <option key={c.course_id} value={c.course_id}>{c.course_code} — {c.title}</option>)}
            </select>
            <input placeholder="Section (default A)" value={assignForm.section || ""} onChange={(e) => setAssignForm({ ...assignForm, section: e.target.value })} className="field" />
            <input required type="number" placeholder="Semester" value={assignForm.semester || ""} onChange={(e) => setAssignForm({ ...assignForm, semester: Number(e.target.value) })} className="field" />
            <input required placeholder="Academic year (e.g. 2025-2026)" value={assignForm.academic_year || ""} onChange={(e) => setAssignForm({ ...assignForm, academic_year: e.target.value })} className="field" />
            <Button type="submit" className="w-full">Assign faculty</Button>
          </form>
        </Card>

        <Card title="Enroll student in a class">
          <form onSubmit={enrollStudent} className="space-y-3">
            <div className="relative">
              <input
                required
                placeholder="Search student by roll no, name, or email..."
                value={studentQuery}
                onChange={(e) => { setStudentQuery(e.target.value); setSelectedStudent(null); setEnrollForm({ ...enrollForm, student_id: undefined }); }}
                className="field"
              />
              {studentResults.length > 0 && (
                <div className="absolute z-10 w-full bg-surface border border-line rounded-lg mt-1 shadow-pop max-h-48 overflow-y-auto">
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
            <select required value={enrollForm.faculty_course_id || ""} onChange={(e) => setEnrollForm({ ...enrollForm, faculty_course_id: Number(e.target.value) })} className="field">
              <option value="" disabled>Select class</option>
              {classes.map((c) => (
                <option key={c.faculty_course_id} value={c.faculty_course_id}>
                  {c.course_code} — {c.title} (Sec {c.section}, {c.faculty_name})
                </option>
              ))}
            </select>
            <Button type="submit" className="w-full">Enroll student</Button>
          </form>
        </Card>

        <Card title="Drop a course">
          <form onSubmit={dropCourse} className="space-y-3">
            <select required value={dropId} onChange={(e) => setDropId(e.target.value)} className="field">
              <option value="" disabled>Select enrollment to drop</option>
              {enrollments.filter((e) => e.status === "enrolled").map((e) => (
                <option key={e.enrollment_id} value={e.enrollment_id}>
                  #{e.enrollment_id} — {e.roll_no} in {e.course_code} (Sec {e.section})
                </option>
              ))}
            </select>
            <Button type="submit" variant="danger" className="w-full">Drop enrollment</Button>
          </form>
        </Card>
      </div>
    </PortalShell>
  );
}
