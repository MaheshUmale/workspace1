# DOX — Python Engine

## Purpose

FastAPI backend that serves as the sole interface to Upstox APIs. Uses the official `upstox-python-sdk` v2.27.0 for all market data, option chain, candle, instrument search, and user profile calls. Stores historical data in DuckDB for replay and analytics.

## Ownership

- Port: 3035
- Runtime: `uvicorn main:app --host 0.0.0.0 --port 3035`
- Entry point: `main.py` → creates `MarketEngine` singleton → mounts route modules
- All Upstox SDK calls live in `upstox_api.py`

## Local Contracts

### File Responsibilities

| File | Role |
|---|---|
| `main.py` | FastAPI app, CORS, lifespan, health/config endpoints, route registration |
| `upstox_api.py` | All Upstox SDK calls wrapped in `run_in_executor`. Caching with TTL |
| `market_engine.py` | Core orchestration: token validation, periodic live updates, 7-strike computation, data access methods |
| `config.py` | Environment variables, underlying config, timeframe mapping |
| `db.py` | DuckDB schema and CRUD for candles, option chain snapshots, PCR, signals, trades |
| `models.py` | Pydantic models for request/response validation |

### SDK Integration Rules
- SDK package name is `upstox_client` (the installed pip package)
- Our local client file is `upstox_api.py` — named differently to avoid circular import
- Every SDK call must have a `_method_sync()` function + async wrapper using `_run_sync()`
- Never call SDK methods directly from async FastAPI handlers — always use `_run_sync()`
- Cache results: 5s default, 30s for search, 300s for instrument cache

### API Classes Used
- `UserApi` — token validation via `get_profile(api_version='2.0')`
- `HistoryApi` — candles via `get_intra_day_candle_data()` and `get_historical_candle_data1()`
- `OptionsApi` — option chain via `get_put_call_option_chain()`
- `InstrumentsApi` — search via `search_instrument()`, expiries via search with `expiry=current_month/next_month`
- `MarketQuoteApi` — LTP via `ltp()`

### Data Transformation
- `_convert_option_strike()` — converts SDK `OptionStrikeData` objects to plain dicts
- `change_in_oi` = `oi - prev_oi` (SDK provides both fields)
- Underlying mapping: `"Nifty 50" in underlying_key → "NIFTY"`, `"Nifty Bank" → "BANKNIFTY"`

### Route Prefix Mapping
| Python Route | Prefix | Next.js Proxy |
|---|---|---|
| `routes/instruments.py` | `/api/instruments` | `/api/instruments/*` |
| `routes/candles.py` | `/api/candles` | `/api/candles` |
| `routes/options.py` | `/api/options` | `/api/option-chain/*`, `/api/oi-data` |
| `routes/pcr.py` | `/api/pcr` | `/api/pcr` |
| `routes/seven_strike.py` | `/api/7strike` | `/api/7strike/*` |
| `routes/replay.py` | `/api/replay` | `/api/replay/*` |

### Periodic Updates
- `_periodic_update()` runs every 3 seconds in live mode
- Fetches option chain for NIFTY and BANKNIFTY
- Computes 7-strike matrix, PCR, signals
- Stores snapshots in DuckDB

## Work Guidance

- When adding a new Upstox SDK endpoint: add `_method_sync()` + async wrapper in `upstox_api.py`, then add a public method in `market_engine.py`, then add a route in the appropriate `routes/` file
- SDK errors return `ApiException` with `.status` and `.reason` — catch and return `{"success": False, "error": ...}`
- The `_get_engine()` helper in `instruments.py` handles the `__main__` vs `main` module split for route access to the engine singleton
- `db.py` uses singleton pattern — always call `get_db()` to get the instance

## Verification

- Startup log must show: `[MarketEngine] Upstox connected. Mode: LIVE`
- `GET /api/health` must return `{"mode": "live", "connected": true}`
- Expiries must return 2026 dates with `is_weekly` flag
- Option chain must return `change_in_oi` computed as `oi - prev_oi`

## Child DOX Index

- `routes/AGENTS.md` — FastAPI route handlers
