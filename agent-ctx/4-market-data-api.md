# Task 4: Integrated Market Data Simulation API Routes

- **Status**: Completed
- **Date**: 2026-06-19
- **Agent**: market-data-api

## What Was Done

Replaced the proxy API route (which forwarded to the dying mini-service on port 3031) with direct in-process market data simulation via Next.js API routes.

## Files Created

### Core Engine
- `src/lib/market-simulator.ts` — Singleton market data simulation engine with:
  - Seeded PRNG (Mulberry32) for deterministic data
  - GBM-based spot price generation (NIFTY ~23500, BANKNIFTY ~51000)
  - Historical candle generation (220 candles per symbol/timeframe combo)
  - Black-Scholes option pricing with IV smile
  - Realistic OI patterns (higher at round numbers, exponential decay from ATM)
  - 7-Strike COI PCR matrix with signal state machine (IDLE → ZONE_WATCH → ACTIVE)
  - PCR time series generation
  - Instrument search across indices, futures, and options
  - Expiry date generation (next 6 Thursdays)

### API Routes (12 endpoints)
- `src/app/api/health/route.ts` — Health check
- `src/app/api/instruments/search/route.ts` — Search instruments
- `src/app/api/instruments/expiries/route.ts` — Get expiries for underlying
- `src/app/api/candles/route.ts` — Candlestick data (1m, 3m, 5m, 15m, 1h)
- `src/app/api/option-chain/route.ts` — Full option chain with Greeks
- `src/app/api/option-chain/mini/route.ts` — Mini option chain (lighter format)
- `src/app/api/oi-data/route.ts` — OI data per strike
- `src/app/api/pcr/route.ts` — PCR time series
- `src/app/api/7strike/matrix/route.ts` — 7-Strike COI PCR matrix
- `src/app/api/7strike/signals/route.ts` — 7-Strike signal generation
- `src/app/api/replay/sessions/route.ts` — List replay sessions
- `src/app/api/replay/start/route.ts` — Start replay session

## Files Deleted
- `src/app/api/[...path]/route.ts` — Old proxy route removed

## Key Design Decisions

1. **Singleton pattern**: `getSimulator()` lazy-creates one instance shared across all API routes
2. **No external dependencies**: Pure TypeScript, no database/Redis needed
3. **Deterministic seed**: Mulberry32 PRNG ensures reproducible data across restarts
4. **Black-Scholes pricing**: Full Greeks (delta, gamma, theta, vega) with IV smile
5. **Consistent data format**: Matches the format expected by existing frontend hooks (`use-market-data.ts`, `use-trading-engine.ts`)

## Test Results

All 12 endpoints verified working:
- `/api/health` → `{"status":"ok",...}`
- `/api/instruments/expiries?underlying=NIFTY` → 6 upcoming expiries
- `/api/candles?instrument_key=NIFTY&timeframe=1m` → 220 candles
- `/api/option-chain/mini?underlying=NIFTY&expiry=2026-06-25` → 21 strikes with CE/PE data
- `/api/option-chain?underlying=NIFTY&expiry=2026-06-25` → Full chain with Greeks
- `/api/pcr?underlying=NIFTY&expiry=2026-06-25` → 60 PCR data points
- `/api/7strike/matrix?underlying=NIFTY&expiry=2026-06-25` → 7-strike window with COI PCR
- `/api/7strike/signals?underlying=NIFTY&expiry=2026-06-25` → Signal generation
- `/api/oi-data?underlying=NIFTY&expiry=2026-06-25` → 21 strikes OI data
- `/api/instruments/search?q=NIFTY` → 20 instruments
- `/api/replay/sessions` → 2 demo sessions
- `/api/replay/start` → Session start confirmation

Lint: Clean (0 errors)
