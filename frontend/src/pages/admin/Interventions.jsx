import { useEffect, useState } from "react";
import client from "../../api/client";
import { PortalShell } from "../../components/Shell";
import { Card, DataTable, Pagination, RiskChip, Button, EmptyState, useToast, Icons, RISK_SEVERITY } from "../../components/ui";
import useApi from "../../lib/useApi";
import { gpa, timeAgo } from "../../lib/format";

// Server sorts each column one way (most useful first); clicking a header switches the sort.
const SERVER_SORT = {
  final_label: { sort: "severity", dir: "desc" },
  roll_no: { sort: "roll", dir: "asc" },
  projected_cgpa: { sort: "cgpa", dir: "asc" },
  created_at: { sort: "recent", dir: "desc" },
};

export default function Interventions() {
  const { toast } = useToast();
  const departments = useApi("/admin/departments");
  const [form, setForm] = useState({ subject: "", message: "" });
  const [sentTo, setSentTo] = useState({});
  const [sendingId, setSendingId] = useState(null);
  const [filters, setFilters] = useState({ department: "", label: "", semester: "", search: "" });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState("final_label");

  // debounce the search box
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => ({ ...f, search })), 350);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(1), [filters, sortKey]);

  const params = { ...filters, page, limit: 20, sort: SERVER_SORT[sortKey].sort };
  Object.keys(params).forEach((k) => params[k] === "" && delete params[k]);
  const list = useApi("/admin/at-risk-students", { params });
  const data = list.data || { rows: [], total: 0, page: 1, totalPages: 0 };

  async function send(student) {
    if (!form.subject || !form.message) {
      toast("Write a subject and message in the template first", { type: "warning" });
      return;
    }
    setSendingId(student.student_id);
    try {
      await client.post("/admin/notifications", {
        recipient_user_id: student.user_id,
        subject: form.subject,
        message: form.message,
      });
      setSentTo((s) => ({ ...s, [student.student_id]: true }));
      toast(`Sent to ${student.full_name} (${student.roll_no})`, { type: "success", title: "Notification sent" });
    } catch (e) {
      toast(e.response?.data?.error || "Could not send the notification", { type: "error" });
    } finally {
      setSendingId(null);
    }
  }

  const setFilter = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));
  const templateReady = form.subject && form.message;

  return (
    <PortalShell>
      <h1 className="font-display text-2xl sm:text-[28px] mb-1">Interventions</h1>
      <p className="text-muted text-sm mb-5">Students whose latest prediction is At-Risk or Dropout-Likely. Write a message once, then send it to anyone on the list.</p>

      <Card title="Message template" subtitle="Students see this in their notifications" className="mb-4">
        <div className="grid gap-3 md:grid-cols-[1fr_2fr]">
          <label>
            <span className="field-label">Subject</span>
            <input className="field" placeholder="e.g. Let's talk about your progress" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          </label>
          <label>
            <span className="field-label">Message</span>
            <textarea className="field" rows={2} placeholder="Suggest a meeting time and where to find support." value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
          </label>
        </div>
        {!templateReady && <p className="mt-2 text-xs text-muted">Fill in both fields to enable Send.</p>}
      </Card>

      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-4">
          <label className="relative">
            <span className="sr-only">Search</span>
            <Icons.Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input type="search" className="field pl-9" placeholder="Roll no, name or email" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <label>
            <span className="sr-only">Department</span>
            <select className="field" value={filters.department} onChange={setFilter("department")}>
              <option value="">All departments</option>
              {(departments.data || []).map((d) => (
                <option key={d.department_id} value={d.department_id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Risk</span>
            <select className="field" value={filters.label} onChange={setFilter("label")}>
              <option value="">At-Risk and Dropout-Likely</option>
              <option value="Dropout-Likely">Dropout-Likely only</option>
              <option value="At-Risk">At-Risk only</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Semester</span>
            <select className="field" value={filters.semester} onChange={setFilter("semester")}>
              <option value="">All semesters</option>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                <option key={s} value={s}>
                  Semester {s}
                </option>
              ))}
            </select>
          </label>
        </div>

        {list.error ? (
          <EmptyState icon={<Icons.AlertOctagon size={22} />} message="We couldn't load the list" detail={list.error} action={<Button variant="secondary" onClick={() => list.reload()}>Try again</Button>} />
        ) : (
          <>
            <DataTable
              loading={list.loading}
              rows={data.rows}
              rowKey={(r) => r.student_id}
              minWidth={900}
              sort={{ key: sortKey, dir: SERVER_SORT[sortKey].dir }}
              onSortChange={({ key }) => SERVER_SORT[key] && setSortKey(key)}
              emptyMessage="No flagged students match these filters"
              columns={[
                {
                  key: "roll_no",
                  header: "Student",
                  render: (r) => (
                    <span className="whitespace-nowrap">
                      <span className="block font-medium">{r.full_name}</span>
                      <span className="block font-mono text-xs text-muted">{r.roll_no}</span>
                    </span>
                  ),
                },
                { key: "department_code", header: "Dept", sortable: false, render: (r) => <span className="whitespace-nowrap" title={r.department}>{r.department_code} · S{r.current_semester}</span> },
                { key: "final_label", header: "Risk", render: (r) => <RiskChip label={r.final_label} size="sm" />, sortValue: (r) => RISK_SEVERITY[r.final_label] },
                {
                  key: "why",
                  header: "Main reason",
                  sortable: false,
                  render: (r) => <span className="block max-w-[260px] truncate text-muted" title={(r.reasons || []).join(" ")}>{r.reasons?.[0] || r.policy_reason || "—"}</span>,
                },
                { key: "projected_cgpa", header: "Proj. CGPA", align: "right", render: (r) => gpa(r.projected_cgpa) },
                { key: "created_at", header: "Updated", align: "right", render: (r) => <span className="whitespace-nowrap text-muted">{timeAgo(r.created_at)}</span> },
                {
                  key: "send",
                  header: "",
                  sortable: false,
                  render: (r) =>
                    sentTo[r.student_id] ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-safe-700">
                        <Icons.CheckCircle size={14} /> Sent
                      </span>
                    ) : (
                      <Button size="sm" variant={templateReady ? "primary" : "secondary"} loading={sendingId === r.student_id} onClick={() => send(r)} icon={<Icons.Send size={13} />}>
                        Send
                      </Button>
                    ),
                },
              ]}
            />
            <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} label="flagged students" />
          </>
        )}
      </Card>
    </PortalShell>
  );
}
