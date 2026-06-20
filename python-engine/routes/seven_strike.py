from fastapi import APIRouter, Query
from typing import List
from models import (
    SevenStrikeMatrix, SevenStrikeSignals, SevenStrikeHistory,
    TradeSuggestion
)

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


@router.get("/matrix", response_model=SevenStrikeMatrix)
async def get_7strike_matrix(
    underlying: str = Query("NIFTY"),
    expiry: str = Query(""),
):
    """Get 7-Strike COI PCR Matrix (ATM ±3 strikes). LIVE mode from Upstox OI data."""
    engine = _get_engine()
    return await engine.get_7strike_matrix_async(underlying, expiry)


@router.get("/signals", response_model=SevenStrikeSignals)
async def get_7strike_signals(
    underlying: str = Query("NIFTY"),
    expiry: str = Query(""),
):
    """Get current 7-Strike signals. LIVE mode computed from real OI data."""
    engine = _get_engine()
    return await engine.get_7strike_signals_async(underlying, expiry)


@router.get("/history", response_model=SevenStrikeHistory)
async def get_7strike_history(
    underlying: str = Query("NIFTY"),
    expiry: str = Query(""),
):
    """Get full 7-Strike history. LIVE mode from DuckDB-stored real data."""
    engine = _get_engine()
    return await engine.get_7strike_history_async(underlying, expiry)


@router.get("/trades", response_model=List[TradeSuggestion])
async def get_7strike_trades(
    underlying: str = Query("NIFTY"),
    expiry: str = Query(""),
):
    """Get trade suggestions. LIVE mode from real option prices + signals."""
    engine = _get_engine()
    return await engine.get_7strike_trade_suggestions_async(underlying, expiry)
