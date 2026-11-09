import { PortalShell } from "../../components/Shell";
import { Card, DataTable, EmptyState, SkeletonCard, Button, Icons, SessionStatusChip, buttonClass } from "../../components/ui";
import useApi from "../../lib/useApi";
import useWide from "../../lib/useWide";
import { pkDate, pkTime, pkDateTime } from "../../lib/format";

// Student "Counselling" page (Phase 7): the next session, "Attended X of Y" and every session with its
// status. Only the student's own sessions; the API never sends the counsellor's private notes.
// Below 768 px the history is a list of cards (no sideways scrolling).

const isLink = (s) => /^https?:\/\//i.test(s || "");
const placeText = (s) => (s.mode === "online" ? (isLink(s.location) ? "Online meeting" : `Online: ${s.location}`) : s.location);

function NextSessionCard({ s }) {
  if (!s) {
    return (
      <Card title="Next session">
        <p className="text-sm text-muted">No session is booked right now. If you'd like one, contact your counsellor - sessions are booked by the admin office.</p>
      </Card>
    );
  }
  return (
    <Card title="Next session" subtitle="Please be on time. If you can't make it, tell your counsellor beforehand.">
      <div className="flex items-start gap-3">
        <span className="h-11 w-11 shrink-0 rounded-full bg-brand-50 text-brand flex items-center justify-center" aria-hidden="true">
          <Icons.Calendar size={20} />
        </span>
        <div className="min-w-0">
          <p className="font-display text-lg leading-snug text-ink">{pkDateTime(s.scheduled_at)}</p>
          <p className="text-sm text-muted">
            {s.duration_min} minutes with {s.counsellor_name}
          </p>
          <p className="text-sm text-ink mt-1">{s.mode === "online" ? "Online" : s.location}</p>
          {s.agenda && <p className="text-sm text-muted mt-1">Agenda: {s.agenda}</p>}
          {s.mode === "online" && isLink(s.location) && (
            <a href={s.location} target="_blank" rel="noopener noreferrer" className={buttonClass("primary", "sm", "mt-3")}>
              <Icons.External size={14} /> Open meeting link
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </div>
      </div>
    </Card>
  );
}

function SessionCard({ s }) {
  return (
    <li className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-ink">{pkDate(s.scheduled_at)}</p>
          <p className="text-sm text-muted">
            {pkTime(s.scheduled_at)} · {s.duration_min} min
          </p>
        </div>
        <SessionStatusChip status={s.display_status} />
      </div>
      <p className="text-sm text-ink mt-2">{s.counsellor_name}</p>
      <p className="text-sm text-muted break-words">{placeText(s)}</p>
      {s.cancelled_reason && <p className="text-xs text-muted mt-1">Reason: {s.cancelled_reason}</p>}
    </li>
  );
}

const COLUMNS = [
  {
    key: "when",
    header: "Date and time",
    sortable: false,
    render: (s) => (
      <span className="whitespace-nowrap">
        {pkDate(s.scheduled_at)}
        <span className="block text-xs text-muted">
          {pkTime(s.scheduled_at)} · {s.duration_min} min
        </span>
      </span>
    ),
  },
  { key: "counsellor", header: "Counsellor", sortable: false, render: (s) => s.counsellor_name },
  {
    key: "place",
    header: "Mode / location",
    sortable: false,
    render: (s) =>
      s.mode === "online" && isLink(s.location) ? (
        <a href={s.location} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
          <Icons.External size={13} /> Online meeting
        </a>
      ) : (
        placeText(s)
      ),
  },
  {
    key: "status",
    header: "Status",
    sortable: false,
    render: (s) => (
      <span className="inline-flex flex-col items-start gap-1">
        <SessionStatusChip status={s.display_status} />
        {s.cancelled_reason && <span className="text-xs text-muted">Reason: {s.cancelled_reason}</span>}
      </span>
    ),
  },
];

export default function StudentCounselling() {
  const wide = useWide(768);
  const { data, error, loading, reload } = useApi("/student/counselling-sessions");
  const sessions = data?.sessions || [];
  const sum = data?.summary;

  return (
    <PortalShell>
      <h1 className="font-display text-2xl sm:text-[28px] mb-1">My counselling sessions</h1>
      <p className="text-sm text-muted mb-5">Meetings with your counsellor. Times are Pakistan time.</p>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <SkeletonCard height="h-24" />
          <SkeletonCard height="h-24" />
        </div>
      ) : error ? (
        <Card>
          <EmptyState
            icon={<Icons.AlertOctagon size={22} />}
            message="We couldn't load your sessions"
            detail={error}
            action={
              <Button variant="secondary" onClick={() => reload()}>
                Try again
              </Button>
            }
          />
        </Card>
      ) : sessions.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Icons.Calendar size={22} />}
            message="No counselling sessions yet"
            detail="When a session is booked for you, it appears here and in your notifications."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[1.6fr_1fr]">
            <NextSessionCard s={data.next} />
            <Card title="Attendance">
              <p className="font-display text-[32px] leading-none tabular-nums">
                {sum.attended} <span className="text-lg text-muted">of {sum.marked}</span>
              </p>
              <p className="text-sm text-muted mt-2">
                {sum.marked ? `Attended ${sum.attended} of ${sum.marked} session${sum.marked === 1 ? "" : "s"} so far.` : "No session has been marked yet."}
              </p>
            </Card>
          </div>

          <Card title="All sessions" subtitle="Newest first">
            {wide ? (
              <DataTable rows={sessions} rowKey={(s) => s.session_id} minWidth={600} columns={COLUMNS} />
            ) : (
              <ul className="space-y-3">
                {sessions.map((s) => (
                  <SessionCard key={s.session_id} s={s} />
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </PortalShell>
  );
}
