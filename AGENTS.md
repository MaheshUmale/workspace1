# DOX — 7Strike Terminal

## Purpose

Indian Options Trading Terminal — a real-time 7-Strike COI PCR signal system. Fetches live market data from Upstox via the official Python SDK, computes option chain analytics, and renders interactive charts with OI/COI overlays.

## Architecture

```
Browser → Next.js (port 3000) → Python Engine (port 3035) → Upstox Python SDK → Upstox API
                                        ↓
                                    DuckDB (historical storage)
```

- **Next.js 16 + TypeScript** — Frontend, renders lightweight-charts v5 candlestick charts with canvas-based OI overlay, Zustand store, Tailwind CSS 4 + shadcn/ui
- **Python FastAPI** — All Upstox API calls use the official `upstox-python-sdk` v2.27.0 (package name `upstox_client`). Synchronous SDK calls wrapped in `run_in_executor` to avoid blocking the async event loop
- **Caddy** — Gateway on port 81 proxies to Next.js on port 3000

## Ownership

- Full-stack project: frontend + backend + data layer
- All Upstox API calls MUST go through the Python engine — NO direct API calls from TypeScript
- `upstox_client` is the SDK package name; our local client file is `upstox_api.py` (renamed to avoid circular import)

## Local Contracts

### Data Flow Rules
- All market data flows: Browser → Next.js API Route → Python Engine → Upstox SDK
- The DataProvider (`src/lib/data-provider.ts`) is a thin proxy to the Python engine — it never calls Upstox directly
- Python engine caches responses (5s default, 30s for instrument search, 300s for instrument cache)
- NO simulation, NO mock data — if Upstox is offline, return empty data

### API Versioning
- Upstox has a mix of v2 and v3 APIs — the SDK handles both
- `api_version='2.0'` is used for UserApi, HistoryApi calls
- OptionsApi and InstrumentsApi don't require explicit api_version

### Key Mappings
- NIFTY → `NSE_INDEX|Nifty 50`, BANKNIFTY → `NSE_INDEX|Nifty Bank`
- Timeframes: `1m→1minute`, `3m→3minute`, `5m→5minute`, `15m→15minute`, `1h→1hour`, `1d→1day`
- `change_in_oi` is computed as `oi - prev_oi` (SDK returns both fields)

### Frontend Rules
- Use shadcn/ui components — do NOT build from scratch
- Lint must pass (`bun run lint`)
- Only `/` route is user-visible — no other page routes
- Footer must be sticky to bottom of viewport
- Responsive design mandatory (mobile-first)

### Environment
- `.env` contains `UPSTOX_ACCESS_TOKEN` — Python engine reads it at startup
- Python engine auto-validates token on startup, switches to LIVE mode
- Token can be updated at runtime via POST `/api/config/upstox`

## Work Guidance

- When modifying API endpoints, update both the Python route AND the corresponding Next.js API route
- When adding new Upstox SDK calls, add a `_sync` method + async wrapper with `run_in_executor`
- The SDK package name is `upstox_client` — our local file is `upstox_api.py` to avoid name collision
- Test SDK calls standalone before integrating into the engine
- Use `bun run lint` to check code quality before committing

## Verification

- `bun run lint` — ESLint must pass with 0 errors
- Python engine startup must show `[MarketEngine] Upstox connected. Mode: LIVE`
- All Next.js API routes must proxy to Python engine on port 3035
- Expiries must return 2026 dates (not 2025) — NIFTY weekly expiries are on varying weekdays

## Child DOX Index

- `python-engine/AGENTS.md` — Python FastAPI backend, Upstox SDK integration, DuckDB storage
- `src/AGENTS.md` — Next.js frontend, React components, hooks, stores, API routes
