from fastapi import APIRouter, Query
from typing import List
from models import Instrument, ExpiryInfo, ExpiriesResponse

router = APIRouter()


@router.get("/search")
async def search_instruments(q: str = Query("", description="Search query")):
    """Search instruments by human-readable query like 'NIFTY 23900 CE'

    Uses the Upstox SDK InstrumentsApi.search_instrument() for live search.
    Returns results in the format expected by the frontend search component.
    """
    from main import engine
    if not q or len(q) < 2:
        return {"results": []}

    results = await engine.search_instruments_async(q)
    return {"results": results}


@router.get("/expiries", response_model=ExpiriesResponse)
async def get_expiries(underlying: str = Query("NIFTY")):
    """Get available expiry dates for an underlying"""
    from main import engine
    expiries = await engine.get_expiries_async(underlying)
    return {"underlying": underlying, "expiries": expiries}
