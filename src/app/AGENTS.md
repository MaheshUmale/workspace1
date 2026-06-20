# DOX — Next.js App Router

## Purpose

Next.js 16 App Router pages and API routes. The `/` route renders the trading terminal. API routes proxy all requests to the Python engine on port 3035.

## Ownership

- `page.tsx` — Root route, renders `TradingTerminal` component (the ONLY user-visible route)
- `layout.tsx` — Root layout with theme provider and fonts
- `globals.css` — Global styles, Tailwind CSS imports
- `api/` — Server-side API route handlers that proxy to Python engine

## Local Contracts

### Page Route
- Only `/` is user-visible — no other page routes should exist
- `page.tsx` imports and renders `TradingTerminal` from `components/terminal/`

### API Routes — Proxy Pattern
All API routes follow the same pattern:
1. Parse query parameters from the request
2. Build Python engine URL: `http://localhost:3035/api/...`
3. Fetch with `AbortSignal.timeout(15000)` (15s timeout)
4. Return Python engine response or empty default on error

| Route | Python Endpoint | Notes |
|---|---|---|
| `/api/health` | `/api/health` | Returns Python engine health + status |
| `/api/candles` | `/api/candles` | Wraps raw list in `{candles: [...]}` + sanitizes |
| `/api/option-chain` | `/api/options/chain` | Requires `expiry` param |
| `/api/option-chain/mini` | `/api/options/chain/mini` | Requires `expiry` param |
| `/api/instruments/expiries` | `/api/instruments/expiries` | Returns `{underlying, expiries}` |
| `/api/instruments/search` | `/api/instruments/search` | Reads both `q` and `query` params. Returns `{results: [...]}` |
| `/api/pcr` | `/api/pcr` | Requires `expiry` param |
| `/api/oi-data` | `/api/options/oi` | Requires `expiry` param |
| `/api/config/upstox` | `/api/config/upstox` | GET (status), POST (update token), DELETE (disconnect) |
| `/api/7strike/matrix` | `/api/7strike/matrix` | 7-strike COI PCR matrix |
| `/api/7strike/signals` | `/api/7strike/signals` | Trading signals |
| `/api/7strike/history` | `/api/7strike/history` | Full history |
| `/api/7strike/trades` | `/api/7strike/trades` | Trade suggestions |
| `/api/replay/sessions` | `/api/replay/sessions` | Replay sessions |
| `/api/replay/start` | `/api/replay/start` | Start replay |

### Important Notes
- `/api/candles` performs **candle sanitization**: filters out `close < low`, `close > high`, `open < low`, `open > high`, `high < low`, `time <= 0`
- `/api/instruments/search` accepts both `q` and `query` params (frontend sends `q`)
- Python engine returns raw candle list — Next.js wraps it in `{instrument_key, timeframe, candles: [...]}`
- All routes return empty defaults (not errors) when Python engine is unreachable

## Work Guidance

- When adding new API routes, follow the proxy pattern: parse params → fetch Python → return response or empty default
- Always use `AbortSignal.timeout(15000)` for timeout — never leave fetch without timeout
- Never add business logic to Next.js API routes — they are thin proxies only
- The `/api/candles` route is the only one that transforms data (wraps + sanitizes)

## Verification

- All API routes return 200 with valid JSON even when Python engine is down
- Candle sanitization filters corrupted data points
- Search accepts both `q` and `query` parameters
