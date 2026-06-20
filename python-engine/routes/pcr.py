from fastapi import APIRouter, Query
from models import PCRResponse

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


@router.get("", response_model=PCRResponse)
async def get_pcr(
    underlying: str = Query("NIFTY"),
    expiry: str = Query("", description="Expiry date (YYYY-MM-DD)"),
):
    """Get PCR history and current values. LIVE mode from DB-stored live data."""
    engine = _get_engine()
    return await engine.get_pcr_async(underlying, expiry)
