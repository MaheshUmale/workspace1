# DOX — Next.js Frontend (src/)

## Purpose

React-based trading terminal UI. Renders lightweight-charts v5 candlestick charts with canvas-based OI/COI horizontal bar overlays, option chain table, PCR indicator, 7-strike signal matrix, and order panel. All data flows through Next.js API routes that proxy to the Python engine.

## Ownership

- Framework: Next.js 16 with App Router
- Styling: Tailwind CSS 4 + shadcn/ui component library
- Charts: lightweight-charts v5 (TradingView)
- State: Zustand for client state
- All API calls use `fetchAPI()` utility → Next.js API routes → Python engine (port 3035)

## Local Contracts

### Data Flow
```
Component → hook (use-market-data) → fetchAPI('/api/...') → Next.js Route → Python Engine
                                                                         ↓
                                                                    Upstox SDK
```

### Component Hierarchy
```
page.tsx (root layout)
└── TradingTerminal
    ├── TopBar
    │   ├── UnderlyingSelector (NIFTY/BNF buttons)
    │   ├── InstrumentSearch (search box → SDK search)
    │   ├── ConnectionStatus
    │   └── Settings (Upstox config dialog)
    ├── SpotChart (main candlestick + OI/COI canvas overlay)
    ├── OptionChart (CE chart, left)
    ├── OptionChart (PE chart, right)
    ├── MiniOptionChain (ATM ±10 strikes table)
    ├── PCRChart (PCR history)
    └── QuickOrder (order panel)
```

### Key Rules
- NO direct Upstox API calls from TypeScript — everything proxied through Python engine
- `data-provider.ts` is a thin proxy — it calls `fetchFromPython()` which hits `http://localhost:3035`
- The old `upstox-client.ts` is NOT used — kept only for type reference
- `market-simulator.ts` provides TypeScript type definitions only — no simulation logic
- Canvas OI overlay on SpotChart uses 100ms periodic redraw loop with `priceToCoordinate()` for Y-axis scaling
- CE bars (red) extend LEFT, PE bars (green) extend RIGHT from center vertical line

### Store Shape (trading-store.ts)
- `underlying`: "NIFTY" | "BANKNIFTY"
- `expiry`: ISO date string (e.g., "2026-06-23")
- `selectedStrike`: number (ATM strike)
- `selectedOptionType`: "CE" | "PE"
- `optionChain`: array of chain rows
- `pcrData`: PCR history points
- `spotData`: { [symbol]: SpotTick }
- `expiries`: string[] of expiry dates
- `isLive`: boolean

## Work Guidance

- When adding new data endpoints: 1) Add Python route, 2) Add Next.js API route proxy, 3) Add DataProvider method, 4) Add hook, 5) Use in component
- Canvas overlay must use `priceToCoordinate()` — never assume fixed pixel positions
- All shadcn/ui components are pre-installed in `components/ui/` — use them, don't rebuild
- Chart candle sanitization: filter out `close < low`, `close > high`, `open < low`, `open > high`, `high < low`, `time <= 0`
- The search component sends `q` parameter (not `query`) — API routes must handle both

## Verification

- `bun run lint` must pass with 0 errors
- Page must render on `/` route only
- Footer must be sticky to viewport bottom
- Responsive design on mobile and desktop

## Child DOX Index

- `components/AGENTS.md` — React UI components
- `hooks/AGENTS.md` — Custom React hooks
- `store/AGENTS.md` — Zustand state management
- `lib/AGENTS.md` — Utility libraries and data provider
- `app/AGENTS.md` — Next.js App Router pages and API routes
