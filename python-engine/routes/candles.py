from fastapi import APIRouter, Query
from typing import List
from models import CandleData

router = APIRouter()


def _get_engine():
    """Get the engine instance, handling the __main__ vs main module split."""
    import sys
    main_mod = sys.modules.get("__main__")
    if main_mod and hasattr(main_mod, "engine") and main_mod.engine is not None:
        return main_mod.engine
    import main as main_module
    if hasattr(main_module, "engine") and main_module.engine is not None:
        return main_module.engine
    return None


@router.get("", response_model=List[CandleData])
async def get_candles(
    instrument_key: str = Query("NIFTY", description="Instrument key"),
    timeframe: str = Query("1m", description="Timeframe: 1m, 3m, 5m, 15m, 1h"),
):
    """Get candlestick data for an instrument. LIVE mode fetches from Upstox."""
    engine = _get_engine()
    return await engine.get_candles_async(instrument_key, timeframe)
