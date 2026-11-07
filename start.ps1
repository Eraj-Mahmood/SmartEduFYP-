# Starts SmartEdu's three services on Windows, each in its own window, then opens the app.
#   powershell -ExecutionPolicy Bypass -File start.ps1      (or double-click start.cmd)
# Stop: close the three windows (or press Ctrl+C in each).
# Needs the one-time setup from README.md (backend\.env, npm ci, ml_service\.venv).

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Fail($msg) {
    Write-Host ""
    Write-Host "Cannot start: $msg" -ForegroundColor Red
    Write-Host "See README.md, section 'Install'." -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

# ---- one-time setup present? ----
if (-not (Test-Path "$root\backend\.env")) { Fail "backend\.env is missing (copy backend\.env.example and fill it in)." }
if (-not (Test-Path "$root\backend\node_modules")) { Fail "backend dependencies are missing (cd backend; npm ci)." }
if (-not (Test-Path "$root\frontend\node_modules")) { Fail "frontend dependencies are missing (cd frontend; npm ci)." }
if (-not (Test-Path "$root\ml_service\.venv\Scripts\python.exe")) { Fail "ml_service\.venv is missing (see README: ML service)." }

function PortInUse($port) {
    return [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}

$services = @(
    @{ Name = "SmartEdu ML service :8001"; Port = 8001; Dir = "ml_service"; Cmd = ".\.venv\Scripts\python -m uvicorn app:app --port 8001"; Url = "http://127.0.0.1:8001/health" },
    @{ Name = "SmartEdu backend :5000";    Port = 5000; Dir = "backend";    Cmd = "npm run dev";                                             Url = "http://127.0.0.1:5000/api/health" },
    @{ Name = "SmartEdu frontend :5173";   Port = 5173; Dir = "frontend";   Cmd = "npm run dev";                                             Url = "http://localhost:5173/" }
)

foreach ($s in $services) {
    if (PortInUse $s.Port) {
        Write-Host "Port $($s.Port) is already in use - assuming $($s.Name) is already running (skipped)." -ForegroundColor Yellow
        continue
    }
    $command = "`$Host.UI.RawUI.WindowTitle = '$($s.Name)'; Set-Location '$root\$($s.Dir)'; $($s.Cmd)"
    Start-Process powershell -ArgumentList "-NoExit", "-Command", $command | Out-Null
    Write-Host "Started $($s.Name)"
}

# ---- wait until all three answer ----
Write-Host ""
Write-Host "Waiting for the services (the ML service needs ~10-20 s to load the model)..."
$deadline = (Get-Date).AddSeconds(120)
foreach ($s in $services) {
    $ok = $false
    while (-not $ok -and (Get-Date) -lt $deadline) {
        try {
            Invoke-WebRequest -Uri $s.Url -UseBasicParsing -TimeoutSec 3 | Out-Null
            $ok = $true
        } catch {
            Start-Sleep -Seconds 1
        }
    }
    if ($ok) { Write-Host "  OK   $($s.Name)" -ForegroundColor Green }
    else { Write-Host "  NOT RESPONDING  $($s.Name) - look at its window for the error." -ForegroundColor Red }
}

Write-Host ""
Write-Host "SmartEdu: http://localhost:5173/  (demo logins: docs\DEMO_ACCOUNTS.md)"
Start-Process "http://localhost:5173/"
