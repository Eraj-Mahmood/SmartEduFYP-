import { useEffect, useMemo, useState } from "react";
import { PortalShell } from "../../components/Shell";
import { Card, DataTable, Pagination, RiskChip, Button, EmptyState, Icons, SessionStatusChip, SESSION_STATUSES } from "../../components/ui";
import useApi from "../../lib/useApi";
import useWide from "../../lib/useWide";
import { pkDate, pkTime } from "../../lib/format";
import { ScheduleSessionModal, CancelSessionModal, AttendanceModal } from "./CounsellingModals";

// Admin "Counselling" page (Phase 7): book sessions between a student and their counsellor and keep
// track of them. Status is computed by the API (Upcoming, Awaiting attendance, Present, Absent,
// Cancelled); nothing is marked absent automatically. Below 768 px the table has three columns.

const isLink = (s) => /^https?:\/\//i.test(s || "");

function Place({ s }) {
  if (s.mode === "online") {
    return (
      <span className="inline-flex items-center gap-1 text-sm">
        <Icons.External size={13} className="text-muted shrink-0" />
        {isLink(s.location) ? (
          <a href={s.location} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline truncate max-w-[160px]" title={s.location}>
            Online meeting
          </a>
        ) : (
          <span className="truncate max-w-[160px]" title={s.location}>
            Online: {s.location}
          </span>
        )}
      </span>
    );
  }
  return <span className="text-sm">{s.location}</span>;
}

/** Which actions a row offers: change it only while unmarked and not cancelled; mark once it has started. */
function actionsFor(s) {
  const open = s.status === "scheduled" && !s.attendance;
  const started = new Date(s.scheduled_at).getTime() <= Date.now();
  return { reschedule: open, cancel: open, mark: s.status === "scheduled" && started };
}

function RowActions({ s, onReschedule, onCancel, onMark }) {
  const a = actionsFor(s);
  if (!a.reschedule && !a.cancel && !a.mark) return <span className="text-xs text-muted">—</span>;
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {a.mark && (
        <Button size="sm" variant={s.attendance ? "ghost" : "primary"} onClick={() => onMark(s)} icon={<Icons.Check size={13} />}>
          {s.attendance ? "Correct" : "Mark"}
        </Button>
      )}
      {a.reschedule && (
        <Button size="sm" variant="secondary" onClick={() => onReschedule(s)}>
          Reschedule
        </Button>
      )}
      {a.cancel && (
        <Button size="sm" variant="ghost" onClick={() => onCancel(s)}>
          Cancel
        </Button>
      )}
    </div>
  );
}

export default function Counselling() {
  const wide = useWide(768);
  const faculty = useApi("/admin/faculty/workload");
  const [filters, setFilters] = useState({ counsellor: "", status: "", from: "", to: "", search: "" });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [scheduling, setScheduling] = useState(false);
  const [rescheduleFor, setRescheduleFor] = useState(null);
  const [cancelFor, setCancelFor] = useState(null);
  const [markFor, setMarkFor] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => ({ ...f, search: search.trim() })), 350);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(1), [filters]);

  const params = { ...filters, page, limit: 20 };
  Object.keys(params).forEach((k) => params[k] === "" && delete params[k]);
  const list = useApi("/admin/counselling-sessions", { params });
  const data = list.data || { rows: [], total: 0, page: 1, totalPages: 0 };
  const setFilter = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));
  const anyFilter = Object.values(filters).some(Boolean);
  const done = () => {
    setScheduling(false);
    setRescheduleFor(null);
    setCancelFor(null);
    setMarkFor(null);
    list.reload({ quiet: true });
    faculty.reload({ quiet: true });
  };

  const actions = { onReschedule: setRescheduleFor, onCancel: setCancelFor, onMark: setMarkFor };
  const columns = useMemo(() => {
    const student = {
      key: "student",
      header: "Student",
      sortable: false,
      render: (s) => (
        <span className="block min-w-0">
          <span className="block font-medium truncate">{s.student_name}</span>
          <span className="block font-mono text-xs text-muted">{s.roll_no}</span>
        </span>
      ),
    };
    const status = { key: "status", header: "Status", sortable: false, render: (s) => <SessionStatusChip status={s.display_status} /> };
    if (!wide) {
      return [
        {
          key: "when",
          header: "Session",
          sortable: false,
          render: (s) => (
            <span className="block min-w-0">
              <span className="block font-medium">{pkDate(s.scheduled_at)}</span>
              <span className="block text-xs text-muted">
                {pkTime(s.scheduled_at)} · {s.duration_min} min
              </span>
              <span className="block mt-1 truncate">{s.student_name}</span>
              <span className="block font-mono text-xs text-muted truncate">
                {s.roll_no} · {s.counsellor_name}
              </span>
            </span>
          ),
        },
        {
          key: "status",
          header: "Status",
          sortable: false,
          align: "right",
          render: (s) => (
            <span className="flex flex-col items-end gap-2">
              <SessionStatusChip status={s.display_status} />
              <RowActions s={s} {...actions} />
            </span>
          ),
        },
      ];
    }
    return [
      { key: "date", header: "Date", sortable: false, render: (s) => <span className="whitespace-nowrap">{pkDate(s.scheduled_at)}</span> },
      {
        key: "time",
        header: "Time",
        sortable: false,
        render: (s) => (
          <span className="whitespace-nowrap">
            {pkTime(s.scheduled_at)}
            <span className="block text-xs text-muted">{s.duration_min} min</span>
          </span>
        ),
      },
      student,
      { key: "risk", header: "Risk label", sortable: false, render: (s) => (s.final_label ? <RiskChip label={s.final_label} size="sm" short /> : <span className="text-muted">—</span>) },
      { key: "counsellor", header: "Counsellor", sortable: false, render: (s) => <span className="whitespace-nowrap">{s.counsellor_name}</span> },
      { key: "location", header: "Location", sortable: false, render: (s) => <Place s={s} /> },
      status,
      { key: "actions", header: "", sortable: false, align: "right", render: (s) => <RowActions s={s} {...actions} /> },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wide]);

  return (
    <PortalShell>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl sm:text-[28px] mb-1">Counselling</h1>
          <p className="text-muted text-sm max-w-2xl">
            Book sessions between students and their counsellor. The counsellor marks attendance after each session; times are Pakistan time.
          </p>
        </div>
        <Button onClick={() => setScheduling(true)} icon={<Icons.Plus size={16} />} className="self-start sm:self-auto">
          Schedule session
        </Button>
      </div>

      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end mb-4">
          <label className="block">
            <span className="sr-only">Search students</span>
            <span className="relative block">
              <Icons.Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input type="search" className="field pl-9" placeholder="Roll no or name" value={search} onChange={(e) => setSearch(e.target.value)} />
            </span>
          </label>
          <label>
            <span className="sr-only">Counsellor</span>
            <select className="field" value={filters.counsellor} onChange={setFilter("counsellor")}>
              <option value="">All counsellors</option>
              {(faculty.data || []).map((f) => (
                <option key={f.faculty_id} value={f.faculty_id}>
                  {f.full_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Status</span>
            <select className="field" value={filters.status} onChange={setFilter("status")}>
              <option value="">Every status</option>
              {SESSION_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="text-xs text-muted">From</span>
            <input type="date" className="field" value={filters.from} onChange={setFilter("from")} aria-label="From date" />
          </label>
          <label>
            <span className="text-xs text-muted">To</span>
            <input type="date" className="field" value={filters.to} min={filters.from || undefined} onChange={setFilter("to")} aria-label="To date" />
          </label>
        </div>

        {list.error ? (
          <EmptyState
            icon={<Icons.AlertOctagon size={22} />}
            message="We couldn't load the sessions"
            detail={list.error}
            action={
              <Button variant="secondary" onClick={() => list.reload()}>
                Try again
              </Button>
            }
          />
        ) : (
          <>
            <DataTable
              loading={list.loading && !list.data}
              rows={data.rows}
              rowKey={(s) => s.session_id}
              minWidth={wide ? 980 : 0}
              rowClassName={(s) => (s.display_status === "awaiting_attendance" ? "bg-risk-50/50" : "")}
              emptyMessage={anyFilter ? "No sessions match these filters" : "No counselling sessions yet"}
              emptyDetail={anyFilter ? undefined : "Use \"Schedule session\" to book the first one."}
              columns={columns}
            />
            <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} label={data.total === 1 ? "session" : "sessions"} />
          </>
        )}
      </Card>

      <ScheduleSessionModal open={scheduling} onClose={() => setScheduling(false)} onSaved={done} />
      <ScheduleSessionModal open={Boolean(rescheduleFor)} session={rescheduleFor} onClose={() => setRescheduleFor(null)} onSaved={done} />
      <CancelSessionModal session={cancelFor} onClose={() => setCancelFor(null)} onSaved={done} />
      <AttendanceModal session={markFor} onClose={() => setMarkFor(null)} onSaved={done} />
    </PortalShell>
  );
}
