import { riskMeta } from "./risk";
import { ChartIcon, Warning } from "./icons";

/**
 * Where a prediction came from: the trained Random Forest, or the rule estimate used while the
 * ML service was offline. staff + modelLabel: also says when the policy raised the model's label.
 *   <PredictionSource source="model" />
 *   <PredictionSource source="model" modelLabel="At-Risk" finalLabel="Dropout-Likely" staff />
 */
export default function PredictionSource({ source, modelLabel, finalLabel, staff = false, compact = false, className = "" }) {
  if (!source) return null;
  const model = source === "model";
  const raised = staff && modelLabel && finalLabel && modelLabel !== finalLabel;
  if (compact) {
    // one line for dense tables: "RF model" / "Rule estimate", plus "model: X" when the policy raised it
    return (
      <span className={`block text-[11px] leading-tight ${model ? "text-muted" : "text-risk-700 font-medium"} ${className}`}>
        {model ? "RF model" : "Rule estimate (ML offline)"}
        {raised && <span className="text-muted"> · model: {riskMeta(modelLabel).short}</span>}
      </span>
    );
  }
  return (
    <span className={`inline-flex flex-col items-start gap-1 ${className}`}>
      <span
        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
          model ? "bg-brand-50 text-brand-dark ring-brand/20" : "bg-risk-50 text-risk-700 ring-risk-500/35"
        }`}
        title={
          model
            ? "Predicted by the trained Random Forest model (scikit-learn), explained with SHAP"
            : "The ML service was offline, so the institutional policy rules estimated this label"
        }
      >
        {model ? <ChartIcon size={12} /> : <Warning size={12} />}
        {model ? "Random Forest model" : "Rule estimate - ML service offline"}
      </span>
      {raised && (
        <span className="text-[11px] text-muted leading-snug">
          Model said {riskMeta(modelLabel).formal}; the policy check raised it to {riskMeta(finalLabel).formal}.
        </span>
      )}
    </span>
  );
}
