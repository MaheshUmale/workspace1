# DOX — Utility Libraries

## Purpose

Core utility modules: data provider (proxy to Python engine), chart helpers, type definitions, and database client.

## Ownership

- `data-provider.ts` — Primary data interface, proxies all calls to Python engine
- `chart-utils.ts` — Chart rendering utilities and `fetchAPI()` helper
- `market-simulator.ts` — TypeScript type definitions (no simulation logic)
- `upstox-client.ts` — Legacy Upstox client (NOT used — kept for reference)
- `python-engine-proxy.ts` — Python engine proxy utilities
- `db.ts` — Prisma database client
- `utils.ts` — General utility functions (cn helper for Tailwind)

## Local Contracts

### data-provider.ts
- **Singleton** via `globalThis.__tradingDataProvider__`
- All methods are async and proxy to Python engine on `http://localhost:3035`
- `fetchFromPython(path, params)` — Core fetch helper with 15s timeout, AbortController
- Health check throttled to once per 10 seconds
- Returns empty/default data when Python engine is unreachable
- NO direct Upstox API calls — everything goes through Python engine

Key methods:
- `getCandles(key, tf)` → Python `/api/candles`
- `getOptionChain(underlying, expiry)` → Python `/api/options/chain`
- `getMiniOptionChain(underlying, expiry)` → Python `/api/options/chain/mini`
- `getOIData(underlying, expiry)` → Python `/api/options/oi`
- `getPCR(underlying, expiry)` → Python `/api/pcr`
- `getExpiries(underlying)` → Python `/api/instruments/expiries`
- `configureUpstox(token)` → Python `/api/config/upstox`

### chart-utils.ts
- `fetchAPI<T>(endpoint, params)` — Browser-side fetch wrapper
  - Builds URL with `URLSearchParams`
  - Throws on non-OK responses
  - Used by hooks and components for API calls
- Chart-specific utilities for lightweight-charts configuration

### market-simulator.ts
- **Type definitions ONLY** — no simulation logic
- Defines: `CandleData`, `OptionChainRow`, `MiniOptionChainRow`, `Instrument`, `ExpiryInfo`, `OIDatum`, `PCRPoint`, etc.
- These types are shared across components and hooks

### upstox-client.ts
- **DEPRECATED** — NOT used anywhere in the codebase
- Previously made direct Upstox API calls from TypeScript
- Kept only for type reference and potential future use

### db.ts
- Prisma client singleton for Next.js server-side database access
- Currently minimal usage — primary storage is in Python engine's DuckDB

## Work Guidance

- When adding new data endpoints, add a method to `data-provider.ts` that calls `fetchFromPython()`
- The `fetchAPI()` function is used by browser-side code (hooks/components)
- The `fetchFromPython()` function is used by server-side code (DataProvider)
- Type definitions in `market-simulator.ts` should match Python engine response shapes
- Never resurrect `upstox-client.ts` for actual API calls — all calls go through Python engine

## Verification

- DataProvider methods return correct data types
- `fetchAPI()` properly serializes query parameters
- Type definitions match Python engine responses
