import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import client from "../../api/client";
import { PortalShell } from "../../components/Shell";
import { StandingChip, STANDING_OPTIONS, Card, DataTable, Pagination, RiskChip, Button, EmptyState, Icons, RISK_SEVERITY, useToast, PredictionSource } from "../../components/ui";
import useApi from "../../lib/useApi";
import { timeAgo } from "../../lib/format";
import { AssignCounselorModal, ComposeModal } from "./InterventionModals";
import AdminStudentDrawer from "./AdminStudentDrawer";
import { ScheduleSessionModal } from "./CounsellingModals";

/** Pre-fill for the "Schedule counselling" form from a flagged student (reason risk, agenda = top reason). */
export function sessionPrefill({ student_id, roll_no, full_name, final_label, counselor, reasons }) {
  return {
    student: { student_id, roll_no, full_name, final_label, counselor: counselor ? { faculty_id: counselor.faculty_id, name: counselor.name } : null },
    reason: final_label === "At-Risk" || final_label === "Dropout-Likely" ? "risk" : "manual",
    agenda: reasons?.[0] ? `Discuss: ${reasons[0]}` : "",
  };
}

// The intervention workflow: every flagged student with their weakest course, its tutorial,
// their counselor and the last intervention, so an admin can see what is still missing and act
// on one row or many.

// Server sorts each column one way (most useful first); clicking a header switches the sort.
const SERVER_SORT = {
  final_label: { sort: "severity", dir: "desc" },
  roll_no: { sort: "roll", dir: "asc" },
};

const shorten = (s, n = 70) => (!s ? "" : s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function Toggle({ checked, onChange, children }) {
  return (
    <label className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer select-none ${checked ? "border-brand bg-brand-50 text-brand-dark" : "border-line bg-surface text-ink"}`}>
      <input type="checkbox" className="accent-brand" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

export default function Interventions() {
  const departments = useApi("/admin/departments");
  const [filters, setFilters] = useState({ department: "", label: "", dataSource: "", standing: "", search: "", noCounselor: false, notContacted: false });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState("final_label");
  const [selected, setSelected] = useState({}); // student_id -> row
  const [assignFor, setAssignFor] = useState(null);
  const [composeFor, setComposeFor] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [viewId, setViewId] = useState(null); // student shown in the detail drawer
  const [scheduleFor, setScheduleFor] = useState(null); // "Schedule counselling" pre-fill
  const { toast } = useToast();

  // CSV of every flagged student matching the current filters (not just this page)
  async function exportCsv() {
    setExporting(true);
    try {
      const p = { ...filters, noCounselor: filters.noCounselor ? 1 : "", notContacted: filters.notContacted ? 1 : "" };
      Object.keys(p).forEach((k) => (p[k] === "" || p[k] === false) && delete p[k]);
      const res = await client.get("/admin/at-risk-students/export", { params: p, responseType: "blob" });
      const name = /filename="([^"]+)"/.exec(res.headers["content-disposition"] || "")?.[1] || "flagged-students.csv";
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast("Could not export the list", { type: "error" });
    } finally {
      setExporting(false);
    }
  }

  // debounce the search box
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => ({ ...f, search })), 350);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(1), [filters, sortKey]);

  const params = { ...filters, page, limit: 20, sort: SERVER_SORT[sortKey].sort };
  params.noCounselor = filters.noCounselor ? 1 : "";
  params.notContacted = filters.notContacted ? 1 : "";
  Object.keys(params).forEach((k) => params[k] === "" && delete params[k]);
  const list = useApi("/admin/at-risk-students", { params });
  const data = list.data || { rows: [], total: 0, page: 1, totalPages: 0 };

  const selectedRows = Object.values(selected);
  const pageIds = data.rows.map((r) => r.student_id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected[id]);
  const toggle = (row) =>
    setSelected((s) => {
      const n = { ...s };
      if (n[row.student_id]) delete n[row.student_id];
      else n[row.student_id] = row;
      return n;
    });
  const togglePage = () =>
    setSelected((s) => {
      const n = { ...s };
      data.rows.forEach((r) => (allOnPage ? delete n[r.student_id] : (n[r.student_id] = r)));
      return n;
    });

  const setFilter = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));

  const columns = useMemo(
    () => [
      {
        key: "select",
        header: (
          <input type="checkbox" className="accent-brand" aria-label="Select every student on this page" checked={allOnPage} onChange={togglePage} />
        ),
        sortable: false,
        width: 36,
        render: (r) => (
          <input type="checkbox" className="accent-brand" aria-label={`Select ${r.full_name}`} checked={Boolean(selected[r.student_id])} onChange={() => toggle(r)} />
        ),
      },
      {
        key: "roll_no",
        header: "Student",
        render: (r) => (
          <button type="button" onClick={() => setViewId(r.student_id)} className="whitespace-nowrap text-left group" title="Open student details">
            <span className="block font-medium group-hover:underline">{r.full_name}</span>
            <span className="block font-mono text-xs text-muted">
              {r.roll_no} · {r.department_code}
            </span>
          </button>
        ),
      },
      {
        key: "final_label",
        header: "Label",
        render: (r) => (
          <span className="inline-flex flex-col items-start gap-1">
            <RiskChip label={r.final_label} size="sm" short />
            <PredictionSource compact source={r.source} modelLabel={r.model_label} finalLabel={r.final_label} staff />
          </span>
        ),
        sortValue: (r) => RISK_SEVERITY[r.final_label],
      },
      {
        key: "academic_status",
        header: <span className="inline-block whitespace-normal leading-tight">Standing (BU)</span>,
        sortable: false,
        render: (r) => <StandingChip status={r.academic_status} short />,
      },
      {
        key: "reasons",
        header: "Reasons",
        sortable: false,
        render: (r) => (
          <span className="block min-w-[160px] max-w-[190px] text-muted leading-snug" title={(r.reasons || []).join(" ")}>
            {shorten(r.reasons?.[0] || r.policy_reason || "—")}
            {r.reasons?.length > 1 && <span className="text-xs text-muted/80"> +{r.reasons.length - 1} more</span>}
          </span>
        ),
      },
      {
        key: "weakest",
        header: <span className="inline-block whitespace-normal leading-tight">Weakest course</span>,
        sortable: false,
        render: (r) =>
          r.weakest_course ? (
            <span className="whitespace-nowrap">
              <span className="font-mono text-xs">{r.weakest_course.course_code}</span>
              <span className="block text-xs text-muted">avg {Math.round(r.weakest_course.mean)}</span>
            </span>
          ) : (
            <span className="text-xs text-muted">No courses this term</span>
          ),
      },
      {
        key: "tutorial",
        header: "Tutorial",
        sortable: false,
        render: (r) =>
          r.tutorial ? (
            <a href={r.tutorial.url} target="_blank" rel="noopener noreferrer" className="block max-w-[150px] truncate text-brand hover:underline" title={r.tutorial.title}>
              {r.tutorial.title}
            </a>
          ) : r.weakest_course ? (
            <Link to={`/admin/tutorials?course=${r.weakest_course.course_id}`} className="text-xs text-risk-700 hover:underline whitespace-nowrap">
              none - add one
            </Link>
          ) : (
            <span className="text-muted">—</span>
          ),
      },
      {
        key: "counselor",
        header: "Counselor",
        sortable: false,
        render: (r) =>
          r.counselor ? (
            <button type="button" onClick={() => setAssignFor(r)} className="text-left whitespace-nowrap group" title="Change counselor">
              <span className="block text-sm group-hover:underline">{r.counselor.name}</span>
              <span className="block text-xs text-muted">{r.counselor.last_contacted_at ? `contacted ${timeAgo(r.counselor.last_contacted_at)}` : "not contacted yet"}</span>
            </button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setAssignFor(r)} icon={<Icons.UserCheck size={14} />}>
              Assign
            </Button>
          ),
      },
      {
        key: "last_intervention_at",
        header: <span className="inline-block whitespace-normal leading-tight">Last intervention</span>,
        sortable: false,
        render: (r) => <span className={`whitespace-nowrap ${r.last_intervention_at ? "text-muted" : "text-risk-700"}`}>{r.last_intervention_at ? timeAgo(r.last_intervention_at) : "never"}</span>,
      },
      {
        key: "send",
        header: "",
        sortable: false,
        render: (r) => (
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => setScheduleFor(sessionPrefill(r))} icon={<Icons.Calendar size={13} />} title="Schedule counselling">
              Schedule
            </Button>
            <Button size="sm" onClick={() => setComposeFor([r])} icon={<Icons.Send size={13} />}>
              Send
            </Button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, allOnPage, data.rows]
  );

  return (
    <PortalShell>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl sm:text-[28px] mb-1">Interventions</h1>
          <p className="text-muted text-sm max-w-2xl">
            Students whose latest prediction is At-Risk or Dropout-Likely. Make sure each one has a counselor, a tutorial for their weakest course and a message.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 self-start sm:self-auto">
          <Link to="/admin/tutorials" className="text-sm font-medium text-brand hover:underline inline-flex items-center gap-1">
            <Icons.Book size={15} /> Manage tutorials
          </Link>
          <Button variant="secondary" size="sm" onClick={exportCsv} loading={exporting} icon={<Icons.Download size={15} />}>
            Export CSV
          </Button>
        </div>
      </div>

      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 mb-3">
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
            <span className="sr-only">Label</span>
            <select className="field" value={filters.label} onChange={setFilter("label")}>
              <option value="">At-Risk and Dropout-Likely</option>
              <option value="Dropout-Likely">Dropout-Likely only</option>
              <option value="At-Risk">At-Risk only</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Data source</span>
            <select className="field" value={filters.dataSource} onChange={setFilter("dataSource")}>
              <option value="">Synthetic and live data</option>
              <option value="live">With live data</option>
              <option value="synthetic">Synthetic data only</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Academic standing</span>
            <select className="field" value={filters.standing} onChange={setFilter("standing")}>
              <option value="">Every standing</option>
              {STANDING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-2 mb-4">
          <Toggle checked={filters.noCounselor} onChange={(v) => setFilters((f) => ({ ...f, noCounselor: v }))}>
            No counselor yet
          </Toggle>
          <Toggle checked={filters.notContacted} onChange={(v) => setFilters((f) => ({ ...f, notContacted: v }))}>
            Not contacted
          </Toggle>
        </div>

        {list.error ? (
          <EmptyState icon={<Icons.AlertOctagon size={22} />} message="We couldn't load the list" detail={list.error} action={<Button variant="secondary" onClick={() => list.reload()}>Try again</Button>} />
        ) : (
          <>
            <DataTable
              loading={list.loading && !list.data}
              rows={data.rows}
              rowKey={(r) => r.student_id}
              minWidth={1210}
              sort={{ key: sortKey, dir: SERVER_SORT[sortKey].dir }}
              onSortChange={({ key }) => SERVER_SORT[key] && setSortKey(key)}
              rowClassName={(r) => (selected[r.student_id] ? "bg-brand-50/60" : "")}
              emptyMessage="No flagged students match these filters"
              columns={columns}
            />
            <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} label="flagged students" />
          </>
        )}
      </Card>

      {selectedRows.length > 0 && (
        <div className="sticky bottom-3 z-10 mt-4">
          <div className="mx-auto max-w-3xl flex flex-wrap items-center justify-between gap-3 rounded-xl bg-ink text-white px-4 py-3 shadow-pop">
            <span className="text-sm">
              <strong>{selectedRows.length}</strong> selected
            </span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setSelected({})} className="px-3 py-1.5 rounded-lg text-sm text-white/80 hover:bg-white/10">
                Clear
              </button>
              <Button size="sm" onClick={() => setComposeFor(selectedRows)} icon={<Icons.Send size={14} />} disabled={selectedRows.length > 500}>
                Send to {selectedRows.length}
              </Button>
            </div>
          </div>
        </div>
      )}

      <AdminStudentDrawer studentId={viewId} onClose={() => setViewId(null)} onSchedule={(prefill) => {
          setViewId(null);
          setScheduleFor(prefill);
        }} />
      <ScheduleSessionModal
        open={Boolean(scheduleFor)}
        prefill={scheduleFor}
        onClose={() => setScheduleFor(null)}
        onSaved={() => {
          setScheduleFor(null);
          list.reload({ quiet: true });
        }}
      />
      <AssignCounselorModal
        student={assignFor}
        onClose={() => setAssignFor(null)}
        onAssigned={() => {
          setAssignFor(null);
          list.reload({ quiet: true });
        }}
      />
      <ComposeModal
        targets={composeFor}
        onClose={() => setComposeFor([])}
        onSent={() => {
          setComposeFor([]);
          setSelected({});
          list.reload({ quiet: true });
        }}
      />
    </PortalShell>
  );
}
