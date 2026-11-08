# Performance at 50k students

Measured on 2026-11-08 by `evaluation/perf_check.js` (`cd backend; node ../evaluation/perf_check.js`) against the running
services over HTTP on one machine (backend :5000, ML service :8001, PostgreSQL), after `npm run demo:reset`.
Each row: 10 timed runs after one untimed warm-up (the batch run: 10 runs, no warm-up). Times are
end-to-end request times seen by the client (localhost, so no network latency).

Machine: Intel(R) Core(TM) i5-8350U CPU @ 1.70GHz (8 logical cores), 16 GB RAM, Windows_NT 10.0.26200; Node v24.18.0; PostgreSQL 17.10. Data: 50030 students,
50030 stored predictions. Chat Layer 2 (LLM): on (gemini).

| Operation | Runs | Median | p90 | Min | Max |
|---|---|---|---|---|---|
| Login (student portal) | 10 | 269 ms | 443 ms | 254 ms | 445 ms |
| Student dashboard (GET /student/dashboard) | 10 | 17 ms | 23 ms | 9 ms | 28 ms |
| Admin dashboard (GET /admin/dashboard) | 10 | 135 ms | 143 ms | 111 ms | 147 ms |
| At-risk list, page 1 (25 rows) | 10 | 277 ms | 353 ms | 246 ms | 366 ms |
| At-risk list, filtered (AI, Dropout-Likely, search) | 10 | 199 ms | 203 ms | 174 ms | 218 ms |
| Single-student refresh (POST /prediction/refresh) | 10 | 61 ms | 72 ms | 49 ms | 77 ms |
| ML service alone: one /predict (with SHAP) | 10 | 41 ms | 49 ms | 34 ms | 65 ms |
| Chat answer (POST /student/chat, Layer 1) | 10 | 16 ms | 21 ms | 9 ms | 24 ms |
| Full batch prediction run (50030 students), server time | 10 | 101.53 s | 106.82 s | 100.70 s | 122.62 s |
| Full batch prediction run, wall time incl. polling | 10 | 102.23 s | 107.50 s | 101.13 s | 122.82 s |

Every batch run scored all 50030 students through the Random Forest service (fallback rows per run:
0, 0, 0, 0, 0, 0, 0, 0, 0, 0). Each timing's writes were undone afterwards (the predictions table is back to 50030 rows).

## Against the SRS non-functional targets

| Target | Measured | Verdict |
|---|---|---|
| NFR1.1: 100,000+ records in under 5 minutes | 101.53 s median for 50030 students, about 202.94 s per 100,000 extrapolated linearly | met (extrapolated) |
| NFR1.2: one prediction under 100 ms | ML service alone 41 ms median (p90 49 ms); the full refresh request incl. feature building, policy and the database write 61 ms | met for the model call |
| NFR1.3: dashboard under 3 seconds | student 17 ms, admin 135 ms (API time; the browser adds rendering) | met |

Notes

- Login is deliberately slow-ish: bcrypt cost 10 (about 60-100 ms per check) plus the profile lookup.
- The batch run processes 1,000 students per chunk and the ML service scores up to 2,000 rows per call; SHAP
  explanations dominate its time. The extrapolation to 100,000 assumes linear scaling, which the chunked design gives.
- One machine, one user at a time: this is not a load test (NFR4.2, 50 concurrent users, was not measured).
