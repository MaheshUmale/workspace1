# DOX — Python Engine Routes

## Purpose

FastAPI route modules that expose REST endpoints for the trading terminal. Each route file handles a specific domain and delegates to the `MarketEngine` singleton.

## Ownership

- All routes are async and delegate to `MarketEngine` methods
- Routes must NOT call Upstox SDK directly — always go through `MarketEngine` → `UpstoxClient`
- The engine singleton is accessed via `from main import engine` or the `_get_engine()` helper

## Local Contracts

### routes/instruments.py
- `GET /search?q=...` — Instrument search via Upstox SDK `InstrumentsApi.search_instrument()`. Returns `{ results: [...] }` with mapped fields
- `GET /expiries?underlying=NIFTY` — Fetches expiries using SDK search with `expiry=current_month` and `expiry=next_month`. Returns weekly/monthly flags

### routes/candles.py
- `GET /candles?instrument_key=NIFTY&timeframe=1m` — Returns list of `CandleData` objects. LIVE mode fetches from Upstox SDK `HistoryApi`

### routes/options.py
- `GET /options/chain?underlying=NIFTY&expiry=2026-06-23` — Full option chain with all strikes
- `GET /options/chain/mini?underlying=NIFTY&expiry=2026-06-23` — Filtered to ATM ±10 strikes, fewer fields
- `GET /options/oi?underlying=NIFTY&expiry=2026-06-23` — OI data across strikes

### routes/pcr.py
- `GET /pcr?underlying=NIFTY&expiry=2026-06-23` — PCR history from DB + current computed values

### routes/seven_strike.py
- `GET /7strike/matrix` — 7-strike COI PCR matrix (ATM ±3)
- `GET /7strike/signals` — Current trading signals
- `GET /7strike/history` — Full history from DuckDB
- `GET /7strike/trades` — Trade suggestions

### routes/replay.py
- `GET /replay/sessions` — Available replay sessions from DB
- `POST /replay/start?session_id=...` — Start a replay session

## Work Guidance

- Always use `await engine.method_async()` variants — the sync methods return empty data
- The `search` endpoint in `instruments.py` returns `{ results: [...] }` not a bare list — this matches the frontend expectation
- Response models from `models.py` are enforced on some routes — when adding fields, update the Pydantic model too
- The `_get_engine()` helper handles module import edge cases

## Verification

- All routes must return valid JSON
- Search must return results with: `instrument_key`, `trading_symbol`, `underlying`, `strike`, `option_type`, `expiry`
- Candles must return objects with: `time`, `open`, `high`, `low`, `close`, `volume`
