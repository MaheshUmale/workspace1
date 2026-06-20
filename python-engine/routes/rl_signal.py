"""
RL Signal Routes — FastAPI endpoints for RL model signals
===========================================================
Adds 3 new endpoints to the 7Strike Python engine:

  GET  /api/rl/signal       — Current RL signal (action, confidence, model breakdown)
  GET  /api/rl/status       — Engine health + model loading status
  POST /api/rl/feedback     — Submit trade outcome for orchestrator weight update

Integration with market_engine:
    The RL engine reads from market_engine._live_chain_cache[symbol]
    to get live data. No duplicate API calls to Upstox.
"""

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel
from typing import Optional

router = APIRouter()

# ── Singleton RL engine ───────────────────────────────────────

_rl_engine = None


def get_rl_engine():
    """Get or create the RL signal engine singleton."""
    global _rl_engine
    if _rl_engine is not None:
        return _rl_engine

    try:
        from rl_engine import RLSignalEngine

        # Path to trading-rl project — configure via env var or default
        import os
        trading_rl_path = os.environ.get(
            "TRADING_RL_PATH",
            os.path.join(os.path.dirname(__file__), "..", "..", "trading-rl")
        )
        trading_rl_path = os.path.abspath(trading_rl_path)

        _rl_engine = RLSignalEngine(trading_rl_path)
        _rl_engine.load_models()
        return _rl_engine

    except FileNotFoundError as e:
        print(f"[RL Routes] Trading-RL models not found: {e}")
        print("[RL Routes] Set TRADING_RL_PATH env var to your trading-rl directory")
        return None
    except Exception as e:
        print(f"[RL Routes] Failed to initialize RL engine: {e}")
        import traceback
        traceback.print_exc()
        return None


def _get_market_engine():
    """Get the 7Strike market engine instance."""
    import sys
    main_mod = sys.modules.get("__main__")
    if main_mod and hasattr(main_mod, "engine"):
        return main_mod.engine
    import main as main_module
    if hasattr(main_module, "engine"):
        return main_module.engine
    return None


# ── Response Models ───────────────────────────────────────────

class RLFeedbackRequest(BaseModel):
    """Trade outcome feedback for orchestrator weight update."""
    symbol: str = "NIFTY"
    was_profitable: bool
    pnl: float = 0.0
    trade_id: Optional[str] = None


# ── Endpoints ─────────────────────────────────────────────────

@router.get("/signal")
async def get_rl_signal(
    underlying: str = Query("NIFTY"),
):
    """
    Get current RL signal for the specified underlying.
    
    The RL engine processes live data from the market engine's cache
    and returns a consensus-based trading signal.
    
    Response:
        action: "BUY_CALL" | "BUY_PUT" | "NO_TRADE"
        confidence: 0.0-1.0
        consensus: 0-3 (how many models agree)
        reasoning: human-readable explanation
        models: per-model bullish/bearish breakdown
        ready: false until 500 bars of warmup are accumulated
    """
    rl = get_rl_engine()
    if rl is None:
        return {
            "action": "NO_TRADE",
            "confidence": 0.0,
            "consensus": 0,
            "reasoning": "RL engine not initialized — check TRADING_RL_PATH",
            "models": {},
            "position_open": False,
            "position_type": "flat",
            "bars_processed": 0,
            "ready": False,
        }

    # Get live data from 7Strike market engine cache
    market = _get_market_engine()
    if market is None:
        return {
            "action": "NO_TRADE",
            "confidence": 0.0,
            "consensus": 0,
            "reasoning": "Market engine not available",
            "models": {},
            "position_open": False,
            "position_type": "flat",
            "bars_processed": 0,
            "ready": False,
        }

    cache = market._live_chain_cache.get(underlying)
    if cache is None:
        return {
            "action": "NO_TRADE",
            "confidence": 0.0,
            "consensus": 0,
            "reasoning": f"No live data cached for {underlying}",
            "models": {},
            "position_open": False,
            "position_type": "flat",
            "bars_processed": 0,
            "ready": False,
        }

    # Process the live tick and get RL signal
    signal = rl.process_live_tick(cache)
    return {
        "action": signal.action,
        "confidence": signal.confidence,
        "consensus": signal.consensus,
        "reasoning": signal.reasoning,
        "models": signal.models,
        "position_open": signal.position_open,
        "position_type": signal.position_type,
        "bars_processed": signal.bars_processed,
        "ready": signal.ready,
    }


@router.get("/status")
async def get_rl_status():
    """
    RL engine health check.
    
    Returns model loading status, bars processed, and orchestrator state.
    Use this to show an RL status indicator in the frontend.
    """
    rl = get_rl_engine()
    if rl is None:
        return {
            "initialized": False,
            "models_loaded": [],
            "error": "RL engine not found — set TRADING_RL_PATH",
        }

    status = rl.get_status()
    return {
        "initialized": True,
        "models_loaded": status.get("models_loaded", []),
        "running": status.get("running", False),
        "bars_processed": status.get("bar_count", 0),
        "signals_generated": status.get("signals_generated", 0),
        "capital": status.get("capital", 0),
        "drawdown": status.get("drawdown", 0),
        "total_trades": status.get("total_trades", 0),
        "orchestrator": status.get("orchestrator", {}),
        "position": status.get("position", "flat"),
    }


@router.post("/feedback")
async def submit_feedback(req: RLFeedbackRequest):
    """
    Submit trade outcome for orchestrator weight update.
    
    After a trade closes (SL hit, TP hit, or manual close), call this
    endpoint with the outcome. The orchestrator will adjust its model
    weights based on which models predicted the correct direction.
    
    This is how the system "learns" in production without retraining.
    """
    rl = get_rl_engine()
    if rl is None:
        return {"success": False, "error": "RL engine not initialized"}

    if not rl._live_engine:
        return {"success": False, "error": "Live engine not running"}

    # Update accuracy for all 3 model channels
    for model_id in ["spot_direction", "oi_dynamics", "skew_vol"]:
        rl._live_engine.orchestrator.update_accuracy(
            model_id, req.was_profitable
        )

    return {
        "success": True,
        "symbol": req.symbol,
        "was_profitable": req.was_profitable,
        "updated_weights": rl._live_engine.orchestrator.get_summary().get(
            "weights", {}
        ),
    }