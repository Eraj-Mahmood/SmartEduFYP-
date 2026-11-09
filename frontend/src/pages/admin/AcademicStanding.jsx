import { useEffect, useMemo, useState } from "react";
import client from "../../api/client";
import { PortalShell } from "../../components/Shell";
import { Card, DataTable, Pagination, RiskChip, Button, EmptyState, Icons, StandingChip, Tabs, Modal, useToast, buttonClass } from "../../components/ui";
import useApi from "../../lib/useApi";
import useWide from "../../lib/useWide";
import { pkDateTime } from "../../lib/format";
import { ScheduleSessionModal } from "./CounsellingModals";
import { RecordApprovalModal } from "./StandingModals";

// Admin "Academic standing" (Phase 7, BU Student Handbook clause 5.5): close a semester (preview first,
// "results are final" required), the probation list (schedule counselling, record a Probation 2
// approval, print letters), warning letters and the closes history. Probation never changes the
// Random Forest risk label - both are shown side by side.

const two = (v) => (v == null ? "—" : Number(v).toFixed(2));
const LIST_TABS = [
  { key: "on_probation", label: "On probation" },
  { key: "probation_2", label: "Probation 2" },
  { key: "dropped", label: "Dropped" },
];

function PrintLink({ id, children = "Print" }) {
  return (
    <a href={`/admin/warning-letters/${id}/print`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-brand hover:underline whitespace-nowrap">
      <Icons.External size={13} /> {children}
    </a>
  );
}

function Pill({ label, value, status }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm">
      {status ? <StandingChip status={status} short /> : <span className="text-muted">{label}</span>}
      <strong className="tabular-nums">{value}</strong>
    </span>
  );
}

function CloseSemester({ onClosed }) {
  const { toast } = useToast();
  const wide = useWide(768);
  const [term, setTerm] = useState("");
  const [final, setFinal] = useState(false);
  const [preview, setPreview] = useState(null);
  const [onlyChanged, setOnlyChanged] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");

  async function runPreview() {
    if (term.trim().length < 3) {
      setError("Enter the term, e.g. Fall 2026");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { data } = await client.post("/admin/semester-close/preview", { termLabel: term.trim() });
      setPreview(data);
    } catch (e) {
      setError(e.response?.data?.error || "Could not build the preview");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    try {
      const { data } = await client.post("/admin/semester-close/confirm", { termLabel: preview.termLabel, resultsFinal: final });
      toast(`${data.students} students evaluated · ${data.letters} warning letters · ${data.notified} notified. Their predictions are being refreshed.`, {
        type: "success",
        title: `${preview.termLabel} closed`,
      });
      setConfirming(false);
      setPreview(null);
      setTerm("");
      setFinal(false);
      onClosed();
    } catch (e) {
      setConfirming(false);
      setError(e.response?.data?.error || "Could not close the semester");
    } finally {
      setBusy(false);
    }
  }

  const rows = preview ? preview.students.filter((s) => !onlyChanged || s.changed || s.letter) : [];
  const columns = wide
    ? [
        { key: "student", header: "Student", sortable: false, render: (s) => (<span><span className="block font-medium">{s.name}</span><span className="block font-mono text-xs text-muted">{s.roll_no}</span></span>) },
        { key: "sem", header: "Semester", sortable: false, align: "right", render: (s) => s.semester_no },
        { key: "used", header: "Judged on", sortable: false, render: (s) => (<span className="whitespace-nowrap">{s.uses} <strong className="tabular-nums">{two(s.cgpa_used)}</strong> <span className="text-xs text-muted">/ min {two(s.minimum)}</span></span>) },
        { key: "move", header: "Standing", sortable: false, render: (s) => (<span className="inline-flex items-center gap-1.5 flex-wrap"><StandingChip status={s.from.status} short /><Icons.ChevronRight size={14} className="text-muted" /><StandingChip status={s.to.status} short /></span>) },
        { key: "letter", header: "Letter", sortable: false, render: (s) => (s.letter ? `Level ${s.letter}` : "—") },
      ]
    : [
        {
          key: "s",
          header: "Student",
          sortable: false,
          render: (s) => (
            <span className="block">
              <span className="block font-medium">{s.name}</span>
              <span className="block font-mono text-xs text-muted">{s.roll_no} · sem {s.semester_no}</span>
              <span className="block text-xs mt-0.5">{s.uses} {two(s.cgpa_used)} / min {two(s.minimum)}</span>
            </span>
          ),
        },
        {
          key: "m",
          header: "Standing",
          sortable: false,
          align: "right",
          render: (s) => (
            <span className="flex flex-col items-end gap-1">
              <StandingChip status={s.to.status} short />
              <span className="text-[11px] text-muted">was {s.from.status.replace("_", " ")}</span>
              {s.letter && <span className="text-[11px] text-risk-700">letter {s.letter}</span>}
            </span>
          ),
        },
      ];

  return (
    <Card title="Close semester" subtitle="Decides each enrolled student's standing from this term's results (Handbook 5.5). Preview first - nothing is saved until you confirm.">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,240px)_1fr_auto] sm:items-end">
        <div>
          <label htmlFor="close-term" className="field-label">
            Term
          </label>
          <input id="close-term" className="field" placeholder="e.g. Fall 2026" maxLength={40} value={term} onChange={(e) => { setTerm(e.target.value); setPreview(null); setError(""); }} />
        </div>
        <label className="inline-flex items-start gap-2 text-sm sm:pb-2">
          <input type="checkbox" className="accent-brand mt-0.5" checked={final} onChange={(e) => setFinal(e.target.checked)} />
          <span>All results for this term, including FYP, are final (Handbook 1.20.4)</span>
        </label>
        <Button variant="secondary" onClick={runPreview} loading={busy && !confirming} icon={<Icons.Eye size={16} />}>
          Preview
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          <Icons.AlertOctagon size={16} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}
      {preview && (
        <div className="mt-5 space-y-4">
          {preview.alreadyClosed && (
            <p role="alert" className="rounded-lg border border-danger/30 bg-danger-50 px-3 py-2 text-sm text-danger-700">
              {preview.termLabel} has already been closed.
            </p>
          )}
          {!preview.total && !preview.alreadyClosed && (
            <p role="alert" className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink">
              No student has enrolments this term, so there is nothing to close. The last close already ended the term; enrol students in this
              term's classes first.
            </p>
          )}
          {preview.incomplete.length > 0 && (
            <p role="alert" className="rounded-lg border border-risk/40 bg-risk-50 px-3 py-2 text-sm text-risk-700">
              {preview.incomplete.length} student(s) still have courses without final marks: {preview.incomplete.slice(0, 5).map((x) => `${x.roll_no} (${x.courses.join(", ")})`).join("; ")}
              {preview.incomplete.length > 5 ? "…" : ""}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Pill label="Students" value={preview.total} />
            {["good", "probation_1", "probation_2", "dropped", "not_evaluated"].map((st) => (preview.counts[st] ? <Pill key={st} status={st} value={preview.counts[st]} /> : null))}
            <Pill label="Letters" value={preview.letters} />
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" className="accent-brand" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />
            Only students whose standing changes ({preview.changed})
          </label>
          <DataTable rows={rows} rowKey={(s) => s.student_id} minWidth={wide ? 720 : 0} columns={columns} emptyMessage="No standing changes" />
          <div className="flex flex-wrap items-center justify-end gap-3">
            {!final && <span className="text-sm text-muted">Tick "results are final" to confirm.</span>}
            <Button onClick={() => setConfirming(true)} disabled={!final || preview.alreadyClosed || preview.incomplete.length > 0 || !preview.total} icon={<Icons.Lock size={16} />}>
              Close {preview.termLabel}
            </Button>
          </div>
        </div>
      )}
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Close ${preview?.termLabel || ""}?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Go back
            </Button>
            <Button onClick={confirm} loading={busy} icon={<Icons.Lock size={16} />}>
              Close the semester
            </Button>
          </>
        }
      >
        {preview && (
          <div className="space-y-2 text-sm text-ink">
            <p>
              This records the standing of <strong>{preview.total}</strong> students, saves their new official CGPA, issues <strong>{preview.letters}</strong> warning
              letter{preview.letters === 1 ? "" : "s"} and notifies the students whose standing changes. It also ends the term: this term's
              enrolments are marked completed, so their classes take no more marks or attendance. It can't be undone from the app.
            </p>
            <p className="text-muted">The students' risk predictions are refreshed afterwards; probation itself does not change the risk label.</p>
          </div>
        )}
      </Modal>
    </Card>
  );
}

function ProbationList({ reloadKey, onSchedule, onApprove }) {
  const wide = useWide(768);
  const [status, setStatus] = useState("on_probation");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(1), [status, q]);
  const list = useApi("/admin/academic-standing", { params: { status, search: q || undefined, page, limit: 20, k: reloadKey } });
  const data = list.data || { rows: [], total: 0, page: 1, totalPages: 0 };

  const actions = (r) => (
    <div className="flex flex-wrap justify-end gap-1.5">
      {r.academic_status !== "dropped" && (
        <Button size="sm" variant="secondary" onClick={() => onSchedule(r)} icon={<Icons.Calendar size={13} />}>
          Schedule session
        </Button>
      )}
      {r.hold === "on_hold" && (
        <Button size="sm" variant="ghost" onClick={() => onApprove(r)}>
          Record approval
        </Button>
      )}
    </div>
  );
  const letter = (r) =>
    r.letter_id ? (
      <span className="inline-flex flex-col gap-0.5">
        <PrintLink id={r.letter_id}>Letter {r.letter_level}</PrintLink>
        <span className={`text-xs ${r.acknowledged_at ? "text-safe-700" : "text-risk-700"}`}>{r.acknowledged_at ? "acknowledged" : "not acknowledged"}</span>
      </span>
    ) : (
      <span className="text-xs text-muted">{r.source === "seed" ? "starting status (no letter)" : "—"}</span>
    );
  const columns = useMemo(
    () =>
      wide
        ? [
            { key: "s", header: "Student", sortable: false, render: (r) => (<span><span className="block font-medium">{r.full_name}</span><span className="block font-mono text-xs text-muted">{r.roll_no} · {r.department_code} · sem {r.current_semester}</span></span>) },
            {
              key: "st",
              header: "Academic standing (BU rules)",
              sortable: false,
              render: (r) => (
                <span className="inline-flex flex-col items-start gap-1">
                  <StandingChip status={r.academic_status} />
                  <span className="text-xs text-muted">CGPA {two(r.cgpa_used)}{r.term_label ? ` · ${r.term_label}` : ""}</span>
                  {r.hold === "on_hold" && <span className="text-xs text-danger-700 inline-flex items-center gap-1"><Icons.Lock size={11} /> enrolment hold</span>}
                  {r.hold === "approved" && <span className="text-xs text-safe-700">approved ({r.approver_role})</span>}
                </span>
              ),
            },
            { key: "risk", header: "Risk prediction (Random Forest)", sortable: false, render: (r) => (r.final_label ? <RiskChip label={r.final_label} size="sm" short /> : "—") },
            { key: "c", header: "Counsellor", sortable: false, render: (r) => r.counsellor_name || <span className="text-xs text-muted">none</span> },
            { key: "l", header: "Letter", sortable: false, render: letter },
            { key: "a", header: "", sortable: false, align: "right", render: actions },
          ]
        : [
            {
              key: "s",
              header: "Student",
              sortable: false,
              render: (r) => (
                <span className="block">
                  <span className="block font-medium">{r.full_name}</span>
                  <span className="block font-mono text-xs text-muted">{r.roll_no}</span>
                  <span className="mt-1 flex flex-wrap gap-1"><StandingChip status={r.academic_status} short />{r.final_label && <RiskChip label={r.final_label} size="sm" short />}</span>
                  <span className="block mt-1">{letter(r)}</span>
                </span>
              ),
            },
            { key: "a", header: "", sortable: false, align: "right", render: actions },
          ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wide]
  );

  return (
    <Card title="Students on probation" subtitle="Starting statuses come from the dataset (no letters); statuses from a semester close have letters.">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <Tabs tabs={LIST_TABS} value={status} onChange={setStatus} label="Standing" />
        <label className="relative block sm:w-72">
          <span className="sr-only">Search</span>
          <Icons.Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input type="search" className="field pl-9" placeholder="Roll no or name" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>
      {list.error ? (
        <EmptyState icon={<Icons.AlertOctagon size={22} />} message="We couldn't load the list" detail={list.error} action={<Button variant="secondary" onClick={() => list.reload()}>Try again</Button>} />
      ) : (
        <>
          <DataTable loading={list.loading && !list.data} rows={data.rows} rowKey={(r) => r.student_id} minWidth={wide ? 980 : 0} columns={columns} emptyMessage="No students in this group" />
          <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} label="students" />
        </>
      )}
    </Card>
  );
}

function Letters({ reloadKey }) {
  const [ack, setAck] = useState("");
  const list = useApi("/admin/warning-letters", { params: { acknowledged: ack || undefined, limit: 10, k: reloadKey } });
  const rows = list.data?.rows || [];
  return (
    <Card
      title="Warning letters"
      subtitle="Issued at a semester close (Handbook 5.5.2). Print -> Save as PDF keeps a copy on record."
      actions={
        <select className="field !w-auto" value={ack} onChange={(e) => setAck(e.target.value)} aria-label="Acknowledged">
          <option value="">All</option>
          <option value="no">Not acknowledged</option>
          <option value="yes">Acknowledged</option>
        </select>
      }
    >
      {rows.length === 0 ? (
        <EmptyState message={list.loading ? "Loading…" : "No warning letters yet"} detail="Letters are issued when a semester close puts a student on probation." compact />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{l.student.name}</span> <span className="font-mono text-xs text-muted">{l.student.roll_no}</span>
                <span className="block text-xs text-muted">
                  {l.title} · {l.term} · {l.date} · {l.acknowledged_at ? <span className="text-safe-700">acknowledged</span> : <span className="text-risk-700">not acknowledged</span>}
                </span>
              </span>
              <PrintLink id={l.id} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Closes({ reloadKey }) {
  const list = useApi("/admin/semester-closes", { params: { k: reloadKey } });
  const rows = list.data || [];
  return (
    <Card title="Semester closes" subtitle="Every close, newest first">
      {rows.length === 0 ? (
        <EmptyState message={list.loading ? "Loading…" : "No semester has been closed yet"} compact />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((c) => (
            <li key={c.id} className="py-2.5 text-sm">
              <span className="font-medium">{c.term_label}</span> <span className="text-muted">· {pkDateTime(c.closed_at)} · {c.closed_by_email}</span>
              <span className="mt-1 flex flex-wrap gap-1.5">
                <Pill label="Students" value={c.students_total} />
                {c.good_count > 0 && <Pill status="good" value={c.good_count} />}
                {c.probation_1_count > 0 && <Pill status="probation_1" value={c.probation_1_count} />}
                {c.probation_2_count > 0 && <Pill status="probation_2" value={c.probation_2_count} />}
                {c.dropped_count > 0 && <Pill status="dropped" value={c.dropped_count} />}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Pre-fill for the "Schedule session" form from a probation row (reason probation, agenda from the standing). */
export function probationPrefill(r) {
  return {
    student: {
      student_id: r.student_id,
      roll_no: r.roll_no,
      full_name: r.full_name,
      final_label: r.final_label,
      counselor: r.counsellor_id ? { faculty_id: r.counsellor_id, name: r.counsellor_name } : null,
    },
    reason: "probation",
    agenda: `Probation follow-up (${r.label}${r.term_label ? `, ${r.term_label}` : ""}): CGPA ${two(r.cgpa_used)}. Plan to reach the minimum this semester.`,
  };
}

export default function AcademicStanding() {
  const [reloadKey, setReloadKey] = useState(0);
  const [scheduleFor, setScheduleFor] = useState(null);
  const [approveFor, setApproveFor] = useState(null);
  const reload = () => setReloadKey((k) => k + 1);

  return (
    <PortalShell>
      <div className="mb-5">
        <h1 className="font-display text-2xl sm:text-[28px] mb-1">Academic standing</h1>
        <p className="text-muted text-sm max-w-3xl">
          Probation under the BU Student Handbook (Spring 2024), clause 5.5: below the programme minimum at the end of a semester means probation; a third semester below
          it after two consecutive probations means drop. This is a rule outcome and never changes the Random Forest risk prediction.
        </p>
        <a href="#letters" className={buttonClass("ghost", "sm", "mt-2 -ml-3")}>
          Jump to warning letters
        </a>
      </div>
      <div className="space-y-5">
        <CloseSemester onClosed={reload} />
        <ProbationList reloadKey={reloadKey} onSchedule={(r) => setScheduleFor(probationPrefill(r))} onApprove={setApproveFor} />
        <div id="letters" className="grid gap-5 lg:grid-cols-2 scroll-mt-24">
          <Letters reloadKey={reloadKey} />
          <Closes reloadKey={reloadKey} />
        </div>
      </div>
      <ScheduleSessionModal open={Boolean(scheduleFor)} prefill={scheduleFor} onClose={() => setScheduleFor(null)} onSaved={() => { setScheduleFor(null); reload(); }} />
      <RecordApprovalModal student={approveFor} onClose={() => setApproveFor(null)} onSaved={() => { setApproveFor(null); reload(); }} />
    </PortalShell>
  );
}
