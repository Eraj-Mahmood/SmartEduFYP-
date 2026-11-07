import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PortalShell } from "../../components/Shell";
import { Card, DataTable, Pagination, RiskChip, Button, EmptyState, Icons, RISK_SEVERITY } from "../../components/ui";
import useApi from "../../lib/useApi";
import { timeAgo } from "../../lib/format";
import { AssignCounselorModal, ComposeModal } from "./InterventionModals";

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
  const [filters, setFilters] = useState({ department: "", label: "", search: "", noCounselor: false, notContacted: false });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState("final_label");
  const [selected, setSelected] = useState({}); // student_id -> row
  const [assignFor, setAssignFor] = useState(null);
  const [composeFor, setComposeFor] = useState([]);

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
          <span className="whitespace-nowrap">
            <span className="block font-medium">{r.full_name}</span>
            <span className="block font-mono text-xs text-muted">
              {r.roll_no} · {r.department_code}
            </span>
          </span>
        ),
      },
      { key: "final_label", header: "Label", render: (r) => <RiskChip label={r.final_label} size="sm" short />, sortValue: (r) => RISK_SEVERITY[r.final_label] },
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
          <Button size="sm" onClick={() => setComposeFor([r])} icon={<Icons.Send size={13} />}>
            Send
          </Button>
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
        <Link to="/admin/tutorials" className="text-sm font-medium text-brand hover:underline self-start sm:self-auto inline-flex items-center gap-1">
          <Icons.Book size={15} /> Manage tutorials
        </Link>
      </div>

      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mb-3">
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
              minWidth={1020}
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
