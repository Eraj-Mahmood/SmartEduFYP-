#!/usr/bin/env bash
# Starts SmartEdu's three services on macOS / Linux in this terminal (logs prefixed), then opens the
# app. Ctrl+C stops all three.   ./start.sh   (once: chmod +x start.sh)
# Needs the one-time setup from README.md (backend/.env, npm ci, ml_service/.venv).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

fail() { echo "Cannot start: $1 (see README.md, 'Install')." >&2; exit 1; }
[ -f "$ROOT/backend/.env" ] || fail "backend/.env is missing"
[ -d "$ROOT/backend/node_modules" ] || fail "backend dependencies are missing (cd backend && npm ci)"
[ -d "$ROOT/frontend/node_modules" ] || fail "frontend dependencies are missing (cd frontend && npm ci)"
[ -x "$ROOT/ml_service/.venv/bin/python" ] || fail "ml_service/.venv is missing"

pids=()
cleanup() { echo; echo "Stopping SmartEdu..."; kill "${pids[@]}" 2>/dev/null || true; wait 2>/dev/null || true; }
trap cleanup INT TERM EXIT

run() { # name dir command...
  local name="$1" dir="$2"; shift 2
  (cd "$ROOT/$dir" && "$@" 2>&1 | sed -u "s/^/[$name] /") &
  pids+=($!)
}
run ml       ml_service .venv/bin/python -m uvicorn app:app --port 8001
run backend  backend    npm run dev
run frontend frontend   npm run dev

echo "Waiting for the services (the ML service needs ~10-20 s to load the model)..."
for url in http://127.0.0.1:8001/health http://127.0.0.1:5000/api/health http://localhost:5173/; do
  for _ in $(seq 120); do curl -fs -o /dev/null "$url" && break; sleep 1; done
  curl -fs -o /dev/null "$url" && echo "  OK   $url" || echo "  NOT RESPONDING  $url (see the log lines above)"
done
echo "SmartEdu: http://localhost:5173/  (demo logins: docs/DEMO_ACCOUNTS.md). Ctrl+C to stop."
(command -v open >/dev/null && open http://localhost:5173/) || (command -v xdg-open >/dev/null && xdg-open http://localhost:5173/) || true
wait
