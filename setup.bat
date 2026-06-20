@echo off
REM ============================================================
REM 7Strike Terminal — Windows Batch Setup Script
REM Run this ONCE to install all dependencies
REM Usage: setup.bat
REM ============================================================

echo.
echo =============================================
echo   7Strike Terminal — First-Time Setup
echo =============================================
echo.

REM ---- Check Prerequisites ----
echo [1/6] Checking prerequisites...

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo   ERROR: Node.js not found. Install from https://nodejs.org ^(v18+^)
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do echo   Node.js: %%i

where bun >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo   ERROR: Bun not found. Install from https://bun.sh
    exit /b 1
)
for /f "tokens=*" %%i in ('bun --version') do echo   Bun: v%%i

where python >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo   ERROR: Python not found. Install from https://python.org ^(v3.10+^)
    exit /b 1
)
for /f "tokens=*" %%i in ('python --version') do echo   Python: %%i

where pip >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo   ERROR: pip not found. It should come with Python.
    exit /b 1
)
for /f "tokens=*" %%i in ('pip --version') do echo   pip: %%i

where git >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo   WARNING: Git not found. Needed for Upstox SDK install.
)

echo.

REM ---- Install Node.js Dependencies ----
echo [2/6] Installing Node.js dependencies (bun install)...
call bun install
if %ERRORLEVEL% neq 0 (
    echo   ERROR: bun install failed.
    exit /b 1
)
echo   Done.
echo.

REM ---- Install Python Dependencies ----
echo [3/6] Installing Python dependencies (pip)...
pip install -r python-engine\requirements.txt
echo   Done.
echo.

REM ---- Install Upstox Python SDK from GitHub ----
echo [4/6] Installing Upstox Python SDK v2.27.0 from GitHub...
pip install "upstox-python-sdk @ git+https://github.com/upstox/upstox-python.git"
echo   Done.
echo.

REM ---- Verify SDK Installation ----
echo [5/6] Verifying Upstox SDK installation...
python -c "from upstox_client import Configuration, ApiClient; from upstox_client.api import UserApi, HistoryApi, OptionsApi, InstrumentsApi, MarketQuoteApi; print('  SDK verified: All API classes available')" 2>nul
if %ERRORLEVEL% neq 0 (
    echo   WARNING: SDK verification failed. Try manual install:
    echo   pip install "upstox-python-sdk @ git+https://github.com/upstox/upstox-python.git"
)
echo.

REM ---- Configure Environment ----
echo [6/6] Setting up environment...

if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo   Created .env from .env.example
    ) else (
        (
            echo DATABASE_URL=file:./db/custom.db
            echo UPSTOX_ACCESS_TOKEN=
            echo UPSTOX_API_KEY=
        ) > .env
        echo   Created minimal .env
    )
) else (
    echo   .env already exists — skipping
)

if not exist "python-engine\data" (
    mkdir "python-engine\data"
    echo   Created python-engine\data directory
)

echo.
echo =============================================
echo   Setup Complete!
echo =============================================
echo.
echo NEXT STEPS:
echo   1. Edit .env and add your UPSTOX_ACCESS_TOKEN
echo      Get your token from: https://developer.upstox.com/
echo   2. Run: start.bat
echo.
echo Or start manually:
echo   Terminal 1: cd python-engine ^& python -m uvicorn main:app --port 3035
echo   Terminal 2: bun run dev
echo.
pause
