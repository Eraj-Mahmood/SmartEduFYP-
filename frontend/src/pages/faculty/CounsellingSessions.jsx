import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PortalShell } from "../../components/Shell";
import { StandingChip, Card, DataTable, RiskChip, Button, EmptyState, Icons, SessionStatusChip, Tabs } from "../../components/ui";
import useApi from "../../lib/useApi";
import useWide from "../../lib/useWide";
import { pkDate, pkTime } from "../../lib/format";
import { AttendanceModal } from "../admin/CounsellingModals";

// Faculty "Counselling" page (Phase 7): the counsellor's own sessions. Upcoming = not marked and not
// cancelled, with "Awaiting attendance" (ended, not marked) first as a to-do; History = marked or
// cancelled. Present / Absent open once the session has started; a mark can be corrected later.
// Notes are private (never shown to the student). Below 768 px the table has two columns.

const TABS = [
  { key: "upcoming", label: "Upcoming" },
  { key: "history", label: "History" },
];

const shorten = (s, n = 60) => (!s ? "" : s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const isLink = (s) => /^https?:\/\//i.test(s || "");
const started = (s) => new Date(s.scheduled_at).getTime() <= Date.now();

function Place({ s }) {
  if (s.mode !== "online") return <span>{s.location}</span>;
  return isLink(s.location) ? (
    <a href={s.location} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
      <Icons.External size={13} /> Online meeting
    </a>
  ) : (
    <span>Online: {s.location}</span>
  );
}

function Actions({ s, onMark }) {
  if (s.status === "cancelled") return null;
  if (s.attendance) {
    return (
      <Button size="sm" variant="ghost" onClick={() => onMark(s)}>
        Correct
      </Button>
    );
  }
  if (!started(s)) return <span className="text-xs text-muted whitespace-nowrap">Opens at {pkTime(s.scheduled_at)}</span>;
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <Button size="sm" onClick={() => onMark(s, "present")} icon={<Icons.CheckCircle size={13} />}>
        Present
      </Button>
      <Button size="sm" variant="secondary" onClick={() => onMark(s, "absent")}>
        Absent
      </Button>
    </div>
  );
}

export default function CounsellingSessions() {
  const wide = useWide(768);
  const [view, setView] = useState("upcoming");
  const list = useApi("/faculty/counselling-sessions", { params: { view } });
  const [mark, setMark] = useState(null); // {session, preset}

  // to-do first: sessions awaiting attendance, then the upcoming ones (soonest first, as the API sends them)
  const rows = useMemo(() => {
    const s = list.data?.sessions || [];
    if (view !== "upcoming") return s;
    // to-do first, then students on probation (Probation 2 before 1), then the rest; soonest first within each
    const rank = (x) => (x.display_status === "awaiting_attendance" ? 0 : x.academic_status === "probation_2" ? 1 : x.academic_status === "probation_1" ? 2 : 3);
    return [...s].sort((a, b) => rank(a) - rank(b) || new Date(a.scheduled_at) - new Date(b.scheduled_at));
  }, [list.data, view]);
  const awaiting = view === "upcoming" ? rows.filter((s) => s.display_status === "awaiting_attendance").length : 0;
  const onMark = (session, preset) => setMark({ session, preset });

  const columns = useMemo(() => {
    if (!wide) {
      return [
        {
          key: "session",
          header: "Session",
          sortable: false,
          render: (s) => (
            <span className="block min-w-0">
              <span className="block font-medium">{pkDate(s.scheduled_at)}</span>
              <span className="block text-xs text-muted">
                {pkTime(s.scheduled_at)} · {s.duration_min} min
              </span>
              <span className="block mt-1 truncate">{s.student_name}</span>
              <span className="block font-mono text-xs text-muted">{s.roll_no}</span>
              <span className="block text-xs text-muted mt-0.5 truncate">
                <Place s={s} />
              </span>
              {s.counsellor_notes && <span className="block text-xs text-muted mt-1 line-clamp-2">Notes: {s.counsellor_notes}</span>}
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
              {s.final_label && <RiskChip label={s.final_label} size="sm" short />}
              {s.academic_status && s.academic_status !== "good" && <StandingChip status={s.academic_status} short />}
              <Actions s={s} onMark={onMark} />
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
      {
        key: "student",
        header: "Student",
        sortable: false,
        render: (s) => (
          <span className="inline-flex flex-col items-start gap-1">
            <span className="font-medium">{s.student_name}</span>
            {s.academic_status && s.academic_status !== "good" && <StandingChip status={s.academic_status} short />}
          </span>
        ),
      },
      { key: "roll", header: "Roll no", sortable: false, render: (s) => <span className="font-mono text-xs whitespace-nowrap">{s.roll_no}</span> },
      { key: "risk", header: "Risk label", sortable: false, render: (s) => (s.final_label ? <RiskChip label={s.final_label} size="sm" short /> : "—") },
      { key: "location", header: "Location", sortable: false, render: (s) => <Place s={s} /> },
      {
        key: "status",
        header: "Status",
        sortable: false,
        render: (s) => (
          <span className="inline-flex flex-col items-start gap-1">
            <SessionStatusChip status={s.display_status} />
            {s.cancelled_reason && <span className="text-xs text-muted max-w-[160px]">{shorten(s.cancelled_reason, 50)}</span>}
          </span>
        ),
      },
      {
        key: "notes",
        header: "Notes",
        sortable: false,
        render: (s) => (
          <span className="block max-w-[180px] text-xs text-muted leading-snug" title={s.counsellor_notes || s.agenda || ""}>
            {s.counsellor_notes ? shorten(s.counsellor_notes) : s.agenda ? `Agenda: ${shorten(s.agenda, 50)}` : "—"}
          </span>
        ),
      },
      { key: "actions", header: "", sortable: false, align: "right", render: (s) => <Actions s={s} onMark={onMark} /> },
    ];
  }, [wide]);

  return (
    <PortalShell>
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl sm:text-[28px] mb-1">Counselling sessions</h1>
          <p className="text-muted text-sm max-w-2xl">
            Sessions the admin booked with your counselees. Mark Present or Absent once a session has started; your notes are never shown to the student. Times are Pakistan
            time.
          </p>
        </div>
        <Link to="/faculty/counselees" className="self-start sm:self-auto shrink-0 text-sm font-medium text-brand hover:underline inline-flex items-center gap-1">
          <Icons.Users size={15} /> My counselees <Icons.ChevronRight size={14} />
        </Link>
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <Tabs tabs={TABS} value={view} onChange={setView} label="Sessions" />
          {awaiting > 0 && (
            <p className="inline-flex items-center gap-1.5 text-sm font-medium text-risk-700" role="status">
              <Icons.Warning size={15} /> {awaiting} session{awaiting === 1 ? "" : "s"} awaiting your attendance mark
            </p>
          )}
        </div>
        {list.error ? (
          <EmptyState
            icon={<Icons.AlertOctagon size={22} />}
            message="We couldn't load your sessions"
            detail={list.error}
            action={
              <Button variant="secondary" onClick={() => list.reload()}>
                Try again
              </Button>
            }
          />
        ) : (
          <DataTable
            loading={list.loading && !list.data}
            rows={rows}
            rowKey={(s) => s.session_id}
            minWidth={wide ? 940 : 0}
            rowClassName={(s) => (s.display_status === "awaiting_attendance" ? "bg-risk-50/50" : "")}
            emptyMessage={view === "upcoming" ? "No upcoming sessions" : "No past sessions yet"}
            emptyDetail={view === "upcoming" ? "Sessions the admin books with your counselees will appear here." : "Sessions appear here once attendance is marked or they are cancelled."}
            columns={columns}
          />
        )}
      </Card>

      <AttendanceModal
        session={mark?.session || null}
        preset={mark?.preset}
        endpoint="/faculty/counselling-sessions"
        onClose={() => setMark(null)}
        onSaved={() => {
          setMark(null);
          list.reload({ quiet: true });
        }}
      />
    </PortalShell>
  );
}
