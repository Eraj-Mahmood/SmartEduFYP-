import { useEffect, useState } from "react";
import client from "../../api/client";
import { PortalShell, Card } from "../../components/Shell";

const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/assignments", label: "Assignments" },
  { href: "/admin/interventions", label: "Interventions" },
];

export default function ManageUsers() {
  const [tab, setTab] = useState("student");
  const [students, setStudents] = useState([]);
  const [studentPage, setStudentPage] = useState(1);
  const [studentTotalPages, setStudentTotalPages] = useState(1);
  const [studentSearch, setStudentSearch] = useState("");
  const [faculty, setFaculty] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [form, setForm] = useState({});
  const [issuedCred, setIssuedCred] = useState(null);
  const [error, setError] = useState("");

  function loadStudents(page = studentPage, search = studentSearch) {
    client
      .get("/admin/students", { params: { page, limit: 25, search } })
      .then((res) => {
        setStudents(res.data.rows);
        setStudentTotalPages(res.data.totalPages);
        setStudentPage(res.data.page);
      });
  }
  function loadFaculty() {
    client.get("/admin/faculty").then((res) => setFaculty(res.data));
  }
  useEffect(() => {
    loadStudents(1, "");
    loadFaculty();
    client.get("/admin/departments").then((res) => setDepartments(res.data));
  }, []);

  // debounce search so we're not firing a request on every keystroke
  useEffect(() => {
    const t = setTimeout(() => loadStudents(1, studentSearch), 350);
    return () => clearTimeout(t);
  }, [studentSearch]);

  async function createStudent(e) {
    e.preventDefault();
    setError("");
    try {
      const { data } = await client.post("/admin/users/student", form);
      setIssuedCred({ email: form.email, password: data.tempPassword });
      setForm({});
      loadStudents(1, studentSearch);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create student account");
    }
  }

  async function createFaculty(e) {
    e.preventDefault();
    setError("");
    try {
      const { data } = await client.post("/admin/users/faculty", form);
      setIssuedCred({ email: form.email, password: data.tempPassword });
      setForm({});
      loadFaculty();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create faculty account");
    }
  }

  return (
    <PortalShell title="Admin" links={LINKS}>
      <h1 className="font-display text-2xl mb-5">Manage Users</h1>

      <div className="flex gap-2 mb-5">
        <button onClick={() => setTab("student")} className={`px-3 py-1.5 rounded text-sm ${tab === "student" ? "bg-brand text-white" : "bg-white border border-black/10"}`}>Students</button>
        <button onClick={() => setTab("faculty")} className={`px-3 py-1.5 rounded text-sm ${tab === "faculty" ? "bg-brand text-white" : "bg-white border border-black/10"}`}>Faculty</button>
      </div>

      {error && (
        <Card className="mb-5 border-l-4 border-l-danger">
          <p className="text-sm text-danger">{error}</p>
        </Card>
      )}

      {issuedCred && (
        <Card className="mb-5 border-l-4 border-l-safe">
          <p className="text-sm">
            Account created. Share these credentials with the user (they'll be forced to reset the password on first login):
          </p>
          <p className="font-mono text-sm mt-2">Email: {issuedCred.email}</p>
          <p className="font-mono text-sm">Temp password: {issuedCred.password}</p>
        </Card>
      )}

      {tab === "student" ? (
        <Card title="Create Student Account">
          <form onSubmit={createStudent} className="grid grid-cols-2 gap-3">
            <input required placeholder="Email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} className="border border-black/10 rounded px-3 py-2" />
            <input required placeholder="Full name" value={form.full_name || ""} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="border border-black/10 rounded px-3 py-2" />
            <input required placeholder="Roll No" value={form.roll_no || ""} onChange={(e) => setForm({ ...form, roll_no: e.target.value })} className="border border-black/10 rounded px-3 py-2" />
            <select required value={form.department_id || ""} onChange={(e) => setForm({ ...form, department_id: Number(e.target.value) })} className="border border-black/10 rounded px-3 py-2 text-ink/80">
              <option value="" disabled>Select department</option>
              {departments.map((d) => <option key={d.department_id} value={d.department_id}>{d.name}</option>)}
            </select>
            <select value={form.gender || ""} onChange={(e) => setForm({ ...form, gender: e.target.value })} className="border border-black/10 rounded px-3 py-2 text-ink/80">
              <option value="" disabled>Select gender</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
            <input type="number" placeholder="Age" value={form.age || ""} onChange={(e) => setForm({ ...form, age: Number(e.target.value) })} className="border border-black/10 rounded px-3 py-2" />
            <button type="submit" className="col-span-2 bg-brand text-white rounded py-2 hover:bg-brand-dark transition">Create student</button>
          </form>
        </Card>
      ) : (
        <Card title="Create Faculty Account">
          <form onSubmit={createFaculty} className="grid grid-cols-2 gap-3">
            <input required placeholder="Email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} className="border border-black/10 rounded px-3 py-2" />
            <input required placeholder="Full name" value={form.full_name || ""} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="border border-black/10 rounded px-3 py-2" />
            <input required placeholder="Employee No" value={form.employee_no || ""} onChange={(e) => setForm({ ...form, employee_no: e.target.value })} className="border border-black/10 rounded px-3 py-2" />
            <select required value={form.department_id || ""} onChange={(e) => setForm({ ...form, department_id: Number(e.target.value) })} className="border border-black/10 rounded px-3 py-2 text-ink/80">
              <option value="" disabled>Select department</option>
              {departments.map((d) => <option key={d.department_id} value={d.department_id}>{d.name}</option>)}
            </select>
            <input placeholder="Designation" value={form.designation || ""} onChange={(e) => setForm({ ...form, designation: e.target.value })} className="border border-black/10 rounded px-3 py-2" />
            <button type="submit" className="col-span-2 bg-brand text-white rounded py-2 hover:bg-brand-dark transition">Create faculty</button>
          </form>
        </Card>
      )}

      <Card title={tab === "student" ? "All Students" : "All Faculty"} className="mt-5">
        {tab === "student" && (
          <div className="mb-4 flex items-center justify-between gap-3">
            <input
              placeholder="Search by roll no, name, or email..."
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
              className="border border-black/10 rounded px-3 py-2 text-sm w-72"
            />
            <span className="text-xs text-ink/40">Page {studentPage} of {studentTotalPages}</span>
          </div>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink/50 border-b border-black/10">
              {tab === "student" ? (
                <><th className="py-2">Roll No</th><th>Name</th><th>Dept</th><th>CGPA</th><th>Email</th><th>Active</th></>
              ) : (
                <><th className="py-2">Employee No</th><th>Name</th><th>Dept</th><th>Classes</th><th>Email</th><th>Active</th></>
              )}
            </tr>
          </thead>
          <tbody>
            {(tab === "student" ? students : faculty).map((row, i) => (
              <tr key={i} className="border-b border-black/5">
                {tab === "student" ? (
                  <>
                    <td className="py-2">{row.roll_no}</td><td>{row.full_name}</td><td>{row.department}</td>
                    <td>{row.cgpa}</td><td>{row.email}</td><td>{row.is_active ? "Yes" : "No"}</td>
                  </>
                ) : (
                  <>
                    <td className="py-2">{row.employee_no}</td><td>{row.full_name}</td><td>{row.department}</td>
                    <td>{row.classes_taught}</td><td>{row.email}</td><td>{row.is_active ? "Yes" : "No"}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {tab === "student" && studentTotalPages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-4">
            <button
              disabled={studentPage <= 1}
              onClick={() => loadStudents(studentPage - 1, studentSearch)}
              className="px-3 py-1.5 rounded border border-black/10 text-sm disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-sm text-ink/50">{studentPage} / {studentTotalPages}</span>
            <button
              disabled={studentPage >= studentTotalPages}
              onClick={() => loadStudents(studentPage + 1, studentSearch)}
              className="px-3 py-1.5 rounded border border-black/10 text-sm disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </Card>
    </PortalShell>
  );
}
