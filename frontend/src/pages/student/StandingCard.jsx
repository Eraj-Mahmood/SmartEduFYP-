import { useState } from "react";
import client from "../../api/client";
import { Card, Button, Icons, StandingChip, useToast, Skeleton } from "../../components/ui";
import useApi from "../../lib/useApi";
import { pkDateTime } from "../../lib/format";

// "Academic standing (BU rules)" on the student dashboard (Phase 7). A rule outcome under the BU Student
// Handbook, shown next to - and never mixed with - the Random Forest risk prediction. Own data only
// (GET /api/student/standing uses the JWT).

const two = (v) => Number(v).toFixed(2);

function sentence(s) {
  const min = two(s.minimum);
  const when = s.term ? `at the end of ${s.term}` : "after your last completed semester";
  switch (s.status) {
    case "good":
      return `Your CGPA ${when} was ${two(s.cgpa_used)}, at or above the ${min} minimum for your programme.`;
    case "probation_1":
    case "probation_2":
      return `Your CGPA ${when} was ${two(s.cgpa_used)}, below the ${min} minimum. Raise it to ${min} or more this semester to come off probation.`;
    case "dropped":
      return `Your CGPA stayed below ${min} in the semester after two consecutive probations, so under Handbook 5.5.3 you have been dropped from the programme. Please contact your department.`;
    default:
      return `Your standing is first decided at the end of your first semester, on your GPA (minimum ${min}).`;
  }
}

function Target({ t, minimum }) {
  // no marks this term (e.g. right after a semester close: the closed term's classes are completed)
  if (!t) return <p className="text-sm text-muted">This term: no marks entered yet - the average you need will appear here once your teachers enter marks.</p>;
  const min = two(minimum);
  if (t.on_track) {
    return (
      <p className="text-sm text-safe-700 inline-flex items-start gap-1.5">
        <Icons.CheckCircle size={15} className="mt-0.5 shrink-0" /> With today's marks your {t.uses} would be {two(t.current)} - above {min}. Keep it up.
      </p>
    );
  }
  return (
    <div className="rounded-lg bg-brand-50 px-3 py-2 text-sm">
      <p className="font-medium text-brand-dark">This term</p>
      <p className="text-ink">
        {t.reachable ? (
          <>
            An average of about <strong>{t.needed_mark} ({t.needed_grade})</strong> in every course would bring your {t.uses} to {min}. Your average now is {Math.round(t.current_mean)}.
          </>
        ) : (
          <>Reaching {min} this term isn't possible with marks alone - talk to your counsellor about a plan.</>
        )}
      </p>
    </div>
  );
}

function Letter({ l, onAck }) {
  const [open, setOpen] = useState(!l.acknowledged_at);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  async function ack() {
    setSaving(true);
    try {
      const { data } = await client.put(`/student/warning-letters/${l.id}/acknowledge`);
      toast("Thank you - your acknowledgement has been recorded.", { type: "success", title: "Letter acknowledged" });
      onAck(data);
    } catch (e) {
      toast(e.response?.data?.error || "Could not record your acknowledgement", { type: "error" });
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className={`rounded-xl border p-4 ${l.acknowledged_at ? "border-line bg-surface" : "border-risk/40 bg-risk-50/60"}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3 text-left" aria-expanded={open}>
        <span>
          <span className="block font-medium text-ink">{l.title}</span>
          <span className="block text-xs text-muted">
            {l.term} · issued {l.date}
          </span>
        </span>
        <span className="shrink-0 text-xs font-medium inline-flex items-center gap-1">
          {l.acknowledged_at ? (
            <span className="text-safe-700 inline-flex items-center gap-1">
              <Icons.Check size={13} /> Acknowledged
            </span>
          ) : (
            <span className="text-risk-700">Needs your acknowledgement</span>
          )}
          <Icons.ChevronDown size={14} className={`text-muted transition ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-2 text-sm text-ink/90">
          <p>Dear {l.student.name} ({l.student.roll_no}),</p>
          <p>{l.body}</p>
          <ul className="list-disc pl-5 space-y-1">
            {l.next_steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <p className="text-muted">- {l.signature}</p>
          {l.acknowledged_at ? (
            <p className="text-xs text-muted">{l.acknowledged_text}</p>
          ) : (
            <Button onClick={ack} loading={saving} icon={<Icons.Check size={15} />} className="mt-1">
              I acknowledge this letter
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export default function StandingCard() {
  const { data, error, loading, setData } = useApi("/student/standing");
  if (error) return null; // the dashboard still works without it
  return (
    <Card as="section" title="Academic standing (BU rules)" subtitle="From the BU Student Handbook, clause 5.5 - separate from your risk prediction" className="scroll-mt-28" bodyClassName="space-y-3">
      <div id="standing" className="scroll-mt-28" />
      {loading || !data ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <StandingChip status={data.status} size="md" />
            {(data.status === "probation_1" || data.status === "probation_2") && (
              <span className="text-xs text-muted">{data.probations_before_drop} probations in a row is the limit</span>
            )}
          </div>
          <p className="text-[15px] text-ink/90 leading-snug">{sentence(data)}</p>
          {data.status !== "dropped" && <Target t={data.this_term} minimum={data.minimum} />}
          {data.hold.active && (
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-50 px-3 py-2 text-sm text-danger-700">
              <Icons.Lock size={15} className="mt-0.5 shrink-0" />
              Enrolment hold: on your second probation you can't register for a new course or semester without the Principal's prior approval, through the HoD (Handbook 5.5.5).
            </p>
          )}
          {data.hold.approved && (
            <p className="text-sm text-safe-700 inline-flex items-center gap-1.5">
              <Icons.CheckCircle size={15} /> Enrolment approved ({data.hold.approver_role}).
            </p>
          )}
          {data.letters.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-ink">Warning letters</h3>
              {data.letters.map((l) => (
                <Letter key={l.id} l={l} onAck={(nl) => setData({ ...data, letters: data.letters.map((x) => (x.id === nl.id ? nl : x)) })} />
              ))}
            </div>
          )}
          {data.history.length > 1 && (
            <p className="text-xs text-muted">
              Earlier: {data.history.slice(1, 4).map((h) => `${h.label}${h.term_label ? ` (${h.term_label})` : ""}`).join(" · ")}
              {data.history[0] ? ` · updated ${pkDateTime(data.history[0].created_at)}` : ""}
            </p>
          )}
        </>
      )}
    </Card>
  );
}
