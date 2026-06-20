# Task 1-4: Upstox API Client Integration

## Agent: Main

## Summary
Added complete Upstox API integration to the trading terminal with graceful fallback to simulated data.

## Files Created
1. **src/lib/upstox-client.ts** — Upstox API Client class
   - Rate limiting (8 req/sec, 429 retry)
   - Response caching (5s TTL)
   - Instrument key mapping (NIFTY ↔ NSE_INDEX|Nifty 50)
   - Timeframe mapping (1m ↔ 1minute)
   - Methods: validateToken, getOptionChain, getCandles, getQuotes, searchInstruments, getExpiries
   - Never throws — always returns error objects

2. **src/lib/data-provider.ts** — Unified Data Provider singleton
   - Auto-switches between Upstox live data and simulated data
   - Graceful fallback on any API failure
   - Environment variable auto-configuration (UPSTOX_ACCESS_TOKEN)
   - Upstox → internal format transformers for option chain, candles, etc.

3. **src/app/api/config/upstox/route.ts** — Configuration API
   - GET: Check Upstox connection status
   - POST: Set Upstox credentials and connect
   - DELETE: Disconnect (switch back to simulation)

4. **src/components/terminal/upstox-config-dialog.tsx** — Settings dialog
   - Access token / API key inputs
   - Connect/Disconnect buttons
   - LIVE/SIMULATION mode indicator
   - Masked token display

## Files Modified
1. **All 12 API routes** — Changed from `getSimulator()` to `getDataProvider()`
   - health, candles, option-chain, option-chain/mini, pcr, oi-data
   - instruments/search, instruments/expiries
   - 7strike/matrix, 7strike/signals
   - replay/sessions, replay/start

2. **src/components/terminal/connection-status.tsx** — Shows LIVE (green) / SIM (yellow) / Reconnecting

3. **src/components/terminal/top-bar.tsx** — Added Settings button for UpstoxConfigDialog

4. **worklog.md** — Added task 1-4 entry

## Architecture
```
Frontend → API Routes → DataProvider → UpstoxClient (if configured)
                                 ↘ MarketSimulator (fallback/always)
```

## Key Design Decisions
- DataProvider always has simulator as fallback — never errors to client
- UpstoxClient runs server-side only (in API routes)
- Access token is never exposed to client — only masked version shown
- 7-Strike matrix/signals always use simulator (derived analytics)
- Search always returns simulator results (internal instrument key format consistency)
- Connection status polls every 10 seconds
