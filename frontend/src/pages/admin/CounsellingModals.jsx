import { useEffect, useState } from "react";
import client from "../../api/client";
import { Modal, Button, RiskChip, Icons, useToast } from "../../components/ui";
import useApi from "../../lib/useApi";
import { pkDateTime, pkInputs, pkToIso, addDays } from "../../lib/format";

// Dialogs for counselling sessions (Phase 7): book or reschedule a session, cancel one, mark attendance.
// Dates and times are entered and shown in Pakistan time and sent with +05:00, so the browser's own
// time zone never shifts a session. The server re-checks every rule (overlaps, 60 days, counsellor).

const MAX_DAYS = 60;
const DURATIONS = [15, 30, 45, 60, 90, 120];
const errorOf = (e, fallback) => e.response?.data?.error || fallback;

function Field({ label, htmlFor, error, hint, children }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="field-label">
        {label}
      </label>
      {children}
      {error ? <p className="mt-1 text-xs text-danger-700">{error}</p> : hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function ErrorBox({ children }) {
  if (!children) return null;
  return (
    <div role="alert" className="rounded-lg border border-danger/30 bg-danger-50 px-3 py-2 text-sm text-danger-700 flex gap-2">
      <Icons.AlertOctagon size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/** Student search by roll no or name; picking one loads their counsellor and risk label. */
function StudentPicker({ value, onPick, disabled }) {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [loadingOne, setLoadingOne] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const results = useApi(term.length >= 2 && !value ? "/admin/students" : null, { params: { search: term, limit: 8 } });

  async function pick(s) {
    setLoadingOne(true);
    try {
      const { data } = await client.get(`/admin/students/${s.student_id}/full`);
      onPick({
        student_id: s.student_id,
        roll_no: s.roll_no,
        full_name: s.full_name,
        is_active: s.is_active,
        final_label: data.predictions?.[0]?.final_label || null,
        counselor: data.counselor ? { faculty_id: data.counselor.faculty_id, name: data.counselor.name } : null,
      });
      setQ("");
    } finally {
      setLoadingOne(false);
    }
  }

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink truncate">{value.full_name}</p>
          <p className="text-xs text-muted">
            <span className="font-mono">{value.roll_no}</span>
            {value.counselor ? ` · counsellor ${value.counselor.name}` : " · no counsellor yet"}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {value.final_label && <RiskChip label={value.final_label} size="sm" short />}
          {!disabled && (
            <button type="button" className="text-sm text-brand hover:underline" onClick={() => onPick(null)}>
              Change
            </button>
          )}
        </div>
      </div>
    );
  }
  const rows = results.data?.rows || [];
  return (
    <div>
      <div className="relative">
        <Icons.Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          id="cs-student"
          type="search"
          className="field pl-9"
          placeholder="Roll no or name, e.g. BU-100040"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
        />
      </div>
      {term.length >= 2 && (
        <ul className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-line bg-surface divide-y divide-line" aria-label="Matching students">
          {results.loading || loadingOne ? (
            <li className="px-3 py-2 text-sm text-muted">Searching…</li>
          ) : results.error ? (
            <li className="px-3 py-2 text-sm text-danger-700">{results.error}</li>
          ) : rows.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">No student matches "{term}"</li>
          ) : (
            rows.map((s) => (
              <li key={s.student_id}>
                <button type="button" onClick={() => pick(s)} className="w-full text-left px-3 py-2 hover:bg-brand-50 focus-visible:bg-brand-50 outline-none">
                  <span className="block text-sm text-ink">
                    {s.full_name}
                    {!s.is_active && <span className="ml-2 text-xs text-danger-700">(deactivated)</span>}
                  </span>
                  <span className="block font-mono text-xs text-muted">
                    {s.roll_no} · {s.department}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * Book a session (prefill: {student?, reason?, agenda?}) or reschedule one (session: a row from the list).
 * onSaved(session) after the server accepts it.
 */
export function ScheduleSessionModal({ open, prefill, session, onClose, onSaved }) {
  const { toast } = useToast();
  const editing = Boolean(session);
  const faculty = useApi(open && !editing ? "/admin/faculty/workload" : null);
  const [student, setStudent] = useState(null);
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [confirm, setConfirm] = useState(null); // the 409 COUNSELLOR_CHANGE answer
  const [saving, setSaving] = useState(false);
  const today = pkInputs().date;

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setServerError("");
    setConfirm(null);
    if (editing) {
      const at = pkInputs(session.scheduled_at);
      setStudent({ student_id: session.student_id, roll_no: session.roll_no, full_name: session.student_name, final_label: session.final_label, counselor: { faculty_id: session.faculty_id, name: session.counsellor_name } });
      setForm({ date: at.date, time: at.time, durationMin: session.duration_min, mode: session.mode, location: session.location, agenda: session.agenda || "", facultyId: session.faculty_id, reason: session.reason });
    } else {
      const s = prefill?.student || null;
      setStudent(s);
      setForm({ date: addDays(today, 1), time: "11:00", durationMin: 30, mode: "in_person", location: "", agenda: prefill?.agenda || "", facultyId: s?.counselor?.faculty_id || "", reason: prefill?.reason || "manual" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session, prefill]);

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((er) => ({ ...er, [k]: undefined }));
    setServerError("");
    setConfirm(null);
  };

  function pickStudent(s) {
    setStudent(s);
    setForm((f) => ({ ...f, facultyId: s?.counselor?.faculty_id || "" }));
    setErrors((er) => ({ ...er, student: undefined, facultyId: undefined }));
    setServerError("");
    setConfirm(null);
  }

  function validate() {
    const er = {};
    if (!student) er.student = "Choose a student";
    if (!form.facultyId) er.facultyId = "Choose a counsellor";
    if (!form.date) er.date = "Choose a date";
    if (!form.time) er.time = "Choose a time";
    if (form.date && form.time) {
      const t = new Date(pkToIso(form.date, form.time)).getTime();
      if (t <= Date.now()) er.time = "This time has already passed - choose a later one";
      else if (form.date > addDays(today, MAX_DAYS)) er.date = `Sessions can be booked at most ${MAX_DAYS} days ahead`;
    }
    if (!form.location?.trim()) er.location = form.mode === "online" ? "Add the meeting link" : "Add the room, e.g. Room 204";
    setErrors(er);
    return Object.keys(er).length === 0;
  }

  async function submit(reassign = false) {
    if (!validate()) return;
    setSaving(true);
    setServerError("");
    const body = {
      scheduledAt: pkToIso(form.date, form.time),
      durationMin: Number(form.durationMin),
      mode: form.mode,
      location: form.location.trim(),
      agenda: form.agenda?.trim() || null,
    };
    try {
      const { data } = editing
        ? await client.put(`/admin/counselling-sessions/${session.session_id}/reschedule`, body)
        : await client.post("/admin/counselling-sessions", { ...body, studentId: student.student_id, facultyId: Number(form.facultyId), reason: form.reason, reassign });
      const s = data.session;
      toast(`${s.student_name} and ${s.counsellor_name} have been notified.`, {
        type: "success",
        title: editing ? `Moved to ${pkDateTime(s.scheduled_at)}` : `Session booked for ${pkDateTime(s.scheduled_at)}`,
      });
      onSaved(s);
    } catch (e) {
      const d = e.response?.data;
      if (e.response?.status === 409 && d?.code === "COUNSELLOR_CHANGE") setConfirm(d);
      else setServerError(errorOf(e, "Could not save the session. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  const rows = faculty.data || [];
  const current = student?.counselor;
  const changing = !editing && current && form.facultyId && Number(form.facultyId) !== current.faculty_id;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Reschedule session" : "Schedule counselling session"}
      subtitle={editing ? `${session.student_name} · ${session.roll_no} · with ${session.counsellor_name}` : "Both the student and the counsellor are notified."}
      footer={
        confirm ? (
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Go back
            </Button>
            <Button onClick={() => submit(true)} loading={saving} icon={<Icons.UserCheck size={16} />}>
              Continue
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => submit(false)} loading={saving} icon={<Icons.Calendar size={16} />}>
              {editing ? "Save new time" : "Schedule session"}
            </Button>
          </>
        )
      }
    >
      {confirm ? (
        <div className="rounded-lg border border-risk/40 bg-risk-50 px-4 py-3 text-sm text-ink space-y-2" role="alert">
          <p className="font-medium">
            This makes {confirm.newCounsellor.name} the counsellor instead of {confirm.currentCounsellor.name}.
            {confirm.cancelNote ? ` ${confirm.cancelNote}` : ""} Continue?
          </p>
          <p className="text-muted">
            {confirm.currentCounsellor.name}'s assignment with {student?.full_name} is closed, and {confirm.newCounsellor.name} becomes their counsellor. Upcoming sessions with{" "}
            {confirm.currentCounsellor.name} are cancelled; past sessions still awaiting attendance stay with them. Everyone involved is notified.
          </p>
        </div>
      ) : (
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit(false);
          }}
        >
          <Field label="Student" htmlFor="cs-student" error={errors.student}>
            <StudentPicker value={student} onPick={pickStudent} disabled={editing || Boolean(prefill?.student)} />
          </Field>

          {editing ? (
            <p className="text-sm text-muted">
              Counsellor: <span className="text-ink">{session.counsellor_name}</span>
            </p>
          ) : (
            <Field
              label="Counsellor"
              htmlFor="cs-faculty"
              error={errors.facultyId || faculty.error}
              hint={changing ? `This would make the selected teacher the counsellor instead of ${current.name} - you'll be asked to confirm.` : current ? "Defaults to the student's current counsellor." : null}
            >
              <select id="cs-faculty" className="field" value={form.facultyId || ""} onChange={set("facultyId")} disabled={faculty.loading}>
                <option value="">{faculty.loading ? "Loading faculty…" : "Choose a counsellor"}</option>
                {rows.map((f) => (
                  <option key={f.faculty_id} value={f.faculty_id}>
                    {f.full_name} · {f.active_counselees} counselee{f.active_counselees === 1 ? "" : "s"}
                    {current?.faculty_id === f.faculty_id ? " (current counsellor)" : ""}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" htmlFor="cs-date" error={errors.date}>
              <input id="cs-date" type="date" className="field" min={today} max={addDays(today, MAX_DAYS)} value={form.date || ""} onChange={set("date")} />
            </Field>
            <Field label="Time (PKT)" htmlFor="cs-time" error={errors.time}>
              <input id="cs-time" type="time" className="field" step={900} value={form.time || ""} onChange={set("time")} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Duration" htmlFor="cs-duration">
              <select id="cs-duration" className="field" value={form.durationMin || 30} onChange={set("durationMin")}>
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {d} minutes
                  </option>
                ))}
              </select>
            </Field>
            <fieldset>
              <legend className="field-label">Mode</legend>
              <div className="flex gap-2">
                {[
                  ["in_person", "In person"],
                  ["online", "Online"],
                ].map(([v, l]) => (
                  <label
                    key={v}
                    className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-sm cursor-pointer ${form.mode === v ? "border-brand bg-brand-50 text-brand-dark" : "border-line bg-surface text-ink"}`}
                  >
                    <input type="radio" name="cs-mode" className="sr-only" value={v} checked={form.mode === v} onChange={set("mode")} />
                    {l}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <Field label={form.mode === "online" ? "Meeting link" : "Location"} htmlFor="cs-location" error={errors.location}>
            <input
              id="cs-location"
              className="field"
              maxLength={300}
              placeholder={form.mode === "online" ? "https://meet.google.com/…" : "Room 204"}
              value={form.location || ""}
              onChange={set("location")}
            />
          </Field>

          <Field label="Agenda (optional)" htmlFor="cs-agenda">
            <textarea id="cs-agenda" className="field min-h-[72px]" maxLength={1000} placeholder="What the session is about" value={form.agenda || ""} onChange={set("agenda")} />
          </Field>

          <ErrorBox>{serverError}</ErrorBox>
          <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
        </form>
      )}
    </Modal>
  );
}

/** Cancel a session (a reason is required; both people are notified). */
export function CancelSessionModal({ session, onClose, onSaved }) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setReason("");
    setError("");
  }, [session]);

  async function save() {
    if (!reason.trim()) {
      setError("Give a reason - it is sent to the student and the counsellor");
      return;
    }
    setSaving(true);
    try {
      const { data } = await client.put(`/admin/counselling-sessions/${session.session_id}/cancel`, { reason: reason.trim() });
      toast(`${data.student_name} and ${data.counsellor_name} have been notified.`, { type: "info", title: "Session cancelled" });
      onSaved(data);
    } catch (e) {
      setError(errorOf(e, "Could not cancel the session"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={Boolean(session)}
      onClose={onClose}
      title="Cancel session"
      subtitle={session && `${session.student_name} · ${pkDateTime(session.scheduled_at)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep session
          </Button>
          <Button variant="danger" onClick={save} loading={saving}>
            Cancel session
          </Button>
        </>
      }
    >
      <Field label="Reason" htmlFor="cs-cancel-reason" error={error}>
        <textarea
          id="cs-cancel-reason"
          className="field min-h-[80px]"
          maxLength={500}
          placeholder="e.g. Counsellor on leave"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setError("");
          }}
        />
      </Field>
    </Modal>
  );
}

/**
 * Mark Present / Absent with optional private notes (never shown to the student). Also corrects an
 * earlier mark. endpoint: "/admin/counselling-sessions" (admin override) or "/faculty/counselling-sessions".
 */
export function AttendanceModal({ session, onClose, onSaved, endpoint = "/admin/counselling-sessions", preset }) {
  const { toast } = useToast();
  const [attendance, setAttendance] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setAttendance(preset || session?.attendance || "");
    setNotes(session?.counsellor_notes || "");
    setError("");
  }, [session, preset]);

  async function save() {
    if (!attendance) {
      setError("Choose Present or Absent");
      return;
    }
    setSaving(true);
    try {
      const { data } = await client.put(`${endpoint}/${session.session_id}/attendance`, { attendance, notes: notes.trim() || null });
      toast(data.previous === attendance ? "Notes saved." : `${data.session.student_name} has been notified.`, {
        type: "success",
        title: `Marked ${attendance === "present" ? "Present" : "Absent"}`,
      });
      onSaved(data.session);
    } catch (e) {
      setError(errorOf(e, "Could not save the attendance"));
    } finally {
      setSaving(false);
    }
  }

  const option = (v, label, Icon, tone) => (
    <label
      className={`flex-1 inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium cursor-pointer ${attendance === v ? tone : "border-line bg-surface text-ink"}`}
    >
      <input
        type="radio"
        name="cs-attendance"
        className="sr-only"
        value={v}
        checked={attendance === v}
        onChange={() => {
          setAttendance(v);
          setError("");
        }}
      />
      <Icon size={16} />
      {label}
    </label>
  );

  return (
    <Modal
      open={Boolean(session)}
      onClose={onClose}
      title={session?.attendance ? "Correct attendance" : "Mark attendance"}
      subtitle={session && `${session.student_name} · ${pkDateTime(session.scheduled_at)} · ${session.counsellor_name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving} icon={<Icons.Check size={16} />}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <fieldset>
          <legend className="field-label">Did the student attend?</legend>
          <div className="flex gap-2">
            {option("present", "Present", Icons.CheckCircle, "border-safe-500 bg-safe-50 text-safe-700")}
            {option("absent", "Absent", Icons.AlertOctagon, "border-danger-500 bg-danger-50 text-danger-700")}
          </div>
        </fieldset>
        <Field label="Counsellor notes (optional)" htmlFor="cs-notes" hint="Private: seen by the counsellor and the admin, never by the student.">
          <textarea id="cs-notes" className="field min-h-[90px]" maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <ErrorBox>{error}</ErrorBox>
      </div>
    </Modal>
  );
}
