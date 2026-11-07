import { useState } from "react";
import { Link } from "react-router-dom";
import client from "../../api/client";
import { PortalShell } from "../../components/Shell";
import { Card, Button, Icons, RiskChip } from "../../components/ui";
import useApi from "../../lib/useApi";

// Admin: import a live cohort (real classroom students who are not in SmartEdu yet) from a CSV.
// POST /admin/live-cohort?mode=preview|commit. Column guide: docs/LIVE_DATA_TEMPLATE.md.

const OUTCOME_LABEL = { safe: "Safe", at_risk: "At-Risk", dropout: "Dropout-Likely" };

function downloadBlob(res, fallback) {
  const name = /filename="([^"]+)"/.exec(res.headers["content-disposition"] || "")?.[1] || fallback;
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function LiveCohort() {
  const courses = useApi("/admin/courses");
  const faculty = useApi("/admin/faculty");
  const [form, setForm] = useState({ courseId: "", facultyId: "", section: "LIVE" });
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [run, setRun] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const ready = form.courseId && form.facultyId && form.section.trim();
  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setPreview(null);
    setResult(null);
  };

  async function send(mode, f = file) {
    const fd = new FormData();
    fd.append("file", f);
    Object.entries(form).forEach(([k, v]) => fd.append(k, v));
    const { data } = await client.post("/admin/live-cohort", fd, { params: { mode } });
    return data;
  }

  async function choose(f) {
    if (!f) return;
    setFile(f);
    setPreview(null);
    setResult(null);
    setRun(null);
    setError(null);
    if (!ready) {
      setError("Choose the course, the faculty member and the section first.");
      return;
    }
    setBusy("preview");
    try {
      setPreview(await send("preview", f));
    } catch (e) {
      setError(e.response?.data?.error || "Could not read the file");
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    setBusy("commit");
    setError(null);
    try {
      setResult(await send("commit"));
      setPreview(null);
    } catch (e) {
      setError(e.response?.data?.error || "Could not import the cohort");
    } finally {
      setBusy(null);
    }
  }

  async function predict() {
    setBusy("run");
    try {
      const { data } = await client.post("/admin/predictions/run", { scope: "class", scopeId: result.class.faculty_course_id });
      let r = data;
      for (let i = 0; i < 120 && ["queued", "running"].includes(r.status); i++) {
        await new Promise((ok) => setTimeout(ok, 1000));
        r = (await client.get(`/admin/predictions/runs/${data.id}`)).data;
      }
      setRun(r);
    } catch (e) {
      setError(e.response?.data?.error || "Could not start the prediction run");
    } finally {
      setBusy(null);
    }
  }

  const p = preview || result;

  return (
    <PortalShell>
      <Link to="/admin" className="inline-flex items-center gap-1 text-sm text-brand hover:underline">
        ← Overview
      </Link>
      <div className="mt-2 mb-5">
        <h1 className="font-display text-2xl sm:text-[28px] leading-tight">Import a live cohort</h1>
        <p className="text-sm text-muted mt-1 max-w-3xl">
          Add real classroom students who are not in SmartEdu yet. They are tagged <strong>live</strong>, kept apart from the synthetic dataset,
          and join a live class section the chosen faculty member can upload marks and attendance for.
        </p>
      </div>

      <div className="space-y-4">
        <Card title="1. The live class" subtitle="Created if it doesn't exist yet">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              <span className="block text-muted mb-1">Course</span>
              <select className="field" value={form.courseId} onChange={set("courseId")}>
                <option value="">Choose a course</option>
                {(courses.data || []).map((c) => (
                  <option key={c.course_id} value={c.course_id}>
                    {c.course_code} · {c.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-muted mb-1">Faculty member</span>
              <select className="field" value={form.facultyId} onChange={set("facultyId")}>
                <option value="">Choose who teaches it</option>
                {(faculty.data || []).map((f) => (
                  <option key={f.faculty_id} value={f.faculty_id}>
                    {f.full_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-muted mb-1">Section</span>
              <input className="field" value={form.section} onChange={set("section")} maxLength={10} />
            </label>
          </div>
        </Card>

        <Card title="2. The cohort file" subtitle="One row per student. Empty cells are allowed; the model fills missing values.">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              icon={<Icons.Download size={15} />}
              loading={busy === "template"}
              onClick={async () => {
                setBusy("template");
                try {
                  downloadBlob(await client.get("/admin/live-cohort/template.csv", { responseType: "blob" }), "live_cohort_template.csv");
                } finally {
                  setBusy(null);
                }
              }}
            >
              Download template
            </Button>
            <label className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm cursor-pointer ${ready ? "border-brand text-brand hover:bg-brand-50" : "border-line text-muted"}`}>
              <Icons.Inbox size={16} /> Choose CSV file
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => choose(e.target.files?.[0])} />
            </label>
            {file && <span className="text-sm text-muted">{file.name}{busy === "preview" ? " · checking…" : ""}</span>}
          </div>
          <p className="mt-3 text-xs text-muted">
            Columns: roll_no, full_name, department, semester, cgpa, previous_sgpa, attendance, assignment, quiz, midterm, final, failed_courses, credits, and
            optionally actual_outcome (safe | at_risk | dropout | unknown), gender, age, study_hours, lms_logins, submission_rate, scholarship, hostel. See
            docs/LIVE_DATA_TEMPLATE.md.
          </p>
          {error && (
            <p role="alert" className="mt-3 flex items-start gap-1.5 text-sm text-danger-700">
              <Icons.AlertOctagon size={16} className="shrink-0 mt-0.5" /> {error}
            </p>
          )}
        </Card>

        {p && (
          <Card
            title={result ? (result.upload.status === "committed" ? "Imported" : "Nothing was imported") : "3. Check before importing"}
            subtitle={result ? `${result.class.course} ${result.class.section} · ${result.class.faculty}` : "Nothing has been saved yet."}
          >
            <ul className="flex flex-wrap gap-2 text-sm">
              <li className="rounded-full bg-ink/5 px-3 py-1"><strong>{p.summary.rows_total}</strong> rows</li>
              <li className="rounded-full bg-safe-50 text-safe-700 px-3 py-1"><strong>{p.summary.rows_ok}</strong> {result ? "imported" : "valid"}</li>
              <li className={`rounded-full px-3 py-1 ${p.summary.rows_failed ? "bg-danger-50 text-danger-700" : "bg-ink/5 text-muted"}`}><strong>{p.summary.rows_failed}</strong> with errors</li>
              <li className="rounded-full bg-ink/5 px-3 py-1"><strong>{p.with_outcome}</strong> with an actual outcome</li>
            </ul>

            {p.missing_features.length > 0 && (
              <div className="mt-4 rounded-lg border border-line bg-paper/60 p-3 text-sm">
                <p className="font-medium text-ink">Model inputs the file doesn't have (filled by the model's imputer):</p>
                <p className="mt-1 text-ink/80">{p.missing_features.map((m) => `${m.feature} (${m.students})`).join(", ")}</p>
                <p className="mt-1 text-xs text-muted">Derived: SGPA = 2 × CGPA − previous SGPA; credits passed = credits − 3 × failed courses.</p>
              </div>
            )}

            {p.errors.length > 0 && (
              <ul className="mt-4 space-y-1 rounded-lg border border-danger-500/30 bg-danger-50/60 p-3 text-sm max-h-48 overflow-y-auto">
                {p.errors.map((e, i) => (
                  <li key={i}>
                    <span className="font-mono text-xs text-muted">Row {e.row}</span> · <span className="font-mono text-xs">{e.column}</span> - {e.message}
                  </li>
                ))}
              </ul>
            )}

            {!result && (
              <div className="mt-4 overflow-x-auto rounded-lg border border-line">
                <table className="w-full min-w-[620px] text-sm">
                  <thead className="bg-paper text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Row</th>
                      <th className="px-3 py-2 text-left font-medium">Student</th>
                      <th className="px-3 py-2 text-left font-medium">Dept</th>
                      <th className="px-3 py-2 text-right font-medium">CGPA</th>
                      <th className="px-3 py-2 text-right font-medium">Attend.</th>
                      <th className="px-3 py-2 text-left font-medium">Outcome</th>
                      <th className="px-3 py-2 text-left font-medium">Check</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.preview.map((r) => (
                      <tr key={r.row} className={`border-t border-line ${r.ok ? "" : "bg-danger-50/70"}`}>
                        <td className="px-3 py-2 font-mono text-xs text-muted">{r.row}</td>
                        <td className="px-3 py-2">
                          <span className="block font-mono text-xs">{r.roll_no}</span>
                          <span className="block text-xs text-muted">{r.name}</span>
                        </td>
                        <td className="px-3 py-2">{r.department || "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.cgpa ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.attendance ?? "—"}</td>
                        <td className="px-3 py-2">{r.actual_outcome ? (OUTCOME_LABEL[r.actual_outcome] ? <RiskChip label={OUTCOME_LABEL[r.actual_outcome]} size="sm" /> : r.actual_outcome) : <span className="text-muted">—</span>}</td>
                        <td className="px-3 py-2 text-xs">
                          {r.ok ? <span className="text-safe-700">OK</span> : <span className="text-danger-700">{r.errors.map((e) => e.message).join("; ")}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              {!result && (
                <Button onClick={commit} loading={busy === "commit"} disabled={!p.summary.rows_ok} icon={<Icons.Check size={16} />}>
                  Import {p.summary.rows_ok} student{p.summary.rows_ok === 1 ? "" : "s"}
                </Button>
              )}
              {result?.upload.status === "committed" && !run && (
                <Button onClick={predict} loading={busy === "run"} icon={<Icons.Play size={15} />}>
                  Run predictions for this class
                </Button>
              )}
              {run && (
                <p role="status" className="text-sm">
                  Prediction run #{run.id}: <strong>{run.status}</strong>, {run.done} of {run.total} students.{" "}
                  <Link to="/admin/interventions" className="text-brand hover:underline">See flagged students →</Link>
                </p>
              )}
            </div>
          </Card>
        )}
      </div>
    </PortalShell>
  );
}
