#!/bin/bash
# ============================================================
# 7Strike Terminal — Linux/macOS Setup Script
# Run this ONCE to install all dependencies
# Usage: chmod +x setup.sh && ./setup.sh
# ============================================================

set -e

BOLD='\033[1m'
CYAN='\033[36m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
NC='\033[0m'

echo ""
echo -e "${CYAN}=============================================${NC}"
echo -e "${CYAN}  7Strike Terminal — First-Time Setup${NC}"
echo -e "${CYAN}=============================================${NC}"
echo ""

# ---- Check Prerequisites ----
echo -e "${YELLOW}[1/6] Checking prerequisites...${NC}"

MISSING=0

# Check Node.js
if command -v node &> /dev/null; then
    echo -e "${GREEN}  Node.js: $(node --version)${NC}"
else
    echo -e "${RED}  ERROR: Node.js not found. Install from https://nodejs.org (v18+)${NC}"
    MISSING=1
fi

# Check Bun
if command -v bun &> /dev/null; then
    echo -e "${GREEN}  Bun: v$(bun --version)${NC}"
else
    echo -e "${RED}  ERROR: Bun not found. Install from https://bun.sh${NC}"
    MISSING=1
fi

# Check Python
PYTHON_CMD=""
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
    echo -e "${GREEN}  Python: $(python3 --version)${NC}"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
    echo -e "${GREEN}  Python: $(python --version)${NC}"
else
    echo -e "${RED}  ERROR: Python not found. Install from https://python.org (v3.10+)${NC}"
    MISSING=1
fi

# Check pip
PIP_CMD=""
if command -v pip3 &> /dev/null; then
    PIP_CMD="pip3"
    echo -e "${GREEN}  pip3: $(pip3 --version | cut -d' ' -f1-2)${NC}"
elif command -v pip &> /dev/null; then
    PIP_CMD="pip"
    echo -e "${GREEN}  pip: $(pip --version | cut -d' ' -f1-2)${NC}"
else
    echo -e "${RED}  ERROR: pip not found. It should come with Python.${NC}"
    MISSING=1
fi

# Check Git
if command -v git &> /dev/null; then
    echo -e "${GREEN}  Git: $(git --version)${NC}"
else
    echo -e "${YELLOW}  WARNING: Git not found. Needed for Upstox SDK install.${NC}"
fi

if [ "$MISSING" -eq 1 ]; then
    echo ""
    echo -e "${RED}  Missing prerequisites. Please install them and re-run.${NC}"
    exit 1
fi

echo ""

# ---- Install Node.js Dependencies ----
echo -e "${YELLOW}[2/6] Installing Node.js dependencies (bun install)...${NC}"
bun install
if [ $? -ne 0 ]; then
    echo -e "${RED}  ERROR: bun install failed.${NC}"
    exit 1
fi
echo -e "${GREEN}  Done.${NC}"
echo ""

# ---- Install Python Dependencies ----
echo -e "${YELLOW}[3/6] Installing Python dependencies (pip)...${NC}"
$PIP_CMD install -r python-engine/requirements.txt
if [ $? -ne 0 ]; then
    echo -e "${YELLOW}  Trying with --user flag...${NC}"
    $PIP_CMD install --user -r python-engine/requirements.txt
fi
echo -e "${GREEN}  Done.${NC}"
echo ""

# ---- Install Upstox Python SDK from GitHub ----
echo -e "${YELLOW}[4/6] Installing Upstox Python SDK v2.27.0 from GitHub...${NC}"
$PIP_CMD install "upstox-python-sdk @ git+https://github.com/upstox/upstox-python.git"
if [ $? -ne 0 ]; then
    echo -e "${YELLOW}  Trying with --user flag...${NC}"
    $PIP_CMD install --user "upstox-python-sdk @ git+https://github.com/upstox/upstox-python.git"
fi
echo -e "${GREEN}  Done.${NC}"
echo ""

# ---- Verify SDK Installation ----
echo -e "${YELLOW}[5/6] Verifying Upstox SDK installation...${NC}"
$PYTHON_CMD -c "from upstox_client import Configuration, ApiClient; from upstox_client.api import UserApi, HistoryApi, OptionsApi, InstrumentsApi, MarketQuoteApi; print('  SDK verified: All API classes available')" 2>/dev/null
if [ $? -ne 0 ]; then
    echo -e "${YELLOW}  WARNING: SDK verification failed. Try manual install:${NC}"
    echo -e "${YELLOW}  pip3 install \"upstox-python-sdk @ git+https://github.com/upstox/upstox-python.git\"${NC}"
fi
echo ""

# ---- Configure Environment ----
echo -e "${YELLOW}[6/6] Setting up environment...${NC}"

if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo -e "${GREEN}  Created .env from .env.example${NC}"
    else
        # Create minimal .env
        cat > .env << 'ENVEOF'
DATABASE_URL=file:./db/custom.db
UPSTOX_ACCESS_TOKEN=
UPSTOX_API_KEY=
ENVEOF
        echo -e "${GREEN}  Created minimal .env${NC}"
    fi
else
    echo -e "${YELLOW}  .env already exists — skipping${NC}"
fi

# Create data directory for DuckDB
mkdir -p python-engine/data
echo -e "${GREEN}  Ensured python-engine/data directory exists${NC}"

echo ""
echo -e "${GREEN}=============================================${NC}"
echo -e "${GREEN}  Setup Complete!${NC}"
echo -e "${GREEN}=============================================${NC}"
echo ""
echo -e "${CYAN}NEXT STEPS:${NC}"
echo -e "  1. Edit .env and add your UPSTOX_ACCESS_TOKEN"
echo -e "     Get your token from: ${BOLD}https://developer.upstox.com/${NC}"
echo -e "  2. Run: ${BOLD}./start.sh${NC}"
echo ""
echo -e "Or start manually:"
echo -e "  Terminal 1: ${BOLD}cd python-engine && python3 -m uvicorn main:app --port 3035${NC}"
echo -e "  Terminal 2: ${BOLD}bun run dev${NC}"
echo ""
