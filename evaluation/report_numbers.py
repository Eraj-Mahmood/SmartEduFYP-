"""Prints the numbers docs/REPORT_EVIDENCE.md quotes, each from its source (read-only).

    ml_service\\.venv\\Scripts\\python evaluation/report_numbers.py

- model metrics: the metadata stored in ml_service/smartedu_random_forest_version_a.pkl;
- predictions: every student's latest prediction in the database (DATABASE_URL from backend/.env);
- global importance: GET <ML>/model-info (the running ML service).
Runs with the ML service's venv (joblib + scikit-learn 1.9.0 to unpickle) plus psycopg2 from the
system Python's site-packages if the venv lacks it.
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PKL = ROOT / "ml_service" / "smartedu_random_forest_version_a.pkl"


def env(key):
    for line in (ROOT / "backend" / ".env").read_text(encoding="utf8").splitlines():
        m = re.match(rf"^{key}=(.*)$", line.strip())
        if m:
            return m.group(1).strip()
    return None


def section(title):
    print(f"\n## {title}")


def model_metrics():
    import joblib

    bundle = joblib.load(PKL)
    section("Model (.pkl metadata)")
    print("model_name:", bundle.get("model_name"), "| version:", bundle.get("model_version"))
    print("feature_names:", len(bundle["feature_names"]), "| classes:", list(bundle["target_classes"]))
    pipe = bundle["pipeline"]
    rf = pipe.steps[-1][1] if hasattr(pipe, "steps") else pipe
    print("estimator:", type(rf).__name__, "| n_estimators:", getattr(rf, "n_estimators", None), "| max_depth:", getattr(rf, "max_depth", None))
    print("sklearn pickled:", rf.__getstate__().get("_sklearn_version"))
    for k, v in bundle.items():
        if k not in ("pipeline", "feature_names", "target_classes") and not hasattr(v, "predict"):
            text = json.dumps(v, default=str)
            print(f"{k}: {text[:600]}")


def db_stats():
    try:
        import psycopg2
    except ImportError:
        sys.path.append(str(Path(sys.base_prefix).parent / "Python313" / "Lib" / "site-packages"))
        import psycopg2
    conn = psycopg2.connect(env("DATABASE_URL"))
    cur = conn.cursor()
    latest = "FROM students s JOIN predictions p ON p.prediction_id = s.latest_prediction_id"
    section("Latest prediction per student")
    cur.execute(f"SELECT p.final_label, COUNT(*) {latest} GROUP BY 1 ORDER BY 1")
    for label, n in cur.fetchall():
        print(f"{label}: {n}")
    cur.execute(f"SELECT p.source, COUNT(*) {latest} GROUP BY 1")
    print("source:", dict(cur.fetchall()))
    cur.execute(f"""SELECT COUNT(*), COUNT(*) FILTER (WHERE p.model_label = p.policy_label),
                           COUNT(*) FILTER (WHERE p.final_label <> p.model_label) {latest} WHERE p.source = 'model'""")
    n, agree, escalated = cur.fetchone()
    print(f"model vs policy agreement: {agree}/{n} = {100 * agree / n:.2f}%; policy escalated: {escalated}")
    cur.execute(f"""SELECT p.model_label, p.policy_label, COUNT(*) {latest} WHERE p.source = 'model' AND p.model_label <> p.policy_label
                    GROUP BY 1, 2 ORDER BY 3 DESC""")
    print("disagreements (model, policy, n):", cur.fetchall())
    cur.execute(f"""SELECT COUNT(*), COUNT(*) FILTER (WHERE p.final_label = sp.target_label) {latest}
                    JOIN student_semester_performance sp ON sp.student_id = s.student_id WHERE sp.target_label IS NOT NULL""")
    n, same = cur.fetchone()
    print(f"final label = dataset label (synthetic students, mostly training rows): {same}/{n} = {100 * same / n:.2f}%")
    cur.execute("SELECT source, COUNT(*) FROM predictions GROUP BY 1")
    print("all stored prediction rows by source:", dict(cur.fetchall()))
    conn.close()


def importance():
    url = (env("ML_SERVICE_URL") or "http://localhost:8001/predict").rsplit("/predict", 1)[0] + "/model-info"
    info = json.load(urllib.request.urlopen(url, timeout=120))
    section("Global importance (GET /model-info, mean |SHAP|, 2,000-row sample)")
    gi = info.get("global_importance") or {}
    overall = gi.get("overall") or gi.get("features") or gi
    items = overall if isinstance(overall, list) else [{"feature": k, "importance": v} for k, v in overall.items()]
    total = sum(float(x.get("importance", x.get("mean_abs_shap", 0))) for x in items) or 1
    for x in sorted(items, key=lambda x: -float(x.get("importance", x.get("mean_abs_shap", 0))))[:10]:
        v = float(x.get("importance", x.get("mean_abs_shap", 0)))
        print(f"{x['feature']}: {100 * v / total:.1f}%")
    print("model_sha256:", info.get("model_sha256"))
    print("sklearn runtime / pickled:", info.get("sklearn_version"), "/", info.get("sklearn_version_pickled"))


if __name__ == "__main__":
    model_metrics()
    db_stats()
    importance()
