import { useEffect, useState } from "react";
import client from "../../api/client";
import { Modal, Button, RiskChip, EmptyState, Skeleton, useToast, Icons } from "../../components/ui";
import useApi from "../../lib/useApi";
import { timeAgo } from "../../lib/format";

// The two dialogs of the Interventions workflow: assigning a counselor, and writing an
// intervention message (to one student or to many) with a live preview of one filled-in copy.

/** Pick a faculty member as the student's counselor; their own department first, with workloads. */
export function AssignCounselorModal({ student, onClose, onAssigned }) {
  const { toast } = useToast();
  const open = Boolean(student);
  const workload = useApi(open ? "/admin/faculty/workload" : null, { params: { department: student?.department_id } });
  const [choice, setChoice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const current = student?.counselor;

  useEffect(() => {
    setChoice(null);
    setConfirmClose(false);
  }, [student]);

  async function closeCurrent() {
    if (!confirmClose) {
      setConfirmClose(true);
      return;
    }
    setClosing(true);
    try {
      await client.put(`/admin/counselors/${current.assignment_id}/close`);
      toast(`Closed ${current.name}'s assignment with ${student.full_name}`, { type: "info" });
      onAssigned(null);
    } catch (e) {
      toast(e.response?.data?.error || "Could not close the assignment", { type: "error" });
    } finally {
      setClosing(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const { data } = await client.post("/admin/counselors", { studentId: student.student_id, facultyId: choice });
      toast(`${data.faculty_name} is now ${student.full_name}'s counselor. Both have been notified.`, { type: "success", title: "Counselor assigned" });
      onAssigned(data);
    } catch (e) {
      toast(e.response?.data?.error || "Could not assign the counselor", { type: "error" });
    } finally {
      setSaving(false);
    }
  }

  const rows = workload.data || [];
  const same = rows.filter((f) => f.department_id === student?.department_id);
  const others = rows.filter((f) => f.department_id !== student?.department_id);

  const option = (f) => {
    const isCurrent = current && current.faculty_id === f.faculty_id;
    return (
      <label
        key={f.faculty_id}
        className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition ${
          choice === f.faculty_id ? "border-brand bg-brand-50" : "border-line bg-surface hover:bg-ink/[0.03]"
        } ${isCurrent ? "opacity-60 cursor-not-allowed" : ""}`}
      >
        <input
          type="radio"
          name="counselor"
          className="accent-brand"
          value={f.faculty_id}
          checked={choice === f.faculty_id}
          disabled={isCurrent}
          onChange={() => setChoice(f.faculty_id)}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-ink truncate">
            {f.full_name}
            {isCurrent && <span className="ml-2 text-xs font-normal text-muted">(current)</span>}
          </span>
          <span className="block text-xs text-muted truncate">
            {f.designation || "Faculty"} · {f.department_code}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block font-mono text-sm text-ink">{f.active_counselees}</span>
          <span className="block text-[11px] text-muted">counselee{f.active_counselees === 1 ? "" : "s"}</span>
        </span>
      </label>
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Assign counselor"
      subtitle={student && `${student.full_name} · ${student.roll_no} · ${student.department_code}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving} disabled={!choice} icon={<Icons.UserCheck size={16} />}>
            Assign
          </Button>
        </>
      }
    >
      {student && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <RiskChip label={student.final_label} size="sm" />
            {student.reasons?.[0] && <span className="text-muted">{student.reasons[0]}</span>}
          </div>
          {current && (
            <div className="rounded-lg bg-risk-50 border border-risk/30 px-3 py-2 text-sm text-ink">
              <p>
                Currently with <strong>{current.name}</strong> (since {timeAgo(current.assigned_at)}). Choosing someone else closes that assignment.
              </p>
              <Button size="sm" variant={confirmClose ? "danger" : "ghost"} className="mt-1 -ml-2" loading={closing} onClick={closeCurrent}>
                {confirmClose ? "Confirm: close without a new counselor" : "Close assignment"}
              </Button>
            </div>
          )}
          {workload.loading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : workload.error ? (
            <EmptyState message="Couldn't load the faculty list" detail={workload.error} compact />
          ) : (
            <>
              <fieldset className="space-y-2">
                <legend className="text-xs font-mono uppercase tracking-wider text-muted mb-2">{student.department} faculty</legend>
                {same.length ? same.map(option) : <p className="text-sm text-muted">No active faculty in this department.</p>}
              </fieldset>
              {others.length > 0 && (
                <fieldset className="space-y-2">
                  <legend className="text-xs font-mono uppercase tracking-wider text-muted mb-2">Other departments</legend>
                  {others.map(option)}
                </fieldset>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

const PLACEHOLDERS = [
  ["{name}", "Student's name"],
  ["{course}", "Course that needs most work"],
  ["{counselor}", "Their counselor"],
];

/**
 * Write one intervention for `targets` (rows from the at-risk list). One target -> POST
 * /admin/notifications; several -> POST /admin/notifications/bulk. Shows one filled-in copy.
 */
export function ComposeModal({ targets, onClose, onSent }) {
  const { toast } = useToast();
  const open = targets.length > 0;
  const [form, setForm] = useState({
    subject: "Let's plan your next steps, {name}",
    message:
      "Hi {name}, your recent results show {course} needs some extra attention. Please meet {counselor} this week - they can help you plan.",
    includeTutorial: true,
  });
  const [preview, setPreview] = useState({ loading: false, data: null, error: null });
  const [sending, setSending] = useState(false);
  const first = targets[0];

  // live preview of the first student's copy (debounced)
  useEffect(() => {
    if (!open || !form.subject.trim() || !form.message.trim()) {
      setPreview({ loading: false, data: null, error: null });
      return undefined;
    }
    setPreview((p) => ({ ...p, loading: true }));
    const t = setTimeout(() => {
      client
        .post("/admin/notifications/preview", { studentId: first.student_id, ...form })
        .then(({ data }) => setPreview({ loading: false, data, error: null }))
        .catch((e) => setPreview({ loading: false, data: null, error: e.response?.data?.error || "Preview unavailable" }));
    }, 400);
    return () => clearTimeout(t);
  }, [open, first, form]);

  function insert(token) {
    setForm((f) => ({ ...f, message: `${f.message}${f.message.endsWith(" ") || !f.message ? "" : " "}${token}` }));
  }

  async function send() {
    setSending(true);
    try {
      let sent;
      let unknown;
      if (targets.length === 1) {
        const { data } = await client.post("/admin/notifications", { recipient_user_id: first.user_id, ...form });
        sent = 1;
        unknown = data.unknownPlaceholders;
      } else {
        const { data } = await client.post("/admin/notifications/bulk", { studentIds: targets.map((t) => t.student_id), ...form });
        sent = data.sent;
        unknown = data.unknownPlaceholders;
      }
      toast(
        `${sent === 1 ? `Sent to ${first.full_name}` : `Sent to ${sent} students`}${unknown?.length ? `. Left as typed: ${unknown.join(", ")}` : ""}`,
        { type: unknown?.length ? "warning" : "success", title: "Intervention sent" }
      );
      onSent(targets);
    } catch (e) {
      toast(e.response?.data?.error || "Could not send the intervention", { type: "error" });
    } finally {
      setSending(false);
    }
  }

  const ready = form.subject.trim() && form.message.trim();
  return (
    <Modal
      open={open}
      onClose={onClose}
      width="sm:max-w-2xl"
      title={targets.length === 1 ? "Send intervention" : `Send intervention to ${targets.length} students`}
      subtitle={targets.length === 1 ? `${first.full_name} · ${first.roll_no}` : "Each student gets their own copy with their own name, course and tutorial."}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={send} loading={sending} disabled={!ready} icon={<Icons.Send size={15} />}>
            {targets.length === 1 ? "Send" : `Send ${targets.length}`}
          </Button>
        </>
      }
    >
      {open && (
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-3">
            <label className="block">
              <span className="field-label">Subject</span>
              <input className="field" maxLength={200} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            </label>
            <label className="block">
              <span className="field-label">Message</span>
              <textarea className="field" rows={6} maxLength={4000} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
            </label>
            <div>
              <p className="text-xs text-muted mb-1.5">Insert a placeholder (filled in for each student):</p>
              <div className="flex flex-wrap gap-1.5">
                {PLACEHOLDERS.map(([token, hint]) => (
                  <button
                    key={token}
                    type="button"
                    title={hint}
                    onClick={() => insert(token)}
                    className="rounded-full border border-line bg-surface px-2.5 py-1 font-mono text-xs text-brand hover:bg-brand-50"
                  >
                    {token}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 accent-brand"
                checked={form.includeTutorial}
                onChange={(e) => setForm({ ...form, includeTutorial: e.target.checked })}
              />
              <span>
                Add each student's recommended tutorial
                <span className="block text-xs text-muted">One line with the title and link, for their weakest course.</span>
              </span>
            </label>
          </div>

          <div>
            <p className="text-xs font-mono uppercase tracking-wider text-muted mb-2">Preview · {first.full_name}</p>
            <div className="rounded-xl border border-line bg-surface p-4 min-h-[180px]" aria-live="polite">
              {preview.loading && !preview.data ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-5/6" />
                </div>
              ) : preview.error ? (
                <p className="text-sm text-danger">{preview.error}</p>
              ) : preview.data ? (
                <>
                  <p className="text-sm font-semibold text-ink">{preview.data.subject}</p>
                  <p className="mt-2 text-sm text-ink/90 whitespace-pre-line break-words">{preview.data.message}</p>
                </>
              ) : (
                <p className="text-sm text-muted">Write a subject and message to see a preview.</p>
              )}
            </div>
            {preview.data?.unknownPlaceholders?.length > 0 && (
              <p className="mt-2 text-xs text-risk-700">
                Not a placeholder, will be sent as typed: {preview.data.unknownPlaceholders.join(", ")}
              </p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
