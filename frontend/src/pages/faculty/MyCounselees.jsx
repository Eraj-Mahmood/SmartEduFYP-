import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import client from "../../api/client";
import { PortalShell } from "../../components/Shell";
import { Card, Drawer, Button, RiskChip, EmptyState, SkeletonCard, useToast, Icons, buttonClass, RISK_SEVERITY } from "../../components/ui";
import useApi from "../../lib/useApi";
import { timeAgo, pct, longDate } from "../../lib/format";

// Students an admin assigned to this faculty member as their academic counselor. A counselor
// sees this summary (label, reasons, next steps, tutorial, attendance) even when the student
// isn't in their class, and nothing more. /faculty/counselees?open=<id> opens one straight away.

const AUTOSAVE_MS = 800;

function NotesEditor({ counselee, onSaved }) {
  const [text, setText] = useState(counselee.notes || "");
  const [state, setState] = useState("idle"); // idle | dirty | saving | saved | error
  const saved = useRef(counselee.notes || "");

  const save = useCallback(
    async (value) => {
      setState("saving");
      try {
        const { data } = await client.put(`/faculty/counselees/${counselee.id}`, { notes: value });
        saved.current = value;
        setState("saved");
        onSaved(data);
      } catch {
        setState("error");
      }
    },
    [counselee.id, onSaved]
  );

  // autosave a moment after typing stops
  useEffect(() => {
    if (text === saved.current) return undefined;
    setState("dirty");
    const t = setTimeout(() => save(text), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [text, save]);

  const status = {
    idle: "",
    dirty: "Unsaved changes…",
    saving: "Saving…",
    saved: "Saved",
    error: "Couldn't save - check your connection",
  }[state];

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label htmlFor="counselee-notes" className="field-label mb-0">
          Notes
        </label>
        <span role="status" aria-live="polite" className={`text-xs inline-flex items-center gap-1 ${state === "error" ? "text-danger" : state === "saved" ? "text-safe-700" : "text-muted"}`}>
          {state === "saved" && <Icons.Check size={13} />}
          {status}
        </span>
      </div>
      <textarea
        id="counselee-notes"
        className="field"
        rows={5}
        maxLength={5000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== saved.current && save(text)}
        placeholder="Meetings, agreed actions, follow-ups. Only you and admins can see these."
      />
      {state === "error" && (
        <button type="button" onClick={() => save(text)} className="mt-1 text-xs font-medium text-brand hover:underline">
          Try again
        </button>
      )}
    </div>
  );
}

function CounseleeDrawer({ counselee, onClose, onChange, onClosed }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(null);
  const [confirmClose, setConfirmClose] = useState(false);
  useEffect(() => setConfirmClose(false), [counselee?.id]);

  async function contactedToday() {
    setBusy("contacted");
    try {
      const { data } = await client.put(`/faculty/counselees/${counselee.id}`, { last_contacted_at: new Date().toISOString() });
      onChange(data);
      toast(`Marked ${counselee.full_name} as contacted today`, { type: "success" });
    } catch (e) {
      toast(e.response?.data?.error || "Could not update", { type: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function closeAssignment() {
    setBusy("close");
    try {
      await client.put(`/faculty/counselees/${counselee.id}`, { close: true });
      toast(`Closed your counselling assignment with ${counselee.full_name}`, { type: "info" });
      onClosed(counselee);
    } catch (e) {
      toast(e.response?.data?.error || "Could not close the assignment", { type: "error" });
      setBusy(null);
    }
  }

  const c = counselee;
  return (
    <Drawer
      open={Boolean(c)}
      onClose={onClose}
      width="sm:max-w-lg"
      title={c?.full_name}
      subtitle={c && `${c.roll_no} · ${c.department} · counselee since ${longDate(c.assigned_at)}`}
      footer={
        c &&
        (confirmClose ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-ink">Close this assignment? {c.full_name} will no longer see you as their counselor.</span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setConfirmClose(false)}>
                Keep
              </Button>
              <Button size="sm" variant="danger" loading={busy === "close"} onClick={closeAssignment}>
                Close assignment
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="ghost" onClick={() => setConfirmClose(true)}>
              Close assignment
            </Button>
            <Button onClick={contactedToday} loading={busy === "contacted"} icon={<Icons.Check size={16} />}>
              Mark contacted today
            </Button>
          </div>
        ))
      }
    >
      {c && (
        <div className="space-y-6">
          <section>
            <div className="flex flex-wrap items-center gap-2">
              {c.final_label ? <RiskChip label={c.final_label} /> : <span className="text-sm text-muted">No prediction yet</span>}
              <span className="text-xs text-muted">
                Last contacted: <strong className="text-ink">{c.last_contacted_at ? timeAgo(c.last_contacted_at) : "not yet"}</strong>
              </span>
            </div>
            {c.reasons.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {c.reasons.map((r) => (
                  <li key={r} className="flex gap-2 text-sm text-ink/90">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-ink/40 shrink-0" aria-hidden="true" />
                    {r}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-sm text-muted">
              Attendance this term: <strong className="text-ink">{c.attendance ? `${pct(c.attendance.pct, 1)} (${c.attendance.present} of ${c.attendance.sessions})` : "not marked yet"}</strong> ·{" "}
              <a className="text-brand hover:underline" href={`mailto:${c.email}`}>
                {c.email}
              </a>
            </p>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-ink mb-2">Their next steps</h3>
            {c.next_steps.length ? (
              <ol className="space-y-2">
                {c.next_steps.map((s, i) => (
                  <li key={s.id} className="flex gap-2 text-sm leading-snug text-ink/90">
                    <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-ink/[0.07] text-[11px] font-semibold flex items-center justify-center" aria-hidden="true">
                      {i + 1}
                    </span>
                    {s.text}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted">No steps - not enough of this term's data yet.</p>
            )}
            <p className="mt-2 text-xs text-muted">The student sees the same steps on their dashboard, addressed to them.</p>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-ink mb-2">Recommended tutorial</h3>
            {c.tutorial?.has_tutorial ? (
              <div className="rounded-lg border border-line bg-surface p-3">
                <p className="text-xs font-mono text-muted">{c.tutorial.course_code} · {c.tutorial.course_title}</p>
                <p className="text-sm font-medium text-ink mt-0.5">{c.tutorial.title}</p>
                <p className="text-xs text-muted mt-1">{c.tutorial.reason}.</p>
                <a href={c.tutorial.url} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm", "mt-2")}>
                  <Icons.External size={14} /> Open tutorial
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </div>
            ) : c.tutorial ? (
              <p className="text-sm text-muted">{c.tutorial.course_code} needs work, but it has no tutorial yet.</p>
            ) : (
              <p className="text-sm text-muted">None needed right now.</p>
            )}
          </section>

          <NotesEditor key={c.id} counselee={c} onSaved={onChange} />
        </div>
      )}
    </Drawer>
  );
}

export default function MyCounselees() {
  const { data, error, loading, reload, setData } = useApi("/faculty/counselees");
  const [params, setParams] = useSearchParams();
  const [openId, setOpenId] = useState(params.get("open") ? Number(params.get("open")) : null);
  const rows = [...(data || [])].sort(
    (a, b) => (RISK_SEVERITY[b.final_label] ?? -1) - (RISK_SEVERITY[a.final_label] ?? -1) || String(a.last_contacted_at || "").localeCompare(String(b.last_contacted_at || ""))
  );
  const open = rows.find((r) => r.id === openId) || null;

  const openRow = (r) => {
    setOpenId(r.id);
    setParams({ open: r.id }, { replace: true });
  };
  const closeDrawer = useCallback(() => {
    setOpenId(null);
    setParams({}, { replace: true });
  }, [setParams]);
  const replace = useCallback((u) => setData((d) => (d || []).map((r) => (r.id === u.id ? u : r))), [setData]);

  return (
    <PortalShell>
      <h1 className="font-display text-2xl sm:text-[28px] mb-1">My counselees</h1>
      <p className="text-muted text-sm mb-5 max-w-2xl">
        Students you counsel. You can see their status, next steps and recommended tutorial here, even if they aren't in your classes.
      </p>

      {loading && !data ? (
        <div className="grid gap-4 md:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : error ? (
        <Card>
          <EmptyState icon={<Icons.AlertOctagon size={22} />} message="We couldn't load your counselees" detail={error} action={<Button variant="secondary" onClick={() => reload()}>Try again</Button>} />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={<Icons.Users size={22} />} message="No counselees yet" detail="When an admin assigns you as a student's counselor, they'll appear here and you'll get a notification." />
        </Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => openRow(r)}
                className="w-full text-left bg-surface rounded-card border border-line shadow-card px-5 py-4 hover:border-brand/50 hover:shadow-pop transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink truncate">{r.full_name}</p>
                    <p className="font-mono text-xs text-muted">
                      {r.roll_no} · {r.department}
                    </p>
                  </div>
                  {r.final_label && <RiskChip label={r.final_label} size="sm" short />}
                </div>
                {r.reasons[0] && <p className="mt-2 text-sm text-muted line-clamp-2">{r.reasons[0]}</p>}
                <p className={`mt-3 text-xs inline-flex items-center gap-1 ${r.last_contacted_at ? "text-muted" : "text-risk-700"}`}>
                  <Icons.Clock size={13} />
                  {r.last_contacted_at ? `Contacted ${timeAgo(r.last_contacted_at)}` : "Not contacted yet"}
                  {r.notes && <span className="ml-2 inline-flex items-center gap-1 text-muted"><Icons.Book size={12} /> notes</span>}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      <CounseleeDrawer
        counselee={open}
        onClose={closeDrawer}
        onChange={replace}
        onClosed={(c) => {
          setData((d) => (d || []).filter((r) => r.id !== c.id));
          closeDrawer();
        }}
      />
    </PortalShell>
  );
}
