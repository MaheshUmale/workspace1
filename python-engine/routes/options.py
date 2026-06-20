from fastapi import APIRouter, Query
from models import OptionChainResponse, MiniOptionChainResponse, OIResponse

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


@router.get("/chain", response_model=OptionChainResponse)
async def get_option_chain(
    underlying: str = Query("NIFTY"),
    expiry: str = Query("", description="Expiry date (YYYY-MM-DD)"),
):
    """Get full option chain. LIVE mode fetches from Upstox API."""
    engine = _get_engine()
    return await engine.get_option_chain_async(underlying, expiry)


@router.get("/chain/mini", response_model=MiniOptionChainResponse)
async def get_mini_option_chain(
    underlying: str = Query("NIFTY"),
    expiry: str = Query("", description="Expiry date (YYYY-MM-DD)"),
):
    """Get mini option chain (ATM ±10 strikes). LIVE mode from Upstox."""
    engine = _get_engine()
    return await engine.get_mini_option_chain_async(underlying, expiry)


@router.get("/oi", response_model=OIResponse)
async def get_oi_data(
    underlying: str = Query("NIFTY"),
    expiry: str = Query("", description="Expiry date (YYYY-MM-DD)"),
):
    """Get OI data across strikes. LIVE mode from Upstox."""
    engine = _get_engine()
    return await engine.get_oi_data_async(underlying, expiry)
