# ============================================================
# 7Strike Terminal — Windows PowerShell Start Script
# Starts both Python engine + Next.js frontend in separate windows
# Usage: .\start.ps1
# ============================================================

$ErrorActionPreference = "Stop"
Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  7Strike Terminal — Starting Services" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# ---- Check Environment ----
Write-Host "[1/4] Checking environment..." -ForegroundColor Yellow

if (-not (Test-Path ".env")) {
    Write-Host "  ERROR: .env file not found. Run .\setup.ps1 first." -ForegroundColor Red
    exit 1
}

# Check for UPSTOX_ACCESS_TOKEN in .env
$envContent = Get-Content ".env" -Raw
if ($envContent -notmatch "UPSTOX_ACCESS_TOKEN\s*=\s*\S+" -or $envContent -match "UPSTOX_ACCESS_TOKEN\s*=\s*$") {
    Write-Host "  WARNING: UPSTOX_ACCESS_TOKEN not set in .env" -ForegroundColor DarkYellow
    Write-Host "  The terminal will start in OFFLINE mode." -ForegroundColor DarkYellow
    Write-Host "  Add your token at: https://upstox.com" -ForegroundColor DarkYellow
    Write-Host ""
}

# Load .env into current process environment
Get-Content ".env" | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#")) {
        $parts = $line -split "=", 2
        if ($parts.Length -eq 2) {
            $key = $parts[0].Trim()
            $value = $parts[1].Trim()
            [Environment]::SetEnvironmentVariable($key, $value, "Process")
        }
    }
}
Write-Host "  .env loaded." -ForegroundColor Green

# Create data directory if needed
if (-not (Test-Path "python-engine\data")) {
    New-Item -ItemType Directory -Path "python-engine\data" -Force | Out-Null
    Write-Host "  Created python-engine\data directory" -ForegroundColor Green
}

Write-Host ""

# ---- Check Prerequisites ----
Write-Host "[2/4] Checking prerequisites..." -ForegroundColor Yellow

$missing = $false

try {
    $null = python --version 2>$null
    Write-Host "  Python: OK" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Python not found. Run .\setup.ps1 first." -ForegroundColor Red
    $missing = $true
}

try {
    $null = bun --version 2>$null
    Write-Host "  Bun: OK" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Bun not found. Run .\setup.ps1 first." -ForegroundColor Red
    $missing = $true
}

# Check Python dependencies
$fastapiCheck = python -c "import fastapi; print('OK')" 2>$null
if ($fastapiCheck -ne "OK") {
    Write-Host "  ERROR: Python dependencies not installed. Run .\setup.ps1 first." -ForegroundColor Red
    $missing = $true
} else {
    Write-Host "  Python deps: OK" -ForegroundColor Green
}

# Check Upstox SDK
$sdkCheck = python -c "from upstox_client import Configuration; print('OK')" 2>$null
if ($sdkCheck -ne "OK") {
    Write-Host "  ERROR: Upstox SDK not installed. Run .\setup.ps1 first." -ForegroundColor Red
    $missing = $true
} else {
    Write-Host "  Upstox SDK: OK" -ForegroundColor Green
}

if ($missing) {
    Write-Host ""
    Write-Host "  Run .\setup.ps1 to install missing dependencies." -ForegroundColor Red
    exit 1
}

Write-Host ""

# ---- Start Python Engine ----
Write-Host "[3/4] Starting Python engine on port 3035..." -ForegroundColor Yellow

# Kill any existing Python engine on port 3035
$existingPython = Get-NetTCPConnection -LocalPort 3035 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
if ($existingPython) {
    Write-Host "  Killing existing process on port 3035..." -ForegroundColor DarkYellow
    $existingPython | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 1
}

# REWRITE: Starts Python inside its own persistent visual PowerShell terminal window
$pythonProcess = Start-Process -FilePath "powershell.exe" `
    -ArgumentList "-NoExit", "-Command", "python -u -m uvicorn main:app --host 127.0.0.1 --port 3035" `
    -WorkingDirectory "$PWD\python-engine" `
    -PassThru

Write-Host "  Python engine window spawned (PID: $($pythonProcess.Id))" -ForegroundColor Green

# Wait for Python engine to be ready
$waited = 0
$maxWait = 25 

Write-Host "  Waiting for engine to be ready..." -ForegroundColor DarkYellow -NoNewline
while ($waited -lt $maxWait) {
    try {
        # Querying local loopback directly avoids network configuration hangs
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:3035/api/health" -TimeoutSec 2 -ErrorAction SilentlyContinue
         
        if ($response -and $response.StatusCode -eq 200) {
            Write-Host " OK" -ForegroundColor Green
            break
        }
    } catch {
        # Endpoint completely offline or still spinning up
    }
    Write-Host "." -ForegroundColor DarkYellow -NoNewline
    Start-Sleep -Seconds 1
    $waited++
}

if ($waited -ge $maxWait) {
    Write-Host " TIMEOUT" -ForegroundColor Red
    Write-Host "  Python engine did not start in time. Check for errors above." -ForegroundColor Red
    Stop-Process -Id $pythonProcess.Id -Force -ErrorAction SilentlyContinue
    exit 1
}

Write-Host ""

# ---- Start Next.js Frontend ----
Write-Host "[4/4] Starting Next.js frontend on port 3000..." -ForegroundColor Yellow

# Kill any existing Next.js on port 3000
$existingNode = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
if ($existingNode) {
    Write-Host "  Killing existing process on port 3000..." -ForegroundColor DarkYellow
    $existingNode | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 1
}

# REWRITE: Starts Next.js / Bun inside its own persistent visual window
$nodeProcess = Start-Process -FilePath "powershell.exe" `
    -ArgumentList "-NoExit", "-Command", "bun run dev" `
    -WorkingDirectory "$PWD" `
    -PassThru

Write-Host "  Next.js frontend window spawned (PID: $($nodeProcess.Id))" -ForegroundColor Green

# Wait for Next.js to be ready
$maxWait = 20
$waited = 0
Write-Host "  Waiting for frontend to be ready..." -ForegroundColor DarkYellow -NoNewline
while ($waited -lt $maxWait) {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:3000" -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($response -and $response.StatusCode -eq 200) {
            Write-Host " OK" -ForegroundColor Green
            break
        }
    } catch {
        # Not ready yet
    }
    Write-Host "." -ForegroundColor DarkYellow -NoNewline
    Start-Sleep -Seconds 1
    $waited++
}
if ($waited -ge $maxWait) {
    Write-Host " TIMEOUT" -ForegroundColor DarkYellow
    Write-Host "  Frontend may still be compiling. Give it a moment..." -ForegroundColor DarkYellow
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host "  7Strike Terminal is RUNNING" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Python Engine:  http://localhost:3035" -ForegroundColor White
Write-Host "  Next.js Frontend: http://localhost:3000" -ForegroundColor White
Write-Host ""
Write-Host "  Press Ctrl+C inside THIS window to stop both services." -ForegroundColor DarkYellow
Write-Host ""

# ---- Monitor Processes ----
try {
    # Monitor background shells. If you manually close either pop-up window, this catches it!
    $firstExit = Wait-Process -Id $pythonProcess.Id, $nodeProcess.Id -Any -ErrorAction SilentlyContinue
    Write-Host ""
    Write-Host "A process window was closed. Stopping all remaining services..." -ForegroundColor Red
} catch {
    # Ctrl+C pressed in main terminal
    Write-Host ""
    Write-Host "Stopping services..." -ForegroundColor Yellow
} finally {   
    # Cascades the shutdown to clean up both popups cleanly
    Stop-Process -Id $pythonProcess.Id -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $nodeProcess.Id -Force -ErrorAction SilentlyContinue
}
