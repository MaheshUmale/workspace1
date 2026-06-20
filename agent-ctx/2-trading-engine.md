# Task 2: Python Trading Engine Mini-Service

## Summary
Created a Python FastAPI backend service at `/home/z/my-project/mini-services/trading-engine/` and a WebSocket relay service at `/home/z/my-project/mini-services/ws-relay/`.

## Architecture
- **Trading Engine** (port 3031): Python FastAPI service with realistic NIFTY/BANKNIFTY market data simulation
- **WS Relay** (port 3032): Node.js Socket.io relay service that receives events from the trading engine and broadcasts to frontend clients

## Files Created

### Trading Engine (`mini-services/trading-engine/`)
- `package.json` - bun package with "dev": "python3 main.py"
- `main.py` - FastAPI app entry point with uvicorn on port 3031
- `config.py` - Configuration (Upstox credentials, market configs, etc.)
- `models.py` - Pydantic models for all data types
- `db.py` - DuckDB connection and schema management
- `data_simulator.py` - Realistic NIFTY/BANKNIFTY market data generator
- `upstox_client.py` - Upstox API integration (for live mode)
- `market_engine.py` - Core market data engine orchestrating sim/real data + event pushing
- `routes/__init__.py` - Routes package init
- `routes/instruments.py` - Search & instrument routes
- `routes/candles.py` - Candlestick data routes
- `routes/options.py` - Option chain routes
- `routes/pcr.py` - PCR and OI data routes
- `routes/seven_strike.py` - 7-Strike COI PCR Matrix and signal routes
- `routes/replay.py` - Replay session routes
- `start.sh` - Startup script

### WS Relay (`mini-services/ws-relay/`)
- `package.json` - bun package with socket.io and express
- `index.ts` - Socket.io relay service on port 3032

## API Endpoints (all on port 3031)
1. `GET /api/instruments/search?q={query}` - Search instruments
2. `GET /api/instruments/expiries?underlying={symbol}` - Get expiry dates
3. `GET /api/candles?instrument_key={key}&timeframe={1m|3m|5m|15m|1h}` - Get candlestick data
4. `GET /api/option-chain?underlying={symbol}&expiry={date}` - Full option chain (ATM ± 10)
5. `GET /api/option-chain/mini?underlying={symbol}&expiry={date}` - Mini option chain (ATM ± 5)
6. `GET /api/oi-data?instrument_key={key}` - OI time series data
7. `GET /api/pcr?underlying={symbol}&expiry={date}` - PCR data
8. `GET /api/7strike/matrix?underlying={symbol}&expiry={date}` - 7-Strike COI PCR Matrix
9. `GET /api/7strike/signals?underlying={symbol}&expiry={date}` - 7-Strike system signals
10. `GET /api/replay/sessions` - List replay sessions
11. `POST /api/replay/start` - Start replay session
12. `GET /api/health` - Health check

## Key Features Implemented
- Realistic NIFTY (~23500) and BANKNIFTY (~51000) simulation with proper volatility
- Option chain with Black-Scholes pricing and Greeks
- 7-Strike COI PCR Matrix with window shift detection and stabilization protocol
- Signal generation based on COI PCR thresholds (bullish/bearish bias)
- Real-time data push via Socket.io relay (spot_tick, option_tick, pcr_update, 7strike_update)
- DuckDB for historical data storage with proper schema
- In-memory caching (no Redis dependency)
- CORS enabled for all origins

## Python Dependencies
- fastapi, uvicorn, httpx, duckdb, pydantic (installed via pip --break-system-packages)
- PATH includes `$HOME/.local/bin` for uvicorn

## How to Start
```bash
# Start WS relay
cd mini-services/ws-relay && bun run dev

# Start Trading Engine
cd mini-services/trading-engine && PATH="$HOME/.local/bin:$PATH" python3 main.py
```

## Testing
All 12 endpoints tested and returning correct data. The simulation generates realistic Indian market data with:
- Proper NIFTY strike intervals (50 points)
- Realistic IV smile
- Black-Scholes Greeks
- OI patterns that follow institutional behavior
- COI PCR calculations matching the 7-Strike System document

## Notes
- Services need to be kept running in background for frontend consumption
- Frontend should connect to WS relay via: `io("/?XTransformPort=3032")`
- API requests should use: `/api/endpoint?XTransformPort=3031`
