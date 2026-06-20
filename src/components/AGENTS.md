# DOX — React UI Components

## Purpose

Trading terminal UI components organized into two directories: `terminal/` (domain-specific trading components) and `ui/` (generic shadcn/ui primitives).

## Ownership

- `terminal/` — Business logic components specific to the options trading terminal
- `ui/` — shadcn/ui primitives (auto-generated, do NOT manually edit)

## Local Contracts

### terminal/spot-chart.tsx
- Main SPOT candlestick chart using lightweight-charts v5
- Canvas-based OI/COI horizontal bar overlay
- 100ms periodic redraw loop using `series.priceToCoordinate(strike)` for Y-axis zoom tracking
- CE bars extend LEFT (red), PE bars extend RIGHT (green) from center
- OI/COI toggle in chart header
- Handles timeframe changes with explicit redraw triggers after `fitContent()`

### terminal/option-chart.tsx
- Individual CE or PE option candlestick chart
- Uses `selectedStrike` (ATM) for strike selection — NOT middle-of-chain
- Skips fetch if no valid strike exists
- Timeframe selector in header

### terminal/instrument-search.tsx
- Search box with 300ms debounce
- Calls `/api/instruments/search?q=...` → Python engine → Upstox SDK
- Expected response: `{ results: [{ instrument_key, trading_symbol, name, expiry, strike, option_type, lot_size, underlying }] }`
- On selection: updates `underlying`, `expiry`, `selectedStrike`, `selectedOptionType` in Zustand store
- ESC key closes dropdown

### terminal/mini-option-chain.tsx
- Table showing ATM ±10 strikes with CE/PE LTP, OI, Change OI
- Resizable panel via separator
- Click on strike to select it for option charts

### terminal/pcr-chart.tsx
- PCR history chart (small area chart)
- Shows current PCR value with color coding

### terminal/top-bar.tsx
- Header bar: logo, underlying selector, instrument search, connection status, settings
- 48px height (`h-12`)

### terminal/connection-status.tsx
- Shows LIVE/OFFLINE/SIM badge based on Python engine health

### terminal/upstox-config-dialog.tsx
- Dialog for entering/updating Upstox access token
- POSTs to `/api/config/upstox` → Python engine validates via SDK

### terminal/quick-order.tsx
- Order panel with BUY/SELL, MARKET/LIMIT, lot size controls
- Currently display-only (no actual order execution)

### terminal/timeframe-selector.tsx
- Button group for timeframe selection (1m, 3m, 5m, 15m, 1h)

### ui/* (shadcn/ui)
- Auto-generated component primitives — DO NOT manually edit
- Installed via shadcn CLI, configured in `components.json`

## Work Guidance

- Always use shadcn/ui components for UI primitives
- Canvas OI overlay must use `priceToCoordinate()` for Y-axis tracking
- When adding new trading components, place them in `terminal/` directory
- Use `fetchAPI()` for all API calls — never call Python engine directly from browser

## Verification

- Charts render with correct candle data (OHLCV)
- OI overlay bars scale with Y-axis on zoom/pan
- Search returns results for queries like "NIFTY 23900 CE"
- Option chain table shows ATM ±10 strikes
