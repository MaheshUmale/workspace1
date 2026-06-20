from fastapi import APIRouter, Query
from typing import List
from models import ReplaySession

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


@router.get("/sessions", response_model=List[ReplaySession])
async def get_replay_sessions():
    """Get available replay sessions"""
    engine = _get_engine()
    return engine.get_replay_sessions()


@router.post("/start")
async def start_replay(session_id: str = Query(..., description="Session ID to replay")):
    """Start a replay session"""
    engine = _get_engine()
    return engine.start_replay(session_id)
