# 7Strike Terminal — Architecture Document

> Complete system architecture for the Indian Options Trading Terminal with 7-Strike COI PCR Signal System.

---

## 1. System Overview

7Strike Terminal is a real-time Indian options trading platform that fetches live market data from Upstox, computes option chain analytics (OI, COI, PCR), and generates trading signals using a 7-strike COI PCR methodology. The system has two runtime components: a Python FastAPI backend that interfaces with Upstox via the official Python SDK, and a Next.js frontend that renders interactive charts and the trading UI.

### Design Principles

| Principle | Implementation |
|---|---|
| **Single API Gateway** | All Upstox API calls go through the Python engine — the TypeScript frontend NEVER calls Upstox directly |
| **Official SDK Only** | Uses `upstox-python-sdk` v2.27.0 (not raw HTTP calls) for robustness, proper auth, and v2/v3 API handling |
| **No Simulation** | LIVE data only. If Upstox is offline, return empty data. No mock/simulated data ever |
| **Thin Proxy Pattern** | Next.js API routes are stateless proxies — no business logic in the frontend backend |
| **Async SDK Wrapping** | Synchronous SDK calls wrapped in `run_in_executor` to prevent blocking FastAPI's event loop |

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BROWSER                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    React Application                               │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │    │
│  │  │Spot Chart│ │ CE Chart │ │ PE Chart │ │ OI Table │ │  PCR    │ │    │
│  │  │+OI Canvas│ │          │ │          │ │ ATM±10   │ │ Chart   │ │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └─────────┘ │    │
│  │                          │                                         │    │
│  │              ┌───────────┴───────────┐                             │    │
│  │              │   Zustand Store       │                             │    │
│  │              │ underlying, expiry,   │                             │    │
│  │              │ strike, optionChain,  │                             │    │
│  │              │ pcrData, spotData     │                             │    │
│  │              └───────────────────────┘                             │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    │                                       │
│                          fetchAPI('/api/...')                              │
│                                    │                                       │
└────────────────────────────────────┼────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     NEXT.JS (PORT 3000)                                     │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    API Route Proxies                               │    │
│  │                                                                     │    │
│  │  /api/candles          →  Python /api/candles                       │    │
│  │  /api/option-chain     →  Python /api/options/chain                 │    │
│  │  /api/option-chain/mini→  Python /api/options/chain/mini            │    │
│  │  /api/instruments/...  →  Python /api/instruments/...               │    │
│  │  /api/pcr              →  Python /api/pcr                           │    │
│  │  /api/oi-data          →  Python /api/options/oi                    │    │
│  │  /api/health           →  Python /api/health                        │    │
│  │  /api/config/upstox    →  Python /api/config/upstox                 │    │
│  │  /api/7strike/...      →  Python /api/7strike/...                   │    │
│  │  /api/replay/...       →  Python /api/replay/...                    │    │
│  │                                                                     │    │
│  │  Each proxy: parse params → fetch(localhost:3035) → return JSON    │    │
│  │  Timeout: 15s (AbortSignal.timeout)                                 │    │
│  │  Error fallback: return empty default data (never 500)             │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  Data Provider (server-side) — thin proxy to Python engine                  │
│  fetchFromPython(path, params) → http://localhost:3035 + 15s timeout        │
│                                                                             │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
                          http://localhost:3035
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     PYTHON ENGINE (PORT 3035)                               │
│                     FastAPI + Uvicorn (ASGI)                                │
│                                                                             │
│  ┌─────────────────┐  ┌──────────────────────────────────────────────┐     │
│  │   main.py       │  │           MarketEngine (singleton)          │     │
│  │   - CORS        │  │                                              │     │
│  │   - Lifespan    │  │  - Token validation on startup             │     │
│  │   - Health      │  │  - Periodic update loop (every 3s)         │     │
│  │   - Config      │  │  - 7-strike computation                    │     │
│  │   - Routes      │  │  - Data access methods (async)             │     │
│  └─────────────────┘  │                                              │     │
│                        │  Uses: UpstoxClient (upstox_api.py)          │     │
│  ┌─────────────────┐  │                                              │     │
│  │   Routes        │  │  ┌─────────────────────────────────────┐    │     │
│  │   /instruments  │──┤  │       UpstoxClient                  │    │     │
│  │   /candles      │  │  │                                     │    │     │
│  │   /options      │  │  │  All SDK calls wrapped in           │    │     │
│  │   /pcr          │  │  │  run_in_executor (ThreadPool)       │    │     │
│  │   /7strike      │  │  │                                     │    │     │
│  │   /replay       │  │  │  SDK API classes:                   │    │     │
│  └─────────────────┘  │  │   UserApi      (validate token)    │    │     │
│                        │  │   HistoryApi   (candles)           │    │     │
│  ┌─────────────────┐  │  │   OptionsApi   (option chain)      │    │     │
│  │   db.py         │  │  │   InstrumentsApi (search/expiry)   │    │     │
│  │   DuckDB        │  │  │   MarketQuoteApi (LTP)             │    │     │
│  │   - Candles     │  │  │                                     │    │     │
│  │   - Snapshots   │  │  │  Caching: 5s default, 30s search   │    │     │
│  │   - PCR history │  │  │           300s instrument cache     │    │     │
│  │   - Signals     │  │  └─────────────────────────────────────┘    │     │
│  │   - Trades      │  │                                              │     │
│  │   - Volume      │  └──────────────────────────────────────────────┘     │
│  └─────────────────┘                                                      │
│                                                                             │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
                          Official Upstox Python SDK
                          (upstox-python-sdk v2.27.0)
                                     │
                                     ▼
                        ┌─────────────────────────┐
                        │    UPSTOX REST API       │
                        │    api.upstox.com/v2     │
                        │    (mix of v2 + v3)      │
                        └─────────────────────────┘
```

---

## 3. Data Flow Details

### 3.1 Candle Data Flow

```
User selects timeframe → useMarketData.fetchCandles(key, tf)
  → fetchAPI('/api/candles', {instrument_key, timeframe})
  → Next.js GET /api/candles → Python GET /api/candles
  → MarketEngine.get_candles_async() → UpstoxClient.get_candles()
  → _run_sync(get_candles_sync)
  → HistoryApi.get_intra_day_candle_data(instrument_key, interval, api_version='2.0')
  → Response: [[timestamp, open, high, low, close, volume, oi], ...]
  → Next.js wraps: {instrument_key, timeframe, candles: [...]}
  → Frontend sanitizes (close ≥ low, close ≤ high, etc.)
  → Zustand store + lightweight-charts render
```

### 3.2 Option Chain Data Flow

```
User selects expiry → useMarketData.fetchOptionChain(symbol, expiry)
  → fetchAPI('/api/option-chain/mini', {underlying, expiry})
  → Next.js GET /api/option-chain/mini → Python GET /api/options/chain/mini
  → MarketEngine.get_mini_option_chain_async()
  → UpstoxClient.get_option_chain(underlying, expiry)
  → _run_sync(get_option_chain_sync)
  → OptionsApi.get_put_call_option_chain(instrument_key, expiry_date)
  → _convert_option_strike() maps SDK objects → plain dicts
  → change_in_oi = oi - prev_oi (computed from SDK fields)
  → MarketEngine filters to ATM ±10 strikes for mini chain
  → Frontend updates: optionChain, atmStrike, spotData in Zustand
  → MiniOptionChain table + OI canvas overlay render
```

### 3.3 Expiry Data Flow

```
User changes underlying → useMarketData.fetchExpiries(symbol)
  → fetchAPI('/api/instruments/expiries', {underlying})
  → Next.js GET /api/instruments/expiries → Python GET /api/instruments/expiries
  → MarketEngine.get_expiries_async()
  → UpstoxClient.get_expiries(underlying)
  → _run_sync(get_expiries_sync)
  → For each period in [current_month, next_month]:
      InstrumentsApi.search_instrument(query=search_query, expiry=period)
      Filter by underlying_key match
      Extract expiry_date, is_weekly flag
  → Returns: [{expiry_date, is_weekly, instrument_types, underlying_key}]
  → MarketEngine adds labels: "23 Jun 2026 (W)" / "30 Jun 2026 (M)"
  → Frontend: setExpiries(list of date strings), auto-select first
```

### 3.4 Instrument Search Data Flow

```
User types "NIFTY 23900 CE" → InstrumentSearch (300ms debounce)
  → fetchAPI('/api/instruments/search', {q: "NIFTY 23900 CE"})
  → Next.js GET /api/instruments/search?q=... → Python GET /api/instruments/search?q=...
  → MarketEngine.search_instruments_async(query)
  → UpstoxClient.search_instruments(query)
  → _run_sync(search_instruments_sync)
  → InstrumentsApi.search_instrument(query="NIFTY 23900 CE")
  → Maps: instrument_key, trading_symbol, underlying, strike, option_type, expiry, lot_size, weekly
  → Returns: {results: [SearchResult...]}
  → Frontend: user clicks result → updates underlying/expiry/strike/optionType in Zustand
```

---

## 4. Component Architecture

### 4.1 Frontend Component Tree

```
<TradingTerminal>
  ├── <TopBar>
  │   ├── Logo
  │   ├── <UnderlyingSelector> — NIFTY / BNF buttons
  │   ├── <InstrumentSearch> — Search box → SDK → select
  │   ├── <ConnectionStatus> — LIVE/OFFLINE badge
  │   └── <UpstoxConfigDialog> — Token input → POST /api/config/upstox
  │
  ├── <ResizablePanelGroup> (vertical)
  │   ├── <SpotChart> — lightweight-charts v5 + Canvas OI overlay
  │   │   ├── Candlestick series (OHLCV)
  │   │   ├── Volume histogram series
  │   │   └── Canvas overlay (100ms redraw loop):
  │   │       ├── Horizontal bars from center vertical line
  │   │       ├── CE bars extend LEFT (red)
  │   │       ├── PE bars extend RIGHT (green)
  │   │       ├── OI/COI toggle in header
  │   │       └── priceToCoordinate(strike) for Y-axis zoom
  │   │
  │   ├── <ResizablePanelGroup> (horizontal)
  │   │   ├── <OptionChart type="CE"> — CE candlestick
  │   │   └── <OptionChart type="PE"> — PE candlestick
  │   │
  │   └── <MiniOptionChain> — Table ATM ±10 strikes
  │       ├── CE: LTP | OI | Chg OI
  │       ├── Strike (center column)
  │       └── PE: Chg OI | OI | LTP
  │
  ├── <PCRChart> — Small area chart of PCR history
  └── <QuickOrder> — BUY/SELL, MARKET/LIMIT, lot size
```

### 4.2 Python Engine Module Structure

```
main.py (FastAPI app)
  ├── Lifespan: create MarketEngine singleton
  ├── CORS middleware (allow all origins)
  ├── Routes mounted with prefixes
  └── Health + Config endpoints

upstox_api.py (SDK integration layer)
  ├── _run_sync() — ThreadPool executor wrapper
  ├── _convert_option_strike() — SDK object → dict mapper
  ├── validate_token() → UserApi.get_profile()
  ├── get_option_chain() → OptionsApi.get_put_call_option_chain()
  ├── get_candles() → HistoryApi (intraday + historical)
  ├── get_expiries() → InstrumentsApi.search_instrument(expiry=current/next_month)
  ├── search_instruments() → InstrumentsApi.search_instrument(query=...)
  ├── get_ltp() → MarketQuoteApi.ltp()
  └── build_instrument_cache() — Pre-cache instruments for fast search

market_engine.py (orchestration layer)
  ├── initialize() — Validate token, set LIVE mode
  ├── _periodic_update() — Every 3s: fetch chain, compute PCR/signals
  ├── _transform_upstox_chain() — Convert API data to internal format
  ├── _compute_7strike_matrix_live() — ATM ±3 COI PCR calculation
  ├── _compute_signals_live() — LONG/SHORT/NEUTRAL thresholds
  └── Public data access methods (all async):
      ├── get_candles_async()
      ├── get_option_chain_async()
      ├── get_mini_option_chain_async()
      ├── get_oi_data_async()
      ├── get_pcr_async()
      ├── get_expiries_async()
      └── search_instruments_async()

db.py (DuckDB storage layer)
  ├── Singleton pattern
  ├── Tables: candles, option_chain_snapshots, pcr_history,
  │           coi_pcr_history, signals, trade_suggestions,
  │           volume_proxy, trap_clusters, replay_sessions
  └── CRUD methods for each table
```

---

## 5. State Management

### 5.1 Zustand Store Structure

```typescript
interface TradingState {
  // Selection state
  underlying: "NIFTY" | "BANKNIFTY"
  expiry: string                // ISO date "2026-06-23"
  timeframe: "1m" | "3m" | "5m" | "15m" | "1h"
  selectedStrike: number        // User/ATM strike
  selectedOptionType: "CE" | "PE"

  // Market data
  optionChain: OptionChainRow[] // Current chain
  pcrData: PCRDataPoint[]      // PCR history
  spotData: Record<string, SpotTick>  // LTP per symbol
  expiries: string[]            // Available dates

  // Computed
  atmStrike: number             // Auto-computed from spot
  strikeStep: number            // 50 (NIFTY) / 100 (BANKNIFTY)
  isLive: boolean               // Connection status
}
```

### 5.2 Data Refresh Cycles

| Data | Trigger | Interval |
|------|---------|----------|
| Candles | User changes timeframe/underlying | On-demand (cached 30s-120s) |
| Option chain | Underlying/expiry change | 15 seconds |
| PCR | Underlying/expiry change | 15 seconds |
| Expiries | Underlying change | On-demand |
| Spot LTP | From last candle or option chain | Every 15s via chain refresh |
| 7-Strike | Python periodic update | 3 seconds (server-side) |

---

## 6. Key Mappings

### 6.1 Instrument Key Mapping

| Display | Upstox API Key |
|---------|---------------|
| NIFTY | `NSE_INDEX\|Nifty 50` |
| BANKNIFTY | `NSE_INDEX\|Nifty Bank` |

### 6.2 Timeframe Mapping

| UI | Upstox API |
|----|-----------|
| 1m | 1minute |
| 3m | 3minute |
| 5m | 5minute |
| 15m | 15minute |
| 1h | 1hour |
| 1d | 1day |

### 6.3 API Version Mapping

| SDK Class | API Version | Notes |
|-----------|------------|-------|
| UserApi | v2.0 (`api_version='2.0'`) | Profile, token validation |
| HistoryApi | v2.0 (`api_version='2.0'`) | Intraday + historical candles |
| OptionsApi | Default (no version param) | Option chain |
| InstrumentsApi | Default | Search, expiries |
| MarketQuoteApi | v2.0 (`api_version='2.0'`) | LTP |

---

## 7. Caching Strategy

### 7.1 Python Engine Caching

| Data Type | TTL | Storage |
|-----------|-----|---------|
| Option chain | 5 seconds | In-memory dict |
| Candle data | 5 seconds | In-memory dict |
| Instrument search | 30 seconds | In-memory dict |
| Instrument cache | 300 seconds | In-memory dict |
| Expiry data | 5 seconds | In-memory dict |
| Historical data | Permanent | DuckDB |

### 7.2 Frontend Caching

| Data Type | TTL | Storage |
|-----------|-----|---------|
| 1m candles | 30 seconds | useRef per instrument+tf |
| 3m+ candles | 120 seconds | useRef per instrument+tf |
| Option chain | No cache | Refetch every 15s |

---

## 8. 7-Strike Signal Methodology

### 8.1 COI PCR Calculation

```
COI PCR = Σ(PE Change OI for ATM±3) / Σ(CE Change OI for ATM±3)
```

Where:
- ATM = spot price rounded to nearest strike step (50 for NIFTY, 100 for BANKNIFTY)
- Window = ATM + {-3, -2, -1, 0, +1, +2, +3} × strike_step
- Change OI = current OI - previous OI (from SDK fields `oi` and `prev_oi`)

### 8.2 Signal Thresholds

| COI PCR | Signal | Confidence | Meaning |
|---------|--------|------------|---------|
| > 1.5 | LONG | >80% | Strong PE buildup → Support → Bullish |
| 1.2–1.5 | LONG | 30–70% | Moderate PE dominance → Watch |
| 0.8–1.2 | NEUTRAL | Low | No clear bias |
| 0.6–0.8 | SHORT | 30–70% | Moderate CE dominance → Watch |
| < 0.6 | SHORT | >80% | Strong CE buildup → Resistance → Bearish |

### 8.3 State Classification

| COI PCR | State |
|---------|-------|
| > 1.5 or < 0.6 | ACTIVE |
| 1.2–1.5 or 0.6–0.8 | ZONE_WATCH |
| 0.8–1.2 | IDLE |

---

## 9. Canvas OI Overlay Architecture

The OI/COI horizontal bar overlay on the spot chart uses a dedicated canvas element rendered on top of the lightweight-charts canvas. This avoids modifying the charting library's internals.

### Implementation

```
┌─────────────────────────────────────────────────────┐
│  Spot Chart Container (relative positioning)         │
│                                                       │
│  ┌───────────────────────────────────────────────┐    │
│  │  lightweight-charts canvas                    │    │
│  │  (candlesticks + volume)                      │    │
│  └───────────────────────────────────────────────┘    │
│  ┌───────────────────────────────────────────────┐    │
│  │  OI overlay canvas (pointer-events: none)     │    │
│  │                                               │    │
│  │  ┌─────┐              ┌─────┐                │    │
│  │  │CE OI│──────────────│PE OI│                │    │
│  │  │ bar │  ← LEFT      │ bar │  RIGHT →      │    │
│  │  └─────┘              └─────┘                │    │
│  │         ▲ center line (ATM strike)           │    │
│  │                                               │    │
│  │  100ms periodic redraw loop:                  │    │
│  │  1. Get visible logical range                │    │
│  │  2. For each strike in option chain:         │    │
│  │     y = series.priceToCoordinate(strike)     │    │
│  │     Draw CE bar LEFT from center             │    │
│  │     Draw PE bar RIGHT from center            │    │
│  │  3. Scale bar widths to max OI               │    │
│  └───────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

Key technical decisions:
- `priceToCoordinate(strike)` respects current Y-axis zoom/pan — no stale positions
- 100ms redraw loop is more reliable than event-based subscriptions
- `pointer-events: none` on overlay canvas allows chart interaction to pass through
- CE bars (red) extend LEFT, PE bars (green) extend RIGHT for visual clarity

---

## 10. Security Considerations

| Concern | Mitigation |
|---------|-----------|
| Upstox token in `.env` | File is gitignored; token has 8-hour expiry |
| CORS | Python engine allows `*` in dev — restrict in production |
| SDK in backend only | `upstox_client` (SDK) never imported in frontend code |
| Input validation | Python routes validate required params; FastAPI handles type safety |
| Token update | Runtime token update via POST endpoint without server restart |

---

## 11. Deployment Notes

### Port Allocation

| Service | Port | Protocol |
|---------|------|----------|
| Next.js | 3000 | HTTP |
| Python Engine | 3035 | HTTP |
| Caddy Gateway | 81 | HTTP (reverse proxy) |

### Process Management

- Python engine: `uvicorn main:app --host 0.0.0.0 --port 3035`
- Next.js: `bun run dev` (development) or `next start` (production)
- Auto-restart: Shell wrapper with `while true` loop monitors process health

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `UPSTOX_ACCESS_TOKEN` | **Yes** | 8-hour validity, refresh from Upstox Developer Console |
| `UPSTOX_API_KEY` | No | For future OAuth flow |
| `DATABASE_URL` | No | Prisma SQLite path |
| `DUCKDB_PATH` | No | DuckDB analytics database path |
| `CORS_ORIGINS` | No | Comma-separated allowed origins |
