import os
from dotenv import load_dotenv

load_dotenv()

# ============ Upstox Credentials ============
UPSTOX_ACCESS_TOKEN = os.environ.get("UPSTOX_ACCESS_TOKEN", "")
UPSTOX_API_KEY = os.environ.get("UPSTOX_API_KEY", "")


def update_access_token(token: str):
    """Update the Upstox access token globally at runtime."""
    global UPSTOX_ACCESS_TOKEN
    UPSTOX_ACCESS_TOKEN = token


# ============ Market Config ============
MARKET_OPEN_TIME = "09:15"
MARKET_CLOSE_TIME = "15:30"

UNDERLYING_CONFIG = {
    "NIFTY": {
        "base_price": 23500,
        "strike_step": 50,
        "lot_size": 25,
        "volatility": 0.13,
        "display_name": "NIFTY 50",
        "upstox_key": "NSE_INDEX|Nifty 50",
    },
    "BANKNIFTY": {
        "base_price": 51000,
        "strike_step": 100,
        "lot_size": 15,
        "volatility": 0.14,
        "display_name": "NIFTY Bank",
        "upstox_key": "NSE_INDEX|Nifty Bank",
    },
}

RISK_FREE_RATE = 0.07

# ============ Database ============
DB_PATH = os.environ.get("DUCKDB_PATH", "python-engine/data/trading.duckdb")

# ============ Data Mode ============
# ONLY two modes allowed: "live" (Upstox API) or "replay" (from DB)
# NO SIMULATION. NO MOCK DATA.
DATA_MODE = "live"

# ============ CORS ============
CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "*").split(",")

# ============ Timeframe Mapping ============
TIMEFRAME_MAP = {
    "1m": 60,
    "3m": 180,
    "5m": 300,
    "15m": 900,
    "1h": 3600,
}

UPSTOX_TIMEFRAME_MAP = {
    "1m": "1minute",
    "3m": "3minute",
    "5m": "5minute",
    "15m": "15minute",
    "1h": "1hour",
    "1d": "1day",
}
