@echo off
REM ============================================================
REM 7Strike Terminal — Windows Batch Start Script
REM Starts both Python engine + Next.js frontend
REM Usage: start.bat
REM ============================================================

echo.
echo =============================================
echo   7Strike Terminal — Starting Services
echo =============================================
echo.

REM ---- Check Environment ----
echo [1/4] Checking environment...

if not exist ".env" (
    echo   ERROR: .env file not found. Run setup.bat first.
    exit /b 1
)

findstr /C:"UPSTOX_ACCESS_TOKEN=" .env >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo   WARNING: UPSTOX_ACCESS_TOKEN not set in .env
    echo   The terminal will start in OFFLINE mode.
    echo   Add your token at: https://developer.upstox.com/
    echo.
)

if not exist "python-engine\data" (
    mkdir "python-engine\data"
    echo   Created python-engine\data directory
)

echo   .env found.
echo.

REM ---- Check Prerequisites ----
echo [2/4] Checking prerequisites...

where python >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo   ERROR: Python not found. Run setup.bat first.
    exit /b 1
)
echo   Python: OK

where bun >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo   ERROR: Bun not found. Run setup.bat first.
    exit /b 1
)
echo   Bun: OK

python -c "import fastapi" >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo   ERROR: Python dependencies not installed. Run setup.bat first.
    exit /b 1
)
echo   Python deps: OK

python -c "from upstox_client import Configuration" >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo   ERROR: Upstox SDK not installed. Run setup.bat first.
    exit /b 1
)
echo   Upstox SDK: OK

echo.

REM ---- Start Python Engine ----
echo [3/4] Starting Python engine on port 3035...

pushd python-engine
start "7Strike-PythonEngine" /B python -m uvicorn main:app --host 0.0.0.0 --port 3035
popd

REM Wait for Python engine to start
echo   Waiting for engine to be ready...
timeout /t 5 /nobreak >nul

REM Check if engine is responding
curl -s http://localhost:3035/api/health >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo   WARNING: Python engine may not be ready yet. Continuing...
) else (
    echo   Python engine is running.
)

echo.

REM ---- Start Next.js Frontend ----
echo [4/4] Starting Next.js frontend on port 3000...

start "7Strike-NextJS" /B bun run dev

REM Wait for Next.js to compile
echo   Waiting for frontend to compile...
timeout /t 8 /nobreak >nul

echo.
echo =============================================
echo   7Strike Terminal is RUNNING
echo =============================================
echo.
echo   Python Engine:    http://localhost:3035
echo   Next.js Frontend: http://localhost:3000
echo.
echo   Close this window or press Ctrl+C to stop.
echo.

REM Keep the window open — when user presses Ctrl+C, kill both processes
:loop
timeout /t 60 /nobreak >nul
goto loop
