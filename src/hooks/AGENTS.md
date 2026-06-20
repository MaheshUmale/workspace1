# DOX — React Hooks

## Purpose

Custom React hooks that encapsulate data fetching logic and provide reactive interfaces to components.

## Ownership

- `use-market-data.ts` — Primary data fetching hook for all market data
- `use-trading-engine.ts` — Trading engine connection and WebSocket support
- `use-toast.ts` — Toast notification hook (from shadcn/ui)
- `use-mobile.ts` — Mobile detection hook (from shadcn/ui)

## Local Contracts

### use-market-data.ts
- **Candle fetching**: `fetchCandles(instrumentKey, timeframe)` → calls `/api/candles`
  - 30s cache for 1m, 120s for higher timeframes
  - Updates spot data from last candle when no spot data exists (Bug 2 fix)
  - Clears cache on timeframe/underlying change (Bug 4 fix)

- **Option chain fetching**: `fetchOptionChain(symbol, expiry)` → calls `/api/option-chain/mini`
  - Maps response to store format: `ce_ltp`, `ce_oi`, `ce_change_oi`, `pe_ltp`, `pe_oi`, `pe_change_oi`
  - Updates spot data from option chain response
  - Sets ATM strike in store

- **PCR fetching**: `fetchPCR(symbol, expiry)` → calls `/api/pcr`
  - Adds PCR data points to store (last 50)

- **Expiry fetching**: `fetchExpiries(symbol)` → calls `/api/instruments/expiries`
  - Auto-selects first expiry if none selected
  - Maps `expiry_date` from response

- **Periodic refresh**: Option chain + PCR refreshed every 15 seconds
- **Effect dependencies**: Refetch on underlying/expiry/timeframe changes

### use-trading-engine.ts
- Manages connection to trading engine
- WebSocket/Socket.IO support for real-time updates

## Work Guidance

- When adding new data endpoints, add a `fetch*` method to `use-market-data.ts`
- Always use `fetchAPI()` utility for API calls
- Cache management uses `useRef` to persist across renders
- Bug fixes reference: Bug 2 (spot from candle), Bug 4 (cache clear on tf change)

## Verification

- Candles load and display correctly
- Option chain refreshes every 15 seconds
- Expiries auto-populate on underlying change
- PCR data appears in PCR chart
