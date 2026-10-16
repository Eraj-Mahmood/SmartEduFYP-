import { useEffect, useState } from "react";
import client from "../../api/client";
import { PortalShell } from "../../components/Shell";
import { Card, Button, DataTable, Pagination, Icons } from "../../components/ui";

export default function ManageUsers() {
  const [tab, setTab] = useState("student");
  const [students, setStudents] = useState([]);
  const [studentPage, setStudentPage] = useState(1);
  const [studentTotalPages, setStudentTotalPages] = useState(1);
  const [studentTotal, setStudentTotal] = useState(0);
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
        setStudentTotal(res.data.total);
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

  const tabBtn = (key, label) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === key}
      onClick={() => setTab(key)}
      className={`rounded-md px-4 py-1.5 text-sm transition ${tab === key ? "bg-surface shadow-card font-medium text-ink" : "text-muted hover:text-ink"}`}
    >
      {label}
    </button>
  );

  const studentColumns = [
    { key: "roll_no", header: "Roll no", sortable: false, className: "font-mono text-xs whitespace-nowrap" },
    { key: "full_name", header: "Name", sortable: false, className: "whitespace-nowrap" },
    { key: "department", header: "Dept", sortable: false },
    { key: "cgpa", header: "CGPA", sortable: false, align: "right" },
    { key: "email", header: "Email", sortable: false, className: "text-muted" },
    { key: "is_active", header: "Active", sortable: false, render: (r) => (r.is_active ? "Yes" : "No") },
  ];
  const facultyColumns = [
    { key: "employee_no", header: "Employee no", sortable: false, className: "font-mono text-xs whitespace-nowrap" },
    { key: "full_name", header: "Name", sortable: false, className: "whitespace-nowrap" },
    { key: "department", header: "Dept", sortable: false },
    { key: "classes_taught", header: "Classes", sortable: false, align: "right" },
    { key: "email", header: "Email", sortable: false, className: "text-muted" },
    { key: "is_active", header: "Active", sortable: false, render: (r) => (r.is_active ? "Yes" : "No") },
  ];

  return (
    <PortalShell>
      <h1 className="font-display text-2xl sm:text-[28px] mb-5">Manage users</h1>

      <div role="tablist" aria-label="User type" className="inline-flex rounded-lg bg-ink/[0.05] p-1 mb-5">
        {tabBtn("student", "Students")}
        {tabBtn("faculty", "Faculty")}
      </div>

      {error && (
        <div role="alert" className="mb-5 flex items-start gap-2 rounded-card border border-danger-500/30 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          <Icons.AlertOctagon size={16} className="mt-0.5" /> {error}
        </div>
      )}

      {issuedCred && (
        <div role="status" className="mb-5 rounded-card border border-safe-500/30 bg-safe-50 px-4 py-3 text-sm">
          <p className="flex items-center gap-2 font-medium text-safe-700">
            <Icons.CheckCircle size={16} /> Account created
          </p>
          <p className="mt-1 text-ink/80">Share these credentials with the user (they'll be forced to reset the password on first login):</p>
          <p className="font-mono text-sm mt-2">Email: {issuedCred.email}</p>
          <p className="font-mono text-sm">Temp password: {issuedCred.password}</p>
        </div>
      )}

      {tab === "student" ? (
        <Card title="Create student account">
          <form onSubmit={createStudent} className="grid gap-3 sm:grid-cols-2">
            <input required placeholder="Email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} className="field" />
            <input required placeholder="Full name" value={form.full_name || ""} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="field" />
            <input required placeholder="Roll No" value={form.roll_no || ""} onChange={(e) => setForm({ ...form, roll_no: e.target.value })} className="field" />
            <select required value={form.department_id || ""} onChange={(e) => setForm({ ...form, department_id: Number(e.target.value) })} className="field">
              <option value="" disabled>Select department</option>
              {departments.map((d) => <option key={d.department_id} value={d.department_id}>{d.name}</option>)}
            </select>
            <select value={form.gender || ""} onChange={(e) => setForm({ ...form, gender: e.target.value })} className="field">
              <option value="" disabled>Select gender</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
            <input type="number" placeholder="Age" value={form.age || ""} onChange={(e) => setForm({ ...form, age: Number(e.target.value) })} className="field" />
            <Button type="submit" className="sm:col-span-2">Create student</Button>
          </form>
        </Card>
      ) : (
        <Card title="Create faculty account">
          <form onSubmit={createFaculty} className="grid gap-3 sm:grid-cols-2">
            <input required placeholder="Email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} className="field" />
            <input required placeholder="Full name" value={form.full_name || ""} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="field" />
            <input required placeholder="Employee No" value={form.employee_no || ""} onChange={(e) => setForm({ ...form, employee_no: e.target.value })} className="field" />
            <select required value={form.department_id || ""} onChange={(e) => setForm({ ...form, department_id: Number(e.target.value) })} className="field">
              <option value="" disabled>Select department</option>
              {departments.map((d) => <option key={d.department_id} value={d.department_id}>{d.name}</option>)}
            </select>
            <input placeholder="Designation" value={form.designation || ""} onChange={(e) => setForm({ ...form, designation: e.target.value })} className="field" />
            <Button type="submit" className="sm:col-span-2">Create faculty</Button>
          </form>
        </Card>
      )}

      <Card title={tab === "student" ? "All students" : "All faculty"} className="mt-5">
        {tab === "student" && (
          <label className="relative block mb-4 sm:w-80">
            <span className="sr-only">Search students</span>
            <Icons.Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              placeholder="Search by roll no, name, or email..."
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
              className="field pl-9"
            />
          </label>
        )}
        <DataTable
          rows={tab === "student" ? students : faculty}
          rowKey={(r) => (tab === "student" ? r.student_id : r.faculty_id)}
          columns={tab === "student" ? studentColumns : facultyColumns}
          minWidth={720}
          emptyMessage={tab === "student" ? "No students found" : "No faculty yet"}
        />
        {tab === "student" && (
          <Pagination page={studentPage} totalPages={studentTotalPages} total={studentTotal} onPage={(p) => loadStudents(p, studentSearch)} label="students" />
        )}
      </Card>
    </PortalShell>
  );
}
