# Task 4-6: Trading Terminal Frontend

## Status
Completed

## Date
2026-06-20

## Summary
Built the complete Indian options trading terminal frontend as a Next.js 16 application with dark theme, real-time data via Socket.io, lightweight-charts for candlestick visualization, and resizable panel layout.

## Architecture

### File Structure Created
```
src/
├── app/
│   ├── page.tsx                    # Main trading terminal layout
│   ├── layout.tsx                  # Updated with dark theme
│   ├── globals.css                 # Custom dark theme variables
│   └── 7strike/page.tsx            # 7-Strike system route
├── components/
│   ├── terminal/
│   │   ├── top-bar.tsx             # Search bar, underlying selector, controls
│   │   ├── instrument-search.tsx   # Searchable combobox for instruments
│   │   ├── spot-chart.tsx          # Spot chart with OI overlay (lightweight-charts v5)
│   │   ├── option-chart.tsx        # CE/PE option chart
│   │   ├── mini-option-chain.tsx   # ATM ±5 option chain table
│   │   ├── pcr-chart.tsx           # PCR triple chart (spot/PCR/chg PCR)
│   │   ├── quick-order.tsx         # Order placement panel
│   │   ├── timeframe-selector.tsx  # 1m|3m|5m|15m|1h buttons
│   │   └── connection-status.tsx   # WebSocket status indicator
│   └── seven-strike/
│       └── page.tsx                # 7-Strike system standalone page
├── hooks/
│   ├── use-trading-engine.ts       # Socket.io hook (dynamic import for SSR)
│   └── use-market-data.ts          # Market data fetching hook
├── store/
│   └── trading-store.ts            # Zustand store for terminal state
└── lib/
    └── chart-utils.ts              # lightweight-charts v5 helpers + format utilities
```

## Key Implementation Details

### lightweight-charts v5 API
- **Critical**: v5 uses `chart.addSeries(CandlestickSeries, options)` instead of v4's `chart.addCandlestickSeries(options)`
- Import series definitions: `import { CandlestickSeries, LineSeries, HistogramSeries } from 'lightweight-charts'`
- Helper functions in `chart-utils.ts`: `addCandlestickSeries()`, `addLineSeries()`, `addHistogramSeries()`

### Socket.io Dynamic Import
- `socket.io-client` cannot be imported at module level in Next.js SSR
- Used `import('socket.io-client').then(({ io }) => ...)` pattern in both `use-trading-engine.ts` and `seven-strike/page.tsx`
- Added `typeof window === 'undefined'` guard

### Dark Theme
- Background: `#0a0e17` (deep dark blue)
- Card backgrounds: `#111827`
- Borders: `#1f2937`
- Green (bullish): `#22c55e`, Red (bearish): `#ef4444`
- Gold (ATM): `#eab308`, Blue (accent): `#3b82f6`
- Custom CSS variables in `globals.css` override the default shadcn theme

### Layout
- Top bar: 48px fixed header with logo, search, underlying selector, spot price, connection status
- Main content: `react-resizable-panels` with vertical split (75/25)
  - Top 75%: Three horizontal chart panels (40/30/30)
  - Bottom 25%: Option chain (40%), PCR chart (35%), Order panel (25%)

### Zustand Store
- Central state for: underlying, expiry, strike, option type, timeframe, spot data, option chain, PCR data, connection status, order state
- Real-time updates from Socket.io events update the store directly

## API Integration
- All API calls use `fetchAPI()` helper with `XTransformPort=3031` query parameter
- Socket.io connects via `io('/?XTransformPort=3031')`
- Endpoints used: candles, option-chain/mini, instruments/expiries, pcr, 7strike/matrix, 7strike/signals

## Notes
- Trading engine must be running on port 3031 for live data
- Frontend gracefully handles backend unavailability (loading states, error handling)
- Custom scrollbar styling added to globals.css
- No test files written per requirements
