# ============================================================
# 7Strike Terminal — Windows PowerShell Setup Script
# Run this ONCE to install all dependencies
# Usage: .\setup.ps1
# ============================================================

$ErrorActionPreference = "Stop"
Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  7Strike Terminal — First-Time Setup" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# ---- Check Prerequisites ----
Write-Host "[1/6] Checking prerequisites..." -ForegroundColor Yellow

# Check Node.js
try {
    $nodeVersion = node --version 2>$null
    Write-Host "  Node.js: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Node.js not found. Install from https://nodejs.org (v18+)" -ForegroundColor Red
    exit 1
}

# Check Bun
try {
    $bunVersion = bun --version 2>$null
    Write-Host "  Bun: v$bunVersion" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Bun not found. Install from https://bun.sh" -ForegroundColor Red
    exit 1
}

# Check Python
try {
    $pythonVersion = python --version 2>$null
    Write-Host "  Python: $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Python not found. Install from https://python.org (v3.10+)" -ForegroundColor Red
    exit 1
}

# Check pip
try {
    $pipVersion = pip --version 2>$null
    Write-Host "  pip: $pipVersion" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: pip not found. It should come with Python." -ForegroundColor Red
    exit 1
}

# Check Git
try {
    $gitVersion = git --version 2>$null
    Write-Host "  Git: $gitVersion" -ForegroundColor Green
} catch {
    Write-Host "  WARNING: Git not found. Needed for Upstox SDK install." -ForegroundColor DarkYellow
}

Write-Host ""

# ---- Install Node.js Dependencies ----
Write-Host "[2/6] Installing Node.js dependencies (bun install)..." -ForegroundColor Yellow
bun install
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: bun install failed." -ForegroundColor Red
    exit 1
}
Write-Host "  Done." -ForegroundColor Green
Write-Host ""

# ---- Install Python Dependencies ----
Write-Host "[3/6] Installing Python dependencies (pip)..." -ForegroundColor Yellow
pip install -r python-engine\requirements.txt
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Trying with --user flag..." -ForegroundColor DarkYellow
    pip install --user -r python-engine\requirements.txt
}
Write-Host "  Done." -ForegroundColor Green
Write-Host ""

# ---- Install Upstox Python SDK from GitHub ----
Write-Host "[4/6] Installing Upstox Python SDK v2.27.0 from GitHub..." -ForegroundColor Yellow
pip install "upstox-python-sdk @ git+https://github.com/upstox/upstox-python.git"
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Trying with --user flag..." -ForegroundColor DarkYellow
    pip install --user "upstox-python-sdk @ git+https://github.com/upstox/upstox-python.git"
}
Write-Host "  Done." -ForegroundColor Green
Write-Host ""

# ---- Verify SDK Installation ----
Write-Host "[5/6] Verifying Upstox SDK installation..." -ForegroundColor Yellow
python -c "from upstox_client import Configuration, ApiClient; from upstox_client.api import UserApi, HistoryApi, OptionsApi, InstrumentsApi, MarketQuoteApi; print('  SDK verified: All API classes available')" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  WARNING: SDK verification failed. Try manual install:" -ForegroundColor DarkYellow
    Write-Host "  pip install `"upstox-python-sdk @ git+https://github.com/upstox/upstox-python.git`"" -ForegroundColor DarkYellow
}
Write-Host ""

# ---- Configure Environment ----
Write-Host "[6/6] Setting up environment..." -ForegroundColor Yellow

if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host "  Created .env from .env.example" -ForegroundColor Green
    } else {
        # Create minimal .env
        @"
DATABASE_URL=file:./db/custom.db
UPSTOX_ACCESS_TOKEN=
UPSTOX_API_KEY=
"@ | Out-File -FilePath ".env" -Encoding utf8
        Write-Host "  Created minimal .env" -ForegroundColor Green
    }
} else {
    Write-Host "  .env already exists — skipping" -ForegroundColor DarkYellow
}

# Create data directory for DuckDB
if (-not (Test-Path "python-engine\data")) {
    New-Item -ItemType Directory -Path "python-engine\data" -Force | Out-Null
    Write-Host "  Created python-engine\data directory" -ForegroundColor Green
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host "  Setup Complete!" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host ""
Write-Host "NEXT STEPS:" -ForegroundColor Cyan
Write-Host "  1. Edit .env and add your UPSTOX_ACCESS_TOKEN" -ForegroundColor White
Write-Host "     Get your token from: https://developer.upstox.com/" -ForegroundColor White
Write-Host "  2. Run: .\start.ps1" -ForegroundColor White
Write-Host ""
Write-Host "Or start manually:" -ForegroundColor Cyan
Write-Host "  Terminal 1: cd python-engine; python -m uvicorn main:app --port 3035" -ForegroundColor White
Write-Host "  Terminal 2: bun run dev" -ForegroundColor White
Write-Host ""
