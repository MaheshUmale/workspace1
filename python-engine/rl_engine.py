"""
RL Signal Engine — Bridge between 7Strike Terminal and Trading-RL Models
=========================================================================
Loads 3 trained PPO models + orchestrator, converts 7Strike live data
to the format the RL system expects, and returns trading signals.

This module is self-contained — it imports from a separate `rl_models/`
package (the trading-rl source) and does NOT depend on market_engine
for anything other than reading its live data cache.

Usage:
    from rl_engine import RLSignalEngine

    engine = RLSignalEngine("/path/to/trading-rl/")
    engine.load_models()
    signal = engine.process_live_tick(market_engine._live_chain_cache["NIFTY"])
"""

import sys
import os
import time
import yaml
import numpy as np
import pandas as pd
from pathlib import Path
from typing import Optional, Dict, Any
from dataclasses import dataclass, asdict
from loguru import logger


@dataclass
class RLSignal:
    """RL system output — designed for the frontend to consume."""
    action: str              # "BUY_CALL", "BUY_PUT", "NO_TRADE"
    confidence: float        # 0.0 to 1.0
    consensus: int           # how many models agree (0-3)
    reasoning: str           # human-readable explanation
    models: Dict[str, Dict]  # per-model breakdown
    position_open: bool      # is RL engine currently in a position?
    position_type: str       # "call", "put", or "flat"
    bars_processed: int      # how many bars the engine has seen
    ready: bool              # has the engine accumulated enough bars?


class RLSignalEngine:
    """
    Wraps the Trading-RL system for use inside the 7Strike Python engine.
    
    Data flow:
        7Strike live_chain_cache → convert_to_bar_data() → LiveOrchestratedEngine.on_new_bar()
                                                                    ↓
                                                              RLSignal (JSON-serializable)
    """

    def __init__(self, trading_rl_path: str):
        """
        Args:
            trading_rl_path: Absolute path to the trading-rl project root
                             (contains src/, models/, config/, data/)
        """
        self.trading_rl_path = Path(trading_rl_path)
        self._live_engine = None
        self._loaded = False
        self._signal_count = 0

        # Add trading-rl/src to Python path so we can import its modules
        src_path = str(self.trading_rl_path / "src")
        if src_path not in sys.path:
            sys.path.insert(0, src_path)

        logger.info(f"[RLSignalEngine] Initialized with path: {trading_rl_path}")

    def load_models(self, config_path: Optional[str] = None):
        """
        Load the 3 PPO models + feature builders + orchestrator.
        Call this once at startup (takes ~5-10 seconds).
        """
        if self._loaded:
            logger.warning("[RLSignalEngine] Models already loaded")
            return

        cfg_path = config_path or str(
            self.trading_rl_path / "config" / "config_multi.yaml"
        )

        with open(cfg_path) as f:
            config = yaml.safe_load(f)

        # Import the live engine from trading-rl
        from live_engine import LiveOrchestratedEngine

        self._live_engine = LiveOrchestratedEngine(config)
        self._live_engine.load_models()
        self._live_engine.start()

        self._loaded = True
        models_loaded = list(self._live_engine.models.keys())
        logger.info(
            f"[RLSignalEngine] Loaded {len(models_loaded)} models: {models_loaded}"
        )

    def process_live_tick(self, live_cache: dict) -> RLSignal:
        """
        Process one tick from 7Strike's _live_chain_cache.
        
        Args:
            live_cache: The dict stored in market_engine._live_chain_cache[symbol]
                Expected keys:
                    spot_price, atm_strike, strike_step,
                    chain: list of dicts with CE/PE OI, LTP, volume per strike
                Also looks for aggregated COI/PCR data if available.
        
        Returns:
            RLSignal dataclass with action, confidence, model breakdown
        """
        if not self._loaded:
            return self._not_ready_signal("Models not loaded")

        try:
            bar = self._convert_cache_to_bar(live_cache)
            if bar is None:
                return self._not_ready_signal("Insufficient data in cache")

            self._live_engine.on_new_bar(bar)
            self._signal_count += 1

            # Build response from engine state
            status = self._live_engine.get_status()
            last_decision = self._live_engine.last_decision

            if last_decision is None:
                return RLSignal(
                    action="NO_TRADE",
                    confidence=0.0,
                    consensus=0,
                    reasoning="Warming up — accumulating lookback bars",
                    models={},
                    position_open=False,
                    position_type="flat",
                    bars_processed=status["bar_count"],
                    ready=status["bar_count"] >= self._live_engine.lookback,
                )

            # Extract per-model signals
            model_breakdown = {}
            for mid, sig in last_decision.model_signals.items():
                model_breakdown[mid] = {
                    "bullish": round(sig.bullish_prob, 3),
                    "bearish": round(sig.bearish_prob, 3),
                    "confidence": round(sig.confidence, 3),
                    "agrees": (
                        "bullish" if sig.bullish_prob > sig.bearish_prob
                        else "bearish"
                    ),
                }

            action_map = {0: "NO_TRADE", 1: "BUY_CALL", 2: "BUY_PUT"}
            pos = self._live_engine.position

            return RLSignal(
                action=action_map.get(last_decision.action, "NO_TRADE"),
                confidence=round(last_decision.confidence, 4),
                consensus=last_decision.consensus_count,
                reasoning=last_decision.reasoning,
                models=model_breakdown,
                position_open=(pos.type.value != "flat"),
                position_type=pos.type.value,
                bars_processed=status["bar_count"],
                ready=True,
            )

        except Exception as e:
            logger.error(f"[RLSignalEngine] Error processing tick: {e}")
            return self._not_ready_signal(f"Error: {str(e)}")

    def get_status(self) -> dict:
        """Engine status for health check."""
        if not self._loaded or not self._live_engine:
            return {"loaded": False, "ready": False}
        status = self._live_engine.get_status()
        status["loaded"] = True
        status["signals_generated"] = self._signal_count
        return status

    def _convert_cache_to_bar(self, cache: dict):
        """Convert 7Strike live_chain_cache dict to BarData for the RL engine."""
        from live_engine import BarData

        spot_price = cache.get("spot_price", 0)
        atm_strike = cache.get("atm_strike", 0)
        chain = cache.get("chain", [])

        if not spot_price or not atm_strike or not chain:
            return None

        # Find ATM row in the chain
        atm_row = None
        for row in chain:
            if row.get("strike") == atm_strike:
                atm_row = row
                break

        if atm_row is None:
            # Use closest strike
            chain_sorted = sorted(chain, key=lambda r: abs(r.get("strike", 0) - atm_strike))
            if chain_sorted:
                atm_row = chain_sorted[0]
            else:
                return None

        # Compute COI aggregates from the chain (7-strike window)
        ce_oi_total = sum(r.get("ce_oi", 0) for r in chain)
        pe_oi_total = sum(r.get("pe_oi", 0) for r in chain)
        ce_vol_total = sum(r.get("ce_volume", 0) for r in chain)
        pe_vol_total = sum(r.get("pe_volume", 0) for r in chain)
        coi_pcr = pe_oi_total / max(ce_oi_total, 1)

        # Find strike with max OI
        max_oi_strike = atm_strike
        max_oi = 0
        for r in chain:
            total_oi = r.get("ce_oi", 0) + r.get("pe_oi", 0)
            if total_oi > max_oi:
                max_oi = total_oi
                max_oi_strike = r.get("strike", atm_strike)

        now = time.strftime("%Y-%m-%d %H:%M:%S")

        return BarData(
            timestamp=now,
            open=atm_row.get("spot_open", spot_price),
            high=atm_row.get("spot_high", spot_price),
            low=atm_row.get("spot_low", spot_price),
            close=spot_price,
            volume=atm_row.get("spot_volume", 0),
            ce_oi=atm_row.get("ce_oi", 0),
            pe_oi=atm_row.get("pe_oi", 0),
            ce_volume=atm_row.get("ce_volume", 0),
            pe_volume=atm_row.get("pe_volume", 0),
            ce_open=atm_row.get("ce_open", 0),
            ce_high=atm_row.get("ce_high", 0),
            ce_low=atm_row.get("ce_low", 0),
            ce_close=atm_row.get("ce_ltp", 0),
            pe_open=atm_row.get("pe_open", 0),
            pe_high=atm_row.get("pe_high", 0),
            pe_low=atm_row.get("pe_low", 0),
            pe_close=atm_row.get("pe_ltp", 0),
            atm_strike=atm_strike,
            coi_pcr_7=coi_pcr,
            coi_ce_7=float(ce_oi_total),
            coi_pe_7=float(pe_oi_total),
            cum_pcr_7=cache.get("cum_pcr", coi_pcr),
            cum_ce_7=cache.get("cum_ce_oi", ce_oi_total),
            cum_pe_7=cache.get("cum_pe_oi", pe_oi_total),
            max_oi_strike=max_oi_strike,
            n_strikes_data=float(len(chain)),
        )

    def _not_ready_signal(self, reason: str) -> RLSignal:
        return RLSignal(
            action="NO_TRADE",
            confidence=0.0,
            consensus=0,
            reasoning=reason,
            models={},
            position_open=False,
            position_type="flat",
            bars_processed=0,
            ready=False,
        )

    def shutdown(self):
        """Graceful shutdown."""
        if self._live_engine:
            self._live_engine.stop()
        logger.info("[RLSignalEngine] Shutdown complete")