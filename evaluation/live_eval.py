"""Live-data evaluation (Objective 7): how the model does on students imported as a live cohort.

    python evaluation/live_eval.py [--dsn postgresql://...]      (default: DATABASE_URL in backend/.env)
    one-time: python -m pip install -r evaluation/requirements.txt

Reads every live student's (students.data_source = 'live') LATEST prediction from the database and
writes docs/live_eval.md and docs/live_eval_confusion.png:
  - sample size, data source (real or SYNTHETIC) and which upload files the students came from
  - label distribution, model vs fallback, model vs policy agreement, policy escalations
  - confusion matrix and per-class precision / recall / F1 against actual_outcome (the institution's
    recorded outcome) where present; otherwise against the institutional policy label, said clearly
  - every disagreement with its top SHAP drivers and which inputs were live / missing
A cohort is reported as SYNTHETIC when its roll numbers start with SYN- (evaluation/sample_live_cohort.csv).
"""
import argparse
import json
import re
from datetime import datetime
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import psycopg2  # noqa: E402
import psycopg2.extras  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
LABELS = ["Safe", "At-Risk", "Dropout-Likely"]
OUTCOME_TO_LABEL = {"safe": "Safe", "at_risk": "At-Risk", "dropout": "Dropout-Likely"}
SYNTHETIC_PREFIX = "SYN-"

QUERY = """
SELECT s.student_id, s.roll_no, s.full_name, s.actual_outcome,
       p.final_label, p.model_label, p.policy_label, p.policy_reason, p.source, p.model_version,
       p.drivers, p.features, p.feature_sources, p.triggered_by, p.created_at,
       (SELECT u.filename FROM student_semester_performance sp JOIN uploads u ON u.id = sp.upload_id
         WHERE sp.student_id = s.student_id ORDER BY sp.semester DESC LIMIT 1) AS cohort_file
FROM students s
LEFT JOIN predictions p ON p.prediction_id = s.latest_prediction_id
WHERE s.data_source = 'live'
ORDER BY s.roll_no
"""


def dsn_from_env():
    env = ROOT / "backend" / ".env"
    for line in env.read_text(encoding="utf-8").splitlines():
        m = re.match(r"\s*DATABASE_URL\s*=\s*(\S+)", line)
        if m:
            return m.group(1)
    raise SystemExit("No --dsn given and no DATABASE_URL in backend/.env")


def confusion(truth, pred):
    m = [[0] * 3 for _ in LABELS]
    for t, p in zip(truth, pred):
        m[LABELS.index(t)][LABELS.index(p)] += 1
    return m


def per_class(m):
    out = {}
    for i, lab in enumerate(LABELS):
        tp = m[i][i]
        fp = sum(m[r][i] for r in range(3)) - tp
        fn = sum(m[i]) - tp
        prec = tp / (tp + fp) if tp + fp else None
        rec = tp / (tp + fn) if tp + fn else None
        f1 = 2 * prec * rec / (prec + rec) if prec and rec else (0.0 if prec is not None and rec is not None else None)
        out[lab] = {"precision": prec, "recall": rec, "f1": f1, "support": sum(m[i])}
    return out


def fmt(x, d=3):
    return "—" if x is None else f"{x:.{d}f}"


def plot_confusion(m, title, truth_name, path):
    fig, ax = plt.subplots(figsize=(5.2, 4.4), dpi=150)
    ax.imshow(m, cmap="Blues")
    ax.set_xticks(range(3), LABELS)
    ax.set_yticks(range(3), LABELS)
    ax.set_xlabel("Predicted (final label)")
    ax.set_ylabel(truth_name)
    vmax = max(max(r) for r in m) or 1
    for i in range(3):
        for j in range(3):
            ax.text(j, i, m[i][j], ha="center", va="center", color="white" if m[i][j] > vmax / 2 else "#101826", fontsize=13)
    ax.set_title(title, fontsize=10)
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dsn", default=None)
    args = ap.parse_args()

    with psycopg2.connect(args.dsn or dsn_from_env()) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(QUERY)
        rows = cur.fetchall()
        cur.execute("SELECT COUNT(*) AS n FROM students WHERE data_source = 'live'")

    DOCS.mkdir(exist_ok=True)
    md_path, png_path = DOCS / "live_eval.md", DOCS / "live_eval_confusion.png"
    n_all = len(rows)
    rows = [r for r in rows if r["final_label"]]
    n = len(rows)
    synthetic = n > 0 and all(r["roll_no"].upper().startswith(SYNTHETIC_PREFIX) for r in rows)
    mixed = any(r["roll_no"].upper().startswith(SYNTHETIC_PREFIX) for r in rows) and not synthetic
    source = ("SYNTHETIC sample (evaluation/sample_live_cohort.csv) - NOT real student data" if synthetic
              else "MIXED: real and SYNTHETIC rows" if mixed else "REAL live cohort")
    files = sorted({r["cohort_file"] or "(unknown)" for r in rows})

    L = []
    w = L.append
    w("# Live-data evaluation")
    w("")
    w(f"Generated {datetime.now():%Y-%m-%d %H:%M} by `evaluation/live_eval.py`.")
    w("")
    w(f"> **Data source: {source}.** Cohort file(s): {', '.join(f'`{f}`' for f in files)}.")
    if synthetic:
        w("> These 30 students were drawn from the synthetic training dataset (stratified 10 per label), because no real")
        w("> classroom file exists yet. The model's train/test split was not saved, so they are probably rows the model")
        w("> was trained on, and their \"actual outcome\" is the dataset's policy-derived label. **These numbers test the")
        w("> live-data pipeline end to end; they say nothing about accuracy on real students.**")
    w("")
    if not n:
        w("No live students with a prediction yet. Import a cohort and run predictions for its class first.")
        md_path.write_text("\n".join(L) + "\n", encoding="utf-8")
        print(f"No live predictions ({n_all} live students). Wrote {md_path}")
        return

    # --- overview
    dist = {lab: sum(r["final_label"] == lab for r in rows) for lab in LABELS}
    by_source = {s: sum(r["source"] == s for r in rows) for s in ("model", "fallback")}
    model_rows = [r for r in rows if r["source"] == "model"]
    agree = sum(r["model_label"] == r["policy_label"] for r in model_rows)
    escalated = [r for r in model_rows if r["final_label"] != r["model_label"]]
    live_inputs = {}
    missing_inputs = {}
    for r in rows:
        for k, v in (r["feature_sources"] or {}).items():
            live_inputs[k] = live_inputs.get(k, 0) + 1
        for k, v in (r["features"] or {}).items():
            if v is None:
                missing_inputs[k] = missing_inputs.get(k, 0) + 1

    w("## Overview")
    w("")
    w(f"- Sample size: **{n}** live students with a prediction ({n_all} live students in total).")
    w(f"- Prediction source: model {by_source['model']}, rule fallback {by_source['fallback']}.")
    w("- Final labels: " + ", ".join(f"{lab} {dist[lab]}" for lab in LABELS) + ".")
    if model_rows:
        w(f"- Model vs policy agreement: **{agree}/{len(model_rows)} ({agree / len(model_rows):.1%})**; "
          f"the policy raised {len(escalated)} label(s).")
    w("- Inputs taken from live data (per student): " + (", ".join(f"{k} {v}" for k, v in sorted(live_inputs.items())) or "none") + ".")
    w("- Inputs missing in the cohort file (imputed by the pipeline - median / most frequent of the training data): "
      + (", ".join(f"{k} {v}" for k, v in sorted(missing_inputs.items())) or "none") + ".")
    w("")

    # --- against what
    with_outcome = [r for r in rows if r["actual_outcome"] in OUTCOME_TO_LABEL]
    if with_outcome:
        truth_name = "Actual outcome (institution record)"
        if synthetic:
            truth_name = "Actual outcome (SYNTHETIC: dataset label)"
        eval_rows = with_outcome
        truth = [OUTCOME_TO_LABEL[r["actual_outcome"]] for r in eval_rows]
        basis = (f"`actual_outcome` from the cohort file, present for {len(eval_rows)} of {n} students"
                 + (" (unknown / blank excluded)" if len(eval_rows) < n else ""))
        if synthetic:
            basis += ". For this SYNTHETIC sample it is the dataset's policy-derived Target_Label, not an observed outcome"
    else:
        truth_name = "Institutional policy label"
        eval_rows = rows
        truth = [r["policy_label"] for r in eval_rows]
        basis = ("**the institutional policy label** (policy.json rules) - the cohort file has no `actual_outcome`. "
                 "This measures agreement with the institution's rules, NOT accuracy against real outcomes")
    pred = [r["final_label"] for r in eval_rows]
    m = confusion(truth, pred)
    pc = per_class(m)
    acc = sum(m[i][i] for i in range(3)) / len(eval_rows)
    f1s = [pc[lab]["f1"] for lab in LABELS if pc[lab]["support"]]
    macro = sum(f1s) / len(f1s) if f1s else None
    model_acc = None
    if eval_rows and all(r["source"] == "model" for r in eval_rows):
        model_acc = sum(r["model_label"] == t for r, t in zip(eval_rows, truth)) / len(eval_rows)

    w("## Confusion matrix and per-class scores")
    w("")
    w(f"Compared against {basis}.")
    w("")
    w("| truth \\ predicted | " + " | ".join(LABELS) + " |")
    w("|---|" + "---:|" * 3)
    for i, lab in enumerate(LABELS):
        w(f"| **{lab}** | " + " | ".join(str(x) for x in m[i]) + " |")
    w("")
    w("| class | precision | recall | F1 | support |")
    w("|---|---:|---:|---:|---:|")
    for lab in LABELS:
        s = pc[lab]
        w(f"| {lab} | {fmt(s['precision'])} | {fmt(s['recall'])} | {fmt(s['f1'])} | {s['support']} |")
    w("")
    w(f"Accuracy (final label) **{acc:.3f}**, macro F1 **{fmt(macro)}**"
      + (f"; model label alone: accuracy {model_acc:.3f}" if model_acc is not None else "") + ".")
    w("")
    w(f"![Confusion matrix]({png_path.name})")
    w("")
    title = "Live cohort: final label vs " + ("actual outcome" if with_outcome else "policy label")
    if synthetic:
        title += "\n(SYNTHETIC sample, not real students)"
    plot_confusion(m, title, truth_name, png_path)

    # --- disagreements
    w("## Disagreements")
    w("")
    wrong = [(r, t) for r, t in zip(eval_rows, truth) if r["final_label"] != t]
    if not wrong:
        w("None: every final label matches. (On a synthetic sample drawn from the training data this is expected.)")
    else:
        w("| roll no | truth | final | model | policy | top drivers (SHAP) | live inputs |")
        w("|---|---|---|---|---|---|---|")
        for r, t in wrong:
            drv = "; ".join(f"{d['feature']}={d['value']} ({'↑' if d['direction'] == 'raises_risk' else '↓'})"
                            for d in (r["drivers"] or [])[:3]) or "rule estimate"
            srcs = ", ".join(sorted((r["feature_sources"] or {}).keys())) or "—"
            w(f"| {r['roll_no']} | {t} | {r['final_label']} | {r['model_label']} | {r['policy_label']} | {drv} | {srcs} |")
    w("")
    split = [r for r in model_rows if r["model_label"] != r["policy_label"]]
    w("### Model vs policy")
    w("")
    if not split:
        w("The model and the policy rules agree for every live student.")
    else:
        w("Students where the model and the institution's rules disagree (the final label is the more severe of the two):")
        w("")
        w("| roll no | model | policy | final | truth | top drivers (SHAP) |")
        w("|---|---|---|---|---|---|")
        truth_by = {r["roll_no"]: t for r, t in zip(eval_rows, truth)}
        for r in split:
            drv = "; ".join(f"{d['feature']}={d['value']} ({'↑' if d['direction'] == 'raises_risk' else '↓'})"
                            for d in (r["drivers"] or [])[:3]) or "rule estimate"
            w(f"| {r['roll_no']} | {r['model_label']} | {r['policy_label']} | {r['final_label']} | {truth_by.get(r['roll_no'], '—')} | {drv} |")
    w("")
    if escalated:
        w("Labels the policy raised: " + ", ".join(f"{r['roll_no']} ({r['model_label']} → {r['final_label']}: {r['policy_reason']})" for r in escalated) + ".")
        w("")

    # --- limits
    w("## Limits")
    w("")
    if synthetic:
        w("- **Synthetic, not real:** the rows come from the dataset the model was trained on and the \"actual\" labels are")
        w("  the dataset's policy-derived labels, so a near-perfect score is expected and proves only that import →")
        w("  features → imputation → model → policy → storage works.")
    w(f"- Small sample: {len(eval_rows)} students; one student moves a per-class score by several points.")
    w("- Missing inputs are imputed with training-data medians / most frequent values, which can hide real differences.")
    w("- Labels are a point-in-time early warning; a real evaluation needs outcomes recorded later (did the student")
    w("  actually drop out or fall below 2.00?), collected with consent and the institution's approval.")
    w("- The model was trained on synthetic, policy-labelled data; on real data expect lower scores (the notebook's")
    w("  early-warning benchmark macro F1 is 0.934).")
    md_path.write_text("\n".join(L) + "\n", encoding="utf-8")

    print(f"Data source: {source}")
    print(f"Sample size {n}; final labels {dist}; model {by_source['model']} / fallback {by_source['fallback']}")
    if model_rows:
        print(f"Model vs policy agreement {agree}/{len(model_rows)}; escalated {len(escalated)}")
    print(f"Against {'actual_outcome' if with_outcome else 'POLICY LABEL'}: accuracy {acc:.3f}, macro F1 {fmt(macro)}; disagreements {len(wrong)}")
    print(f"Wrote {md_path} and {png_path}")


if __name__ == "__main__":
    main()
