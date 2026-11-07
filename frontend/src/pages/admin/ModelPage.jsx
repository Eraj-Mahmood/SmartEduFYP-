import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LabelList } from "recharts";
import { PortalShell } from "../../components/Shell";
import { Card, StatCard, ChartCard, EmptyState, Skeleton, Button, Icons, RiskChip } from "../../components/ui";
import { axis, grid, TooltipBox } from "../../components/charts/theme";
import { colors } from "../../components/ui/tokens";
import { FEATURE_LABEL } from "../../components/WhatIfPanel";
import useApi from "../../lib/useApi";
import { timeAgo } from "../../lib/format";

// Model transparency: what the Random Forest is, what it learned to rely on, how often the policy
// check agrees, and how each prediction is made. Data: GET /admin/model.

const TOP_N = 10;
const pct = (x, d = 1) => (x == null ? "—" : `${(100 * x).toFixed(d)}%`);
const featureLabel = (f) => FEATURE_LABEL[f] || f.replace(/_/g, " ");

const STAGES = [
  {
    title: "Features",
    text: "The student's 20 inputs are built from their record, with this term's live marks and attendance replacing the imported values (provisional SGPA and projected CGPA are recomputed).",
  },
  {
    title: "Random Forest",
    text: "The trained scikit-learn Random Forest (300 trees) scores the 20 inputs and picks Safe, At-Risk or Dropout-Likely - this is the model label.",
  },
  {
    title: "SHAP reasons",
    text: "SHAP (TreeExplainer) measures how much each input pushed this prediction; the top drivers become the plain-language reasons people see.",
  },
  {
    title: "Policy check",
    text: "The institution's rules (CGPA, attendance thresholds) are checked. They can only escalate a label, never lower what the model said.",
  },
  {
    title: "Stored",
    text: "Model label, policy label, final label, drivers, the exact inputs and their sources are saved, so every prediction can be traced later.",
  },
];

function ImportanceChart({ features }) {
  const total = features.reduce((n, f) => n + f.mean_abs_shap, 0);
  const rows = features.slice(0, TOP_N).map((f) => ({ ...f, label: featureLabel(f.feature), share: total ? f.mean_abs_shap / total : 0 }));
  // even 10% ticks up to the first one above the largest share
  const top = Math.ceil((rows[0]?.share || 0.1) * 10) / 10;
  const ticks = Array.from({ length: Math.round(top * 10) + 1 }, (_, i) => i / 10);
  return (
    <ResponsiveContainer>
      <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }} barCategoryGap="22%">
        <CartesianGrid {...grid} horizontal={false} />
        <XAxis type="number" {...axis} tickFormatter={(v) => `${Math.round(v * 100)}%`} domain={[0, top]} ticks={ticks} />
        <YAxis type="category" dataKey="label" {...axis} width={128} interval={0} />
        <Tooltip
          cursor={{ fill: colors.brand[50] }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload;
            return (
              <TooltipBox
                title={d.label}
                rows={[
                  { label: "Share of total importance", value: pct(d.share) },
                  { label: "Mean |SHAP|", value: d.mean_abs_shap.toFixed(4) },
                ]}
              />
            );
          }}
        />
        <Bar dataKey="share" fill={colors.brand.DEFAULT} radius={[0, 4, 4, 0]} isAnimationActive={false}>
          <LabelList dataKey="share" position="right" formatter={(v) => (v >= 0.01 ? pct(v, 0) : "")} style={{ fontSize: 12, fill: colors.muted }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function AgreementMatrix({ agreement }) {
  const { labels, matrix } = agreement;
  return (
    <>
    <p className="text-xs text-muted mb-2">Rows: what the model said. Columns: what the policy rules say.</p>
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr>
            <th scope="col" className="text-left font-medium text-muted pb-1.5 pr-2">Model \ Policy</th>
            {labels.map((l) => (
              <th key={l} scope="col" className="text-right font-medium text-muted pb-1.5 px-2 whitespace-nowrap">
                {/* "Dropout-Likely" is shortened on phones so the table fits */}
                <span className="sm:hidden" aria-hidden="true">{l.replace("-Likely", "")}</span>
                <span className="hidden sm:inline">{l}</span>
                <span className="sr-only sm:hidden">{l}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((m, i) => (
            <tr key={m} className="border-t border-line">
              <th scope="row" className="text-left font-medium py-1.5 pr-2 whitespace-nowrap">{m}</th>
              {matrix[i].map((n, j) => (
                <td key={labels[j]} className={`text-right py-1.5 px-2 ${i === j ? "font-semibold text-ink" : n ? "text-risk-700 font-medium" : "text-muted"}`}>
                  {n.toLocaleString()}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

export default function ModelPage() {
  const { data, error, loading, reload } = useApi("/admin/model");

  if (error && !data) {
    return (
      <PortalShell>
        <Card>
          <EmptyState icon={<Icons.AlertOctagon size={22} />} message="We couldn't load the model details" detail={error} action={<Button variant="secondary" onClick={() => reload()}>Try again</Button>} />
        </Card>
      </PortalShell>
    );
  }

  const m = data?.model;
  const s = data?.stats;
  const imp = m?.global_importance;
  const total = s?.students_with_prediction || 0;
  const fromModel = s?.source?.model || 0;
  const met = m?.metrics || {};

  return (
    <PortalShell>
      <div className="mb-5">
        <h1 className="font-display text-2xl sm:text-[28px] leading-tight">The prediction model</h1>
        <p className="text-sm text-muted mt-1">Every risk label comes from a trained Random Forest, explained with SHAP and checked against the institution's policy.</p>
      </div>

      {loading && !data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-64" rounded="rounded-card" />)}
        </div>
      ) : (
        <>
          {!data.ml_online && (
            <div role="status" className="mb-4 flex items-start gap-2 rounded-card border border-risk-500/40 bg-risk-50 px-4 py-3 text-sm text-risk-700">
              <Icons.Warning size={18} className="shrink-0 mt-0.5" />
              The ML service is offline. New predictions use the rule estimate until it is back; the statistics below still come from the stored predictions.
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4">
            <StatCard label="From the model" value={pct(total ? fromModel / total : null)} sublabel={`${fromModel.toLocaleString()} of ${total.toLocaleString()} latest predictions`} tone="brand" />
            <StatCard label="Rule estimates" value={(s.source.fallback || 0).toLocaleString()} sublabel="ML service was offline" tone={s.source.fallback ? "risk" : undefined} />
            <StatCard label="Model and policy agree" value={pct(s.agreement.rate, 2)} sublabel={`${s.agreement.agree.toLocaleString()} of ${s.agreement.compared.toLocaleString()}`} />
            <StatCard label="Raised by the policy" value={s.escalated.count.toLocaleString()} sublabel={`${pct(s.escalated.rate, 2)} of model predictions`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2 mb-4">
            <Card title="Model card" subtitle={m ? m.model_name : "ML service offline"}>
              {m ? (
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted">Type</dt>
                  <dd>{m.model_type} · {m.n_estimators} trees · max depth {m.max_depth}</dd>
                  <dt className="text-muted">Version</dt>
                  <dd className="break-words">{m.model_version}</dd>
                  <dt className="text-muted">Library</dt>
                  <dd>scikit-learn {m.sklearn_version}{m.sklearn_version_pickled && m.sklearn_version_pickled !== m.sklearn_version ? ` (pickled with ${m.sklearn_version_pickled})` : ""}</dd>
                  <dt className="text-muted">Classes</dt>
                  <dd className="flex flex-wrap gap-1.5">{m.class_labels.map((l) => <RiskChip key={l} label={l} size="sm" />)}</dd>
                  <dt className="text-muted">Metrics</dt>
                  <dd>
                    CV macro F1 <strong className="tabular-nums">{met.cross_validation_macro_f1?.toFixed(4)}</strong> · test macro F1{" "}
                    <strong className="tabular-nums">{met.test_macro_f1?.toFixed(4)}</strong> · test accuracy <strong className="tabular-nums">{met.test_accuracy?.toFixed(4)}</strong>
                  </dd>
                  <dt className="text-muted">Trained on</dt>
                  <dd>{met.dataset_type || "—"}</dd>
                  <dt className="text-muted">Features ({m.n_features})</dt>
                  <dd className="flex flex-wrap gap-1">
                    {m.feature_names.map((f) => (
                      <span key={f} className="rounded bg-ink/[0.05] px-1.5 py-0.5 font-mono text-[11px] text-ink/80">{f}</span>
                    ))}
                  </dd>
                </dl>
              ) : (
                <p className="text-sm text-muted">Start the ML service to see the model card.</p>
              )}
            </Card>

            <ChartCard
              title="What the model relies on"
              subtitle={`Share of global importance, top ${TOP_N} of 20 features`}
              height={340}
              empty={!imp}
              emptyMessage="Importance not available"
              emptyDetail="The ML service is offline or has no dataset to sample."
              footer={imp && `Mean |SHAP| per feature over a fixed sample of ${imp.sample.rows.toLocaleString()} dataset rows (seed ${imp.sample.random_state}), averaged over the 3 classes. The other ${imp.features.length - TOP_N} features add up to ${pct(imp.features.slice(TOP_N).reduce((n, f) => n + f.mean_abs_shap, 0) / imp.features.reduce((n, f) => n + f.mean_abs_shap, 0))}.`}
            >
              {imp && <ImportanceChart features={imp.features} />}
            </ChartCard>
          </div>

          <Card title="How a prediction is made" className="mb-4">
            <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {STAGES.map((st, i) => (
                <li key={st.title} className="rounded-lg border border-line bg-paper/60 p-3">
                  <div className="flex items-center gap-2">
                    <span className="h-6 w-6 shrink-0 rounded-full bg-brand text-white text-xs font-semibold flex items-center justify-center" aria-hidden="true">{i + 1}</span>
                    <h3 className="text-sm font-semibold text-ink">{st.title}</h3>
                  </div>
                  <p className="mt-2 text-[13px] leading-snug text-ink/80">{st.text}</p>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-muted">If the ML service is unreachable, step 2 is replaced by the policy rules and the prediction is marked "Rule estimate".</p>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2 mb-4">
            <Card title="Model vs policy" subtitle="Latest prediction per student, model predictions only">
              <AgreementMatrix agreement={s.agreement} />
              <p className="mt-3 text-sm text-ink/90">
                {s.escalated.count
                  ? `The policy raised ${s.escalated.count.toLocaleString()} label(s): ${Object.entries(s.escalated.by_change).map(([k, n]) => `${k} (${n})`).join(", ")}.`
                  : "The policy has not had to raise any current label: every final label is the model's own."}
                {" "}Off-diagonal cells where the model is more severe keep the model's label.
              </p>
            </Card>
            <Card title="Current labels and last run">
              <ul className="space-y-2 text-sm">
                {Object.entries(s.label_distribution).map(([l, n]) => (
                  <li key={l} className="flex items-center gap-3">
                    <RiskChip label={l} size="sm" />
                    <span className="ml-auto font-semibold tabular-nums">{n.toLocaleString()}</span>
                    <span className="w-14 text-right text-muted tabular-nums">{pct(total ? n / total : null)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 pt-3 border-t border-line text-sm text-muted">
                {s.last_run
                  ? `Last batch run #${s.last_run.id} (${s.last_run.scope}): ${s.last_run.status}, ${s.last_run.done.toLocaleString()} students in ${s.last_run.duration_seconds}s, ${timeAgo(s.last_run.finished_at || s.last_run.started_at)}.`
                  : "No batch run yet."}
              </p>
            </Card>
          </div>

          <section aria-labelledby="limits-heading" className="rounded-card border border-risk-500/40 bg-risk-50/60 px-5 py-4">
            <h2 id="limits-heading" className="font-display text-[17px] text-ink flex items-center gap-2">
              <Icons.Info size={18} className="text-risk-700" /> Limitations
            </h2>
            <ul className="mt-2 space-y-1.5 text-sm text-ink/90 list-disc pl-5">
              {data.limitations.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </section>
        </>
      )}
    </PortalShell>
  );
}
