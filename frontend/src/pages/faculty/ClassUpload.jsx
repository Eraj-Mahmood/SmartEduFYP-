import { useEffect, useRef, useState } from "react";
import client from "../../api/client";
import { Card, Button, RiskChip, Icons, Skeleton } from "../../components/ui";
import useApi from "../../lib/useApi";
import { timeAgo } from "../../lib/format";

// Faculty bulk upload for one class: choose what to upload, get the template, drop the file,
// check the preview (bad rows highlighted), save the valid rows, see what changed.

const KINDS = {
  results: {
    label: "Marks",
    help: "Assignment, quiz, midterm and final marks (0-100). Leave a cell empty to keep the saved mark.",
    columns: [
      { key: "assignment_avg", label: "Assign." },
      { key: "quiz_avg", label: "Quiz" },
      { key: "midterm_marks", label: "Midterm" },
      { key: "final_marks", label: "Final" },
    ],
  },
  attendance: {
    label: "Attendance",
    help: "One row per student per class date (YYYY-MM-DD). Status: present, absent or leave.",
    columns: [
      { key: "class_date", label: "Date" },
      { key: "status", label: "Status" },
    ],
  },
};

const STATUS_STYLE = {
  committed: "bg-safe-50 text-safe-700 ring-safe-500/30",
  previewed: "bg-ink/5 text-muted ring-ink/10",
  failed: "bg-danger-50 text-danger-700 ring-danger-500/30",
};
const STATUS_TEXT = { committed: "Saved", previewed: "Checked only", failed: "Nothing saved" };

const fmtSize = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`);

function SummaryPills({ summary }) {
  const items = [
    { label: "rows", value: summary.rows_total, cls: "bg-ink/5 text-ink" },
    { label: "valid", value: summary.rows_ok, cls: "bg-safe-50 text-safe-700" },
    { label: "with errors", value: summary.rows_failed, cls: summary.rows_failed ? "bg-danger-50 text-danger-700" : "bg-ink/5 text-muted" },
    ...(summary.rows_skipped ? [{ label: "left empty (skipped)", value: summary.rows_skipped, cls: "bg-ink/5 text-muted" }] : []),
  ];
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((i) => (
        <li key={i.label} className={`rounded-full px-3 py-1 text-sm ${i.cls}`}>
          <strong className="tabular-nums">{i.value}</strong> {i.label}
        </li>
      ))}
    </ul>
  );
}

function PreviewTable({ kind, rows, total }) {
  const cols = KINDS[kind].columns;
  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-paper text-xs uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium w-14">Row</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Student</th>
              {cols.map((c) => (
                <th key={c.key} scope="col" className="px-3 py-2 text-right font-medium">{c.label}</th>
              ))}
              <th scope="col" className="px-3 py-2 text-left font-medium">Check</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const badCols = new Set(r.errors.map((e) => e.column));
              return (
                <tr key={r.row} className={`border-t border-line align-top ${r.errors.length ? "bg-danger-50/70" : ""}`}>
                  <td className="px-3 py-2 font-mono text-xs text-muted">{r.row}</td>
                  <td className={`px-3 py-2 ${badCols.has("roll_no") ? "text-danger-700" : ""}`}>
                    <span className="block font-mono text-xs">{r.roll_no || "—"}</span>
                    {r.name && <span className="block text-xs text-muted">{r.name}</span>}
                  </td>
                  {cols.map((c) => (
                    <td key={c.key} className={`px-3 py-2 text-right tabular-nums ${badCols.has(c.key) ? "font-semibold text-danger-700 underline decoration-danger-500 decoration-2 underline-offset-2" : ""}`}>
                      {badCols.has(c.key) ? (r.raw?.[c.key] ? String(r.raw[c.key]) : <span className="text-muted">empty</span>) : r[c.key] == null || r[c.key] === "" ? <span className="text-muted">—</span> : String(r[c.key])}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    {r.errors.length ? (
                      <ul className="space-y-0.5 text-xs text-danger-700">
                        {r.errors.map((e) => (
                          <li key={e.column + e.message} className="flex gap-1">
                            <Icons.AlertOctagon size={13} className="shrink-0 mt-px" /> {e.message}
                          </li>
                        ))}
                      </ul>
                    ) : r.skipped ? (
                      <span className="text-xs text-muted">Empty - skipped</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-safe-700">
                        <Icons.CheckCircle size={13} /> OK
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {total > rows.length && <p className="mt-2 text-xs text-muted">Showing the first {rows.length} of {total} rows. Every error in the file is listed above the table.</p>}
    </div>
  );
}

function History({ classId, version }) {
  const { data, loading, error } = useApi(`/faculty/uploads`, { params: { classId, limit: 20, v: version } });
  return (
    <Card title="Upload history" subtitle="This class, newest first">
      {loading && !data ? (
        <Skeleton className="h-24" />
      ) : error ? (
        <p className="text-sm text-danger-700">{error}</p>
      ) : !data?.length ? (
        <p className="text-sm text-muted">No uploads for this class yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {data.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE[u.status]}`}>{STATUS_TEXT[u.status]}</span>
              <span className="font-medium">{KINDS[u.kind]?.label || u.kind}</span>
              <span className="min-w-0 truncate text-muted max-w-[220px]" title={u.filename}>{u.filename}</span>
              <span className="tabular-nums">
                {u.rows_ok} ok{u.rows_failed ? <span className="text-danger-700"> · {u.rows_failed} rejected</span> : null}
                {u.summary?.labels_changed ? <span className="text-muted"> · {u.summary.labels_changed} label(s) changed</span> : null}
              </span>
              <span className="ml-auto text-xs text-muted">{timeAgo(u.committed_at || u.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function ClassUpload({ classId, onSaved }) {
  const [kind, setKind] = useState("results");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(null); // 'preview' | 'commit' | 'template'
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [version, setVersion] = useState(0); // bumps the history after each request
  const inputRef = useRef(null);
  const outRef = useRef(null); // the preview / result card, scrolled into view (it starts below the fold on phones)
  useEffect(() => {
    if (preview || result) outRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [preview, result]);

  function reset(nextKind = kind) {
    setKind(nextKind);
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function send(mode, f = file) {
    const fd = new FormData();
    fd.append("file", f);
    const { data } = await client.post(`/faculty/classes/${classId}/upload`, fd, { params: { kind, mode } });
    setVersion((v) => v + 1);
    return data;
  }

  async function choose(f) {
    if (!f) return;
    setResult(null);
    setPreview(null);
    setError(null);
    if (!/\.csv$/i.test(f.name)) {
      setFile(null);
      setError("Please choose a .csv file (in Excel: File → Save As → CSV).");
      return;
    }
    if (f.size > 2 * 1024 * 1024) {
      setFile(null);
      setError("The file is larger than 2 MB.");
      return;
    }
    setFile(f);
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
      const data = await send("commit");
      setResult(data);
      setPreview(null);
      onSaved?.();
    } catch (e) {
      setError(e.response?.data?.error || "Could not save the rows");
    } finally {
      setBusy(null);
    }
  }

  async function downloadTemplate() {
    setBusy("template");
    try {
      const res = await client.get(`/faculty/classes/${classId}/templates/${kind}.csv`, { responseType: "blob" });
      const name = /filename="([^"]+)"/.exec(res.headers["content-disposition"] || "")?.[1] || `${kind}.csv`;
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError("Could not download the template");
    } finally {
      setBusy(null);
    }
  }

  const k = KINDS[kind];
  const okRows = preview?.summary.rows_ok || 0;

  return (
    <div className="space-y-4">
      <Card title="Upload a file" subtitle="Save many students' marks or attendance at once from a spreadsheet.">
        <ol className="space-y-5">
          <li>
            <h3 className="text-sm font-semibold text-ink mb-2">1. What are you uploading?</h3>
            <div role="radiogroup" aria-label="What are you uploading?" className="inline-flex rounded-lg bg-ink/[0.06] p-1">
              {Object.entries(KINDS).map(([key, v]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={kind === key}
                  onClick={() => kind !== key && reset(key)}
                  className={`px-3.5 py-1.5 rounded-md text-sm transition ${kind === key ? "bg-surface text-ink font-medium shadow-sm" : "text-muted hover:text-ink"}`}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-sm text-muted">{k.help}</p>
          </li>

          <li>
            <h3 className="text-sm font-semibold text-ink mb-2">2. Fill in the template</h3>
            <p className="text-sm text-muted mb-2">It already lists every student in this class. Open it in Excel, fill in the empty columns and save it as CSV.</p>
            <Button variant="secondary" size="sm" onClick={downloadTemplate} loading={busy === "template"} icon={<Icons.Download size={15} />}>
              Download {k.label.toLowerCase()} template
            </Button>
          </li>

          <li>
            <h3 className="text-sm font-semibold text-ink mb-2">3. Upload it</h3>
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                choose(e.dataTransfer.files?.[0]);
              }}
              className={`flex flex-col items-center justify-center gap-1.5 rounded-card border-2 border-dashed px-4 py-7 text-center cursor-pointer transition ${
                dragging ? "border-brand bg-brand-50" : "border-line bg-paper/60 hover:border-brand/60"
              }`}
            >
              <Icons.Inbox size={26} className="text-muted" />
              <span className="text-sm text-ink">
                <span className="font-medium text-brand">Choose a CSV file</span> or drag it here
              </span>
              <span className="text-xs text-muted">.csv only · up to 2 MB · up to 2,000 rows</span>
              <input ref={inputRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => choose(e.target.files?.[0])} />
            </label>
            {file && (
              <p className="mt-2 text-sm text-muted">
                <Icons.Book size={14} className="inline -mt-0.5 mr-1" />
                {file.name} · {fmtSize(file.size)}
                {busy === "preview" && " · checking…"}
              </p>
            )}
            {error && (
              <p role="alert" className="mt-2 flex items-start gap-1.5 text-sm text-danger-700">
                <Icons.AlertOctagon size={16} className="shrink-0 mt-0.5" /> {error}
              </p>
            )}
          </li>
        </ol>
      </Card>

      <div ref={outRef} className="scroll-mt-20" />
      {preview && (
        <Card title="4. Check before saving" subtitle="Nothing has been saved yet.">
          <SummaryPills summary={preview.summary} />
          {preview.errors.length > 0 && (
            <div className="mt-4 rounded-lg border border-danger-500/30 bg-danger-50/60 p-3">
              <p className="text-sm font-medium text-danger-700">
                {preview.summary.rows_failed} row{preview.summary.rows_failed === 1 ? "" : "s"} will be rejected. Fix them in the file and upload again, or save the valid rows now.
              </p>
              <ul className="mt-2 space-y-1 text-sm text-ink/90 max-h-40 overflow-y-auto">
                {preview.errors.map((e, i) => (
                  <li key={i}>
                    <span className="font-mono text-xs text-muted">Row {e.row}</span> · <span className="font-mono text-xs">{e.column}</span> - {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-4">
            <PreviewTable kind={kind} rows={preview.preview} total={preview.summary.rows_total} />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={commit} loading={busy === "commit"} disabled={!okRows} icon={<Icons.Check size={16} />}>
              Save {okRows} valid row{okRows === 1 ? "" : "s"}
            </Button>
            <Button variant="secondary" onClick={() => reset()} disabled={busy === "commit"}>
              Cancel
            </Button>
            {!okRows && <span className="text-sm text-muted">There are no valid rows to save.</span>}
          </div>
        </Card>
      )}

      {result && (
        <Card title={result.upload.status === "committed" ? "Saved" : "Nothing was saved"} subtitle={result.upload.filename}>
          <div role="status" className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              ["Rows saved", result.summary.rows_ok, "text-safe-700"],
              ["Rows rejected", result.summary.rows_failed, result.summary.rows_failed ? "text-danger-700" : ""],
              ["Students re-predicted", result.repredicted, ""],
              ["Labels changed", result.labels_changed.length, result.labels_changed.length ? "text-brand" : ""],
            ].map(([label, value, cls]) => (
              <div key={label} className="rounded-lg border border-line bg-paper/60 px-3 py-2.5">
                <p className="text-xs text-muted">{label}</p>
                <p className={`font-display text-2xl tabular-nums ${cls}`}>{value}</p>
              </div>
            ))}
          </div>
          {result.labels_changed.length > 0 && (
            <ul className="mt-4 space-y-1.5">
              {result.labels_changed.map((c) => (
                <li key={c.student_id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono text-xs">{c.roll_no}</span>
                  <span>{c.name}</span>
                  {c.old_label ? <RiskChip label={c.old_label} size="sm" short /> : <span className="text-xs text-muted">no label</span>}
                  <Icons.ChevronRight size={14} className="text-muted" />
                  <RiskChip label={c.new_label} size="sm" short />
                </li>
              ))}
            </ul>
          )}
          {result.errors.length > 0 && (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-danger-700">Rejected rows ({result.errors.length})</summary>
              <ul className="mt-2 space-y-1">
                {result.errors.map((e, i) => (
                  <li key={i}>
                    <span className="font-mono text-xs text-muted">Row {e.row}</span> · {e.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="mt-4">
            <Button variant="secondary" onClick={() => reset()} icon={<Icons.Plus size={15} />}>
              Upload another file
            </Button>
          </div>
        </Card>
      )}

      <History classId={classId} version={version} />
    </div>
  );
}

