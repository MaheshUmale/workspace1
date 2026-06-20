import uvicorn
import time
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from config import CORS_ORIGINS, UPSTOX_ACCESS_TOKEN
from db import get_db
from market_engine import MarketEngine

# Global engine instance
engine: MarketEngine = None
start_time = time.time()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global engine
    engine = MarketEngine()
    await engine.initialize()
    yield
    engine.shutdown()


app = FastAPI(
    title="7Strike Trading Engine",
    description="Python backend for Indian Options Trading Terminal - 7-Strike COI PCR Signal Engine",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Import and register routes
from routes import instruments, candles, options, pcr, seven_strike, replay

app.include_router(instruments.router, prefix="/api/instruments", tags=["Instruments"])
app.include_router(candles.router, prefix="/api/candles", tags=["Candles"])
app.include_router(options.router, prefix="/api/options", tags=["Options"])
app.include_router(pcr.router, prefix="/api/pcr", tags=["PCR"])
app.include_router(seven_strike.router, prefix="/api/7strike", tags=["7-Strike"])
app.include_router(replay.router, prefix="/api/replay", tags=["Replay"])


# Health endpoint
@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "mode": engine.mode if engine else "unknown",
        "connected": engine.is_connected if engine else False,
        "upstox_configured": bool(UPSTOX_ACCESS_TOKEN),
        "masked_token": (UPSTOX_ACCESS_TOKEN[:10] + "****" + UPSTOX_ACCESS_TOKEN[-4:]) if UPSTOX_ACCESS_TOKEN else "",
        "uptime": time.time() - start_time,
        "symbols": ["NIFTY", "BANKNIFTY"],
        "tick_count": engine.tick_count if engine else 0,
        "timestamp": int(time.time() * 1000),
    }


# Config endpoint — GET: check Upstox connection status
@app.get("/api/config/upstox")
async def config_upstox_get():
    masked = (UPSTOX_ACCESS_TOKEN[:10] + "****" + UPSTOX_ACCESS_TOKEN[-4:]) if UPSTOX_ACCESS_TOKEN else ""
    return {
        "configured": bool(UPSTOX_ACCESS_TOKEN),
        "mode": engine.mode if engine else "offline",
        "connected": engine.is_connected if engine else False,
        "masked_token": masked,
    }


# Config endpoint — POST: update Upstox access token at runtime
@app.post("/api/config/upstox")
async def config_upstox_post(req: Request):
    """Update Upstox access token at runtime.

    Accepts JSON body: { "access_token": "..." }
    Validates the token against Upstox API and switches to LIVE mode if valid.
    """
    body = await req.json()
    token = body.get("access_token", "")
    if not token:
        return {"success": False, "mode": engine.mode, "error": "access_token is required"}
    result = await engine.update_access_token(token)
    return result


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 3035))

    uvicorn.run(app, host="0.0.0.0", port=port)
