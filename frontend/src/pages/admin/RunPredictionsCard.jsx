import { useEffect, useRef, useState } from "react";
import client from "../../api/client";
import { Card, Button, useToast, Icons } from "../../components/ui";
import useApi from "../../lib/useApi";

const SCOPES = [
  { key: "all", label: "Everyone" },
  { key: "department", label: "Department" },
  { key: "class", label: "Class" },
];

function Progress({ run }) {
  const processed = run.done + run.failed;
  const pctDone = run.total ? Math.round((100 * processed) / run.total) : 100;
  const running = run.status === "running" || run.status === "queued";
  const elapsed = Math.max(0, Math.round(((run.finished_at ? new Date(run.finished_at) : new Date()) - new Date(run.started_at)) / 1000));
  return (
    <div className="mt-4 rounded-lg border border-line bg-paper/60 p-4" aria-live="polite">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium inline-flex items-center gap-1.5">
          {running ? (
            <span className="h-3.5 w-3.5 rounded-full border-2 border-brand border-r-transparent animate-spin" aria-hidden="true" />
          ) : run.status === "completed" ? (
            <Icons.CheckCircle size={16} className="text-safe-700" />
          ) : (
            <Icons.AlertOctagon size={16} className="text-danger-700" />
          )}
          Run #{run.id} · {running ? "running" : run.status}
        </span>
        <span className="text-muted tabular-nums">{elapsed}s</span>
      </div>
      <div
        className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-ink/[0.07]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pctDone}
        aria-label="Prediction run progress"
      >
        <div className={`h-full rounded-full transition-all duration-500 ${run.status === "failed" ? "bg-danger" : "bg-brand"}`} style={{ width: `${pctDone}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted tabular-nums">
        <span>
          <span className="font-semibold text-ink">{pctDone}%</span> · {processed.toLocaleString()} of {run.total.toLocaleString()}
        </span>
        <span>
          <span className="font-semibold text-safe-700">{run.done.toLocaleString()}</span> done
        </span>
        <span>
          <span className={`font-semibold ${run.failed ? "text-danger-700" : "text-ink"}`}>{run.failed.toLocaleString()}</span> failed
        </span>
      </div>
      {run.error && <p className="mt-2 text-xs text-danger-700">{run.error}</p>}
    </div>
  );
}

/** Start a batch prediction run and follow its progress. Calls onFinished() when it ends. */
export default function RunPredictionsCard({ activeRun, onFinished }) {
  const { toast } = useToast();
  const departments = useApi("/admin/departments");
  const classes = useApi("/admin/faculty-courses");
  const [scope, setScope] = useState("department");
  const [scopeId, setScopeId] = useState("");
  const [run, setRun] = useState(null);
  const [starting, setStarting] = useState(false);
  const timer = useRef(null);
  const finished = useRef(null); // run id already reported (polls can overlap)

  function follow(id) {
    clearInterval(timer.current);
    const tick = async () => {
      try {
        const { data } = await client.get(`/admin/predictions/runs/${id}`);
        if (finished.current === id) return;
        setRun(data);
        if (data.status === "completed" || data.status === "failed") {
          clearInterval(timer.current);
          finished.current = id;
          toast(`${data.done.toLocaleString()} predicted, ${data.failed.toLocaleString()} failed`, {
            type: data.status === "completed" ? "success" : "error",
            title: `Run #${data.id} ${data.status}`,
          });
          onFinished?.();
        }
      } catch {
        clearInterval(timer.current);
      }
    };
    tick();
    timer.current = setInterval(tick, 1000);
  }

  // Pick up a run that is already in progress (e.g. after a page reload)
  useEffect(() => {
    if (activeRun && (activeRun.status === "running" || activeRun.status === "queued") && run?.id !== activeRun.id) follow(activeRun.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRun?.id, activeRun?.status]);
  useEffect(() => () => clearInterval(timer.current), []);

  async function start() {
    setStarting(true);
    try {
      const body = scope === "all" ? { scope } : { scope, scopeId: Number(scopeId) };
      const { data } = await client.post("/admin/predictions/run", body);
      setRun(data);
      follow(data.id);
    } catch (e) {
      toast(e.response?.data?.error || "Could not start the run", { type: "error" });
    } finally {
      setStarting(false);
    }
  }

  const running = run && (run.status === "running" || run.status === "queued");
  const options =
    scope === "department"
      ? (departments.data || []).map((d) => ({ value: d.department_id, label: d.name }))
      : (classes.data || [])
          .filter((c) => Number(c.enrolled_count) > 0)
          .map((c) => ({ value: c.faculty_course_id, label: `${c.course_code} ${c.section} · ${c.title} (${c.enrolled_count})` }));

  return (
    <Card title="Run predictions" subtitle="Re-score students from their latest marks and attendance">
      <div className="flex flex-col gap-3">
        <div role="radiogroup" aria-label="Who to re-score" className="inline-flex self-start rounded-lg bg-ink/[0.05] p-1">
          {SCOPES.map((s) => (
            <button
              key={s.key}
              type="button"
              role="radio"
              aria-checked={scope === s.key}
              onClick={() => {
                setScope(s.key);
                setScopeId("");
              }}
              className={`rounded-md px-3 py-1.5 text-sm transition ${scope === s.key ? "bg-surface shadow-card font-medium" : "text-muted hover:text-ink"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        {scope !== "all" && (
          <label className="block">
            <span className="sr-only">{scope === "department" ? "Department" : "Class"}</span>
            <select value={scopeId} onChange={(e) => setScopeId(e.target.value)} className="field">
              <option value="">{scope === "department" ? "Choose a department" : "Choose a class"}</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {scope === "all" && <p className="text-xs text-muted">All 50,000 students - takes about 3 minutes.</p>}
        <Button onClick={start} loading={starting} disabled={running || (scope !== "all" && !scopeId)} icon={<Icons.Play size={14} />} className="self-start">
          {running ? "Run in progress" : "Start run"}
        </Button>
      </div>
      {run && <Progress run={run} />}
    </Card>
  );
}
