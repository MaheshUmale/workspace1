# Task 2: Node.js Trading Engine Mini-Service (Rewrite)

## Status
Completed

## Date
2026-06-20

## Summary
Replaced the Python FastAPI trading engine (port 3031) and the separate Node.js WS relay (port 3032) with a single unified Node.js/Bun service on port 3031. The service combines REST API endpoints and Socket.io real-time data relay, eliminating the inter-process communication issues that caused the Python engine to crash (likely due to DuckDB).

## Architecture
- **Single service** on port 3031 with Express + Socket.io
- **In-memory data structures only** (no DuckDB, no Redis)
- **Market simulator** generates realistic NIFTY/BANKNIFTY data every 1 second
- **Socket.io** directly broadcasts to connected frontend clients (no relay needed)
- **Bun --hot** for development auto-restart

## Files Created/Modified

### Core Files
- `package.json` - bun package with express + socket.io, `bun --hot index.ts`
- `types.ts` - All TypeScript type definitions (instruments, candles, options, PCR, 7-strike, signals, etc.)
- `market-simulator.ts` - Complete market data simulator with GBM spot generation, Black-Scholes pricing, OI simulation, 7-Strike matrix/signals
- `index.ts` - Main entry: Express server + Socket.io + simulation engine loops

### Route Files
- `routes/instruments.ts` - GET /api/instruments/search, GET /api/instruments/expiries
- `routes/candles.ts` - GET /api/candles (with lightweight-charts compatible format)
- `routes/options.ts` - GET /api/option-chain, GET /api/option-chain/mini
- `routes/pcr.ts` - GET /api/pcr, GET /api/oi-data
- `routes/seven-strike.ts` - GET /api/7strike/matrix, GET /api/7strike/signals
- `routes/replay.ts` - GET /api/replay/sessions, POST /api/replay/start

### Removed (Python files)
- main.py, config.py, models.py, db.py, data_simulator.py, market_engine.py, upstox_client.py, start.sh, trading_engine.db.wal
- routes/__init__.py, routes/instruments.py, routes/candles.py, routes/options.py, routes/pcr.py, routes/seven_strike.py, routes/replay.py

## API Endpoints (12 total)
1. `GET /api/health` - Health check with uptime, tick count, connection count
2. `GET /api/instruments/search?q={query}` - Search instruments
3. `GET /api/instruments/expiries?underlying={symbol}` - Get expiry dates (Thursdays)
4. `GET /api/candles?instrument_key={key}&timeframe={1m|3m|5m|15m|1h}` - Candlestick data
5. `GET /api/option-chain?underlying={symbol}&expiry={date}` - Full option chain (ATM ± 10)
6. `GET /api/option-chain/mini?underlying={symbol}&expiry={date}` - Mini chain (ATM ± 5)
7. `GET /api/oi-data?instrument_key={key}` - OI time series
8. `GET /api/pcr?underlying={symbol}&expiry={date}` - PCR data
9. `GET /api/7strike/matrix?underlying={symbol}&expiry={date}` - 7-Strike COI PCR Matrix
10. `GET /api/7strike/signals?underlying={symbol}&expiry={date}` - 7-Strike signals
11. `GET /api/replay/sessions` - List replay sessions
12. `POST /api/replay/start` - Start replay session

## Socket.io Events (emitted directly to clients)
- `spot_tick` - Real-time spot price data for NIFTY/BANKNIFTY
- `option_tick` - Individual option strike updates (room: `instrument:{key}`)
- `oi_update` - OI data for ATM ± 5 strikes
- `pcr_update` - PCR value with change tracking
- `7strike_update` - Full matrix + signals (every 5 seconds)

## Key Bug Fix
- **nextThursday**: Python `weekday()` uses Monday=0 (so Thursday=3), but JavaScript `getDay()` uses Sunday=0 (Thursday=4). Fixed the calculation from `(3 - day + 7) % 7` to `(4 - day + 7) % 7`.

## Key Design Decisions
1. **No DuckDB** - In-memory only to avoid the crashes that plagued the Python version
2. **Unified service** - Combined trading engine + WS relay eliminates inter-process failures
3. **Socket.io default path** (`/socket.io/`) - NOT `path: '/'` which breaks Express routes (verified in Task 3)
4. **Candle format**: `{ time: epoch_seconds, open, high, low, close, volume }` - compatible with lightweight-charts
5. **All timestamps in epoch milliseconds** (except candle `time` which is epoch seconds)

## Frontend Connection
```typescript
import { io } from 'socket.io-client';
// Connect via Caddy gateway
const socket = io("/?XTransformPort=3031");
socket.on("spot_tick", (data) => { /* handle */ });

// REST API requests
fetch('/api/option-chain?underlying=NIFTY&XTransformPort=3031')
```

## Testing Results
All 12 endpoints tested and returning correct data:
- Health: returns uptime, tick count, connection count
- Expiries: correctly generates upcoming Thursdays (verified June 25, July 2, etc.)
- Option chain: 21 rows (ATM ± 10), proper BS pricing, Greeks, IV smile, OI patterns
- Mini chain: 11 rows (ATM ± 5)
- Candles: 200 candles with proper OHLCV format for lightweight-charts
- PCR: 100 data points with change tracking
- 7-Strike Matrix: 7 strikes with COI PCR calculation, state tracking
- 7-Strike Signals: IDLE/ZONE_WATCH/ACTIVE states with confidence scoring
- OI Data: 100 time-series points
- Replay: 10 demo sessions, start endpoint working
- Socket.io: Handshake verified, events emitting every 1 second (spot_tick) and 5 seconds (7strike_update)
