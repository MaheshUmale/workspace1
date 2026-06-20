#!/bin/bash
# ============================================================
# 7Strike Terminal — Linux/macOS Start Script
# Starts both Python engine + Next.js frontend
# Usage: ./start.sh
# ============================================================

set -e

BOLD='\033[1m'
CYAN='\033[36m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
DIM='\033[2m'
NC='\033[0m'

echo ""
echo -e "${CYAN}=============================================${NC}"
echo -e "${CYAN}  7Strike Terminal — Starting Services${NC}"
echo -e "${CYAN}=============================================${NC}"
echo ""

# ---- Track child PIDs for cleanup ----
PYTHON_PID=""
NODE_PID=""
cleanup() {
    echo ""
    echo -e "${YELLOW}Stopping services...${NC}"
    [ -n "$PYTHON_PID" ] && kill "$PYTHON_PID" 2>/dev/null || true
    [ -n "$NODE_PID" ] && kill "$NODE_PID" 2>/dev/null || true
    echo -e "${YELLOW}All services stopped.${NC}"
    exit 0
}
trap cleanup SIGINT SIGTERM

# ---- Check Environment ----
echo -e "${YELLOW}[1/4] Checking environment...${NC}"

if [ ! -f ".env" ]; then
    echo -e "${RED}  ERROR: .env file not found. Run setup first.${NC}"
    exit 1
fi

# Check for UPSTOX_ACCESS_TOKEN
if grep -q "UPSTOX_ACCESS_TOKEN\s*=\s*$" .env 2>/dev/null || ! grep -q "UPSTOX_ACCESS_TOKEN" .env 2>/dev/null; then
    echo -e "${YELLOW}  WARNING: UPSTOX_ACCESS_TOKEN not set in .env${NC}"
    echo -e "${YELLOW}  The terminal will start in OFFLINE mode.${NC}"
    echo -e "${YELLOW}  Add your token at: https://developer.upstox.com/${NC}"
    echo ""
fi

# Source .env
set -a
source .env 2>/dev/null || true
set +a
echo -e "${GREEN}  .env loaded.${NC}"

# Create data directory if needed
mkdir -p python-engine/data

echo ""

# ---- Check Prerequisites ----
echo -e "${YELLOW}[2/4] Checking prerequisites...${NC}"

MISSING=0

if ! command -v python3 &> /dev/null && ! command -v python &> /dev/null; then
    echo -e "${RED}  ERROR: Python not found. Install Python 3.10+${NC}"
    MISSING=1
else
    echo -e "${GREEN}  Python: OK${NC}"
fi

if ! command -v bun &> /dev/null; then
    echo -e "${RED}  ERROR: Bun not found. Install from https://bun.sh${NC}"
    MISSING=1
else
    echo -e "${GREEN}  Bun: OK${NC}"
fi

if python3 -c "import fastapi" 2>/dev/null || python -c "import fastapi" 2>/dev/null; then
    echo -e "${GREEN}  Python deps: OK${NC}"
else
    echo -e "${RED}  ERROR: Python dependencies not installed. Run setup first.${NC}"
    MISSING=1
fi

if python3 -c "from upstox_client import Configuration" 2>/dev/null || python -c "from upstox_client import Configuration" 2>/dev/null; then
    echo -e "${GREEN}  Upstox SDK: OK${NC}"
else
    echo -e "${RED}  ERROR: Upstox SDK not installed. Run setup first.${NC}"
    MISSING=1
fi

if [ "$MISSING" -eq 1 ]; then
    echo ""
    echo -e "${RED}  Run setup to install missing dependencies.${NC}"
    exit 1
fi

echo ""

# ---- Start Python Engine ----
echo -e "${YELLOW}[3/4] Starting Python engine on port 3035...${NC}"

# Kill any existing process on port 3035
if command -v lsof &> /dev/null; then
    PID_3035=$(lsof -ti:3035 2>/dev/null || true)
    if [ -n "$PID_3035" ]; then
        echo -e "${DIM}  Killing existing process on port 3035...${NC}"
        kill $PID_3035 2>/dev/null || true
        sleep 1
    fi
fi

# Use python3 if available, else python
PYTHON_CMD="python3"
if ! command -v python3 &> /dev/null; then
    PYTHON_CMD="python"
fi

cd python-engine
$PYTHON_CMD -m uvicorn main:app --host 0.0.0.0 --port 3035 &
PYTHON_PID=$!
cd ..

echo -e "${GREEN}  Python engine started (PID: $PYTHON_PID)${NC}"

# Wait for Python engine to be ready
MAX_WAIT=15
WAITED=0
echo -e "${DIM}  Waiting for engine...${NC}"
while [ $WAITED -lt $MAX_WAIT ]; do
    if curl -s http://localhost:3035/api/health > /dev/null 2>&1; then
        echo -e "${GREEN}  Engine is ready!${NC}"
        break
    fi
    sleep 1
    WAITED=$((WAITED + 1))
done

if [ $WAITED -ge $MAX_WAIT ]; then
    echo -e "${RED}  TIMEOUT: Python engine did not start. Check for errors above.${NC}"
    kill $PYTHON_PID 2>/dev/null || true
    exit 1
fi

echo ""

# ---- Start Next.js Frontend ----
echo -e "${YELLOW}[4/4] Starting Next.js frontend on port 3000...${NC}"

# Kill any existing process on port 3000
if command -v lsof &> /dev/null; then
    PID_3000=$(lsof -ti:3000 2>/dev/null || true)
    if [ -n "$PID_3000" ]; then
        echo -e "${DIM}  Killing existing process on port 3000...${NC}"
        kill $PID_3000 2>/dev/null || true
        sleep 1
    fi
fi

bun run dev &
NODE_PID=$!

echo -e "${GREEN}  Next.js frontend started (PID: $NODE_PID)${NC}"

# Wait for Next.js to be ready
MAX_WAIT=20
WAITED=0
echo -e "${DIM}  Waiting for frontend to compile...${NC}"
while [ $WAITED -lt $MAX_WAIT ]; do
    if curl -s http://localhost:3000 > /dev/null 2>&1; then
        echo -e "${GREEN}  Frontend is ready!${NC}"
        break
    fi
    sleep 1
    WAITED=$((WAITED + 1))
done

if [ $WAITED -ge $MAX_WAIT ]; then
    echo -e "${YELLOW}  Frontend may still be compiling. Give it a moment...${NC}"
fi

echo ""
echo -e "${GREEN}=============================================${NC}"
echo -e "${GREEN}  7Strike Terminal is RUNNING${NC}"
echo -e "${GREEN}=============================================${NC}"
echo ""
echo -e "  Python Engine:    ${BOLD}http://localhost:3035${NC}"
echo -e "  Next.js Frontend: ${BOLD}http://localhost:3000${NC}"
echo ""
echo -e "  Press ${BOLD}Ctrl+C${NC} to stop both services."
echo ""

# ---- Keep script running and wait for either process ----
wait -n 2>/dev/null || wait
echo ""
echo -e "${RED}A process exited unexpectedly. Stopping all services...${NC}"
cleanup
