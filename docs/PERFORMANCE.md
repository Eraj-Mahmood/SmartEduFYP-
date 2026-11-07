# Performance at 50k students

Measured on 2026-11-08 by `evaluation/perf_check.js` (`cd backend; node ../evaluation/perf_check.js`) against the running
services over HTTP on one machine (backend :5000, ML service :8001, PostgreSQL), after `npm run demo:reset`.
Each row: 10 timed runs after one untimed warm-up (the batch run: 10 runs, no warm-up). Times are
end-to-end request times seen by the client (localhost, so no network latency).

Machine: Intel(R) Core(TM) i5-8365U CPU @ 1.60GHz (8 logical cores), 16 GB RAM, Windows_NT 10.0.22621; Node v24.18.0; PostgreSQL 18.4. Data: 50030 students,
50030 stored predictions. Chat Layer 2 (LLM): off.

| Operation | Runs | Median | p90 | Min | Max |
|---|---|---|---|---|---|
| Login (student portal) | 10 | 303 ms | 354 ms | 252 ms | 371 ms |
| Student dashboard (GET /student/dashboard) | 10 | 15 ms | 45 ms | 6 ms | 52 ms |
| Admin dashboard (GET /admin/dashboard) | 10 | 152 ms | 201 ms | 114 ms | 204 ms |
| At-risk list, page 1 (25 rows) | 10 | 551 ms | 623 ms | 427 ms | 813 ms |
| At-risk list, filtered (AI, Dropout-Likely, search) | 10 | 207 ms | 296 ms | 188 ms | 321 ms |
| Single-student refresh (POST /prediction/refresh) | 10 | 80 ms | 103 ms | 76 ms | 116 ms |
| ML service alone: one /predict (with SHAP) | 10 | 58 ms | 75 ms | 46 ms | 88 ms |
| Chat answer (POST /student/chat, Layer 1) | 10 | 27 ms | 35 ms | 15 ms | 63 ms |
| Full batch prediction run (50030 students), server time | 10 | 92.82 s | 119.05 s | 91.45 s | 120.81 s |
| Full batch prediction run, wall time incl. polling | 10 | 93.36 s | 120.16 s | 92.30 s | 121.13 s |

Every batch run scored all 50030 students through the Random Forest service (fallback rows per run:
0, 0, 0, 0, 0, 0, 0, 0, 0, 0). Each timing's writes were undone afterwards (the predictions table is back to 50030 rows).

## Against the SRS non-functional targets

| Target | Measured | Verdict |
|---|---|---|
| NFR1.1: 100,000+ records in under 5 minutes | 92.82 s median for 50030 students, about 185.53 s per 100,000 extrapolated linearly | met (extrapolated) |
| NFR1.2: one prediction under 100 ms | ML service alone 58 ms median (p90 75 ms); the full refresh request incl. feature building, policy and the database write 80 ms | met for the model call |
| NFR1.3: dashboard under 3 seconds | student 15 ms, admin 152 ms (API time; the browser adds rendering) | met |

Notes

- Login is deliberately slow-ish: bcrypt cost 10 (about 60-100 ms per check) plus the profile lookup.
- The batch run processes 1,000 students per chunk and the ML service scores up to 2,000 rows per call; SHAP
  explanations dominate its time. The extrapolation to 100,000 assumes linear scaling, which the chunked design gives.
- One machine, one user at a time: this is not a load test (NFR4.2, 50 concurrent users, was not measured).
