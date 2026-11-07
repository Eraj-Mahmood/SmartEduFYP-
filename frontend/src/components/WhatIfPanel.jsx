import { useEffect, useRef, useState } from "react";
import client from "../api/client";
import { RiskChip, PredictionSource, Button, EmptyState, Icons, SkeletonText } from "./ui";
import { gpa } from "../lib/format";

// "What if?" simulator for staff (POST <endpoint> {overrides}). Moves this term's numbers with
// sliders and shows what the trained model + policy would say. Nothing is saved.

const FIELDS = [
  { key: "Attendance_Percentage", label: "Attendance", unit: "%" },
  { key: "Assignment_Avg", label: "Assignment average" },
  { key: "Quiz_Avg", label: "Quiz average" },
  { key: "Midterm_Marks", label: "Midterm" },
  { key: "Final_Marks", label: "Final" },
];

export const FEATURE_LABEL = {
  Attendance_Percentage: "Attendance",
  Assignment_Avg: "Assignment average",
  Quiz_Avg: "Quiz average",
  Midterm_Marks: "Midterm",
  Final_Marks: "Final",
  Previous_SGPA: "Previous SGPA",
  SGPA: "SGPA (this term)",
  CGPA: "CGPA",
  Assignment_Submission_Rate: "Submission rate",
  Failed_Courses: "Failed courses",
  Study_Hours_Per_Week: "Study hours / week",
  LMS_Login_Count: "LMS logins",
  Credits_Enrolled: "Credits enrolled",
  Credits_Passed: "Credits passed",
};
const featureLabel = (f) => FEATURE_LABEL[f] || f.replace(/_/g, " ");
const fmtValue = (f, v) => (v == null ? "—" : ["CGPA", "SGPA", "Previous_SGPA"].includes(f) ? gpa(v) : `${Math.round(Number(v) * 10) / 10}${f.endsWith("Percentage") || f.endsWith("Rate") ? "%" : ""}`);

function Drivers({ drivers }) {
  if (!drivers?.length) return <p className="text-sm text-muted">No model drivers - this is a rule estimate.</p>;
  const max = Math.max(...drivers.map((d) => Math.abs(d.shap)));
  return (
    <ul className="space-y-1.5">
      {drivers.map((d) => {
        const up = d.direction === "raises_risk";
        return (
          <li key={d.feature} className="grid grid-cols-[minmax(0,1fr)_72px_88px] items-center gap-2 text-sm">
            <span className="truncate">
              {featureLabel(d.feature)} <span className="text-muted tabular-nums">{fmtValue(d.feature, d.value)}</span>
            </span>
            <span className="h-1.5 rounded-full bg-ink/[0.06] overflow-hidden" aria-hidden="true">
              <span className={`block h-full rounded-full ${up ? "bg-danger" : "bg-safe"}`} style={{ width: `${Math.max(6, (100 * Math.abs(d.shap)) / max)}%` }} />
            </span>
            <span className={`text-xs font-medium ${up ? "text-danger-700" : "text-safe-700"}`}>{up ? "↑ raises risk" : "↓ lowers risk"}</span>
          </li>
        );
      })}
    </ul>
  );
}

export default function WhatIfPanel({ endpoint }) {
  const [base, setBase] = useState(null); // first response: today's inputs scored now
  const [values, setValues] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const reqId = useRef(0);
  const timer = useRef(null);

  async function run(overrides) {
    const id = ++reqId.current;
    setBusy(true);
    setError(null);
    try {
      const { data } = await client.post(endpoint, { overrides });
      if (id !== reqId.current) return null;
      setResult(data);
      return data;
    } catch (e) {
      if (id === reqId.current) setError(e.response?.data?.error || "Could not run the simulation");
      return null;
    } finally {
      if (id === reqId.current) setBusy(false);
    }
  }

  useEffect(() => {
    setBase(null);
    setResult(null);
    run({}).then((d) => {
      if (!d) return;
      setBase(d);
      setValues(Object.fromEntries(FIELDS.map((f) => [f.key, Math.round(d.inputs.before[f.key] ?? 0)])));
    });
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);

  function change(key, v) {
    const next = { ...values, [key]: Number(v) };
    setValues(next);
    clearTimeout(timer.current);
    const overrides = Object.fromEntries(FIELDS.filter((f) => next[f.key] !== Math.round(base.inputs.before[f.key] ?? 0)).map((f) => [f.key, next[f.key]]));
    timer.current = setTimeout(() => run(overrides), 300);
  }

  function reset() {
    clearTimeout(timer.current);
    setValues(Object.fromEntries(FIELDS.map((f) => [f.key, Math.round(base.inputs.before[f.key] ?? 0)])));
    run({});
  }

  if (error && !base) return <EmptyState icon={<Icons.AlertOctagon size={22} />} message="Couldn't start the simulator" detail={error} compact />;
  if (!base) return <SkeletonText lines={8} />;

  const r = result || base;
  const s = r.scenario;
  const changed = r.baseline.final_label !== s.final_label;
  const moved = ["SGPA", "CGPA"].filter((k) => r.inputs.after[k] !== r.inputs.before[k]);

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        Move this term's numbers to see what the trained model and the policy check would say. <strong className="text-ink">Nothing is saved.</strong>
      </p>

      <section className={`rounded-card border p-4 ${changed ? "border-brand bg-brand-50/50" : "border-line bg-surface"}`} aria-live="polite" aria-busy={busy}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted w-full">Today → what if</span>
          <RiskChip label={r.baseline.final_label} size="sm" />
          <Icons.ChevronRight size={16} className="text-muted" />
          <RiskChip label={s.final_label} />
          {busy && <span className="text-xs text-muted">updating…</span>}
        </div>
        <p className="mt-2 text-sm font-medium text-ink">{changed ? "The label would change." : "The label would stay the same."}</p>
        <PredictionSource className="mt-2" source={s.source} modelLabel={s.model_label} finalLabel={s.final_label} staff />
        {moved.length > 0 && (
          <p className="mt-2 text-xs text-muted">
            {moved.map((k) => `${k === "CGPA" ? "Projected CGPA" : "Provisional SGPA"} ${gpa(r.inputs.before[k])} → ${gpa(r.inputs.after[k])}`).join(" · ")}
          </p>
        )}
        {error && <p className="mt-2 text-xs text-danger-700">{error}</p>}
      </section>

      <section className="space-y-3.5">
        {FIELDS.map((f) => {
          const id = `whatif-${f.key}`;
          const today = Math.round(base.inputs.before[f.key] ?? 0);
          return (
            <div key={f.key}>
              <div className="flex items-baseline justify-between text-sm">
                <label htmlFor={id} className="font-medium text-ink">
                  {f.label}
                </label>
                <span className="tabular-nums">
                  <strong>{values[f.key]}{f.unit || ""}</strong>
                  {values[f.key] !== today && <span className="text-xs text-muted"> (today {today}{f.unit || ""})</span>}
                </span>
              </div>
              <input id={id} type="range" min="0" max="100" step="1" value={values[f.key] ?? 0} onChange={(e) => change(f.key, e.target.value)} className="w-full accent-brand" />
            </div>
          );
        })}
        <Button size="sm" variant="secondary" onClick={reset} icon={<Icons.Refresh size={14} />}>
          Back to today's numbers
        </Button>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink mb-2">What drives this result (SHAP, top 5)</h3>
        <Drivers drivers={s.drivers} />
      </section>

      {s.reasons?.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-ink mb-1.5">Reasons</h3>
          <ul className="space-y-1 text-sm text-ink/90 list-disc pl-5">
            {s.reasons.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          {s.policy_reason && <p className="mt-2 text-xs text-muted">Policy: {s.policy_reason}</p>}
        </section>
      )}
    </div>
  );
}
