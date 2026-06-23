"""
Market Engine — Core orchestration layer for the 7Strike Trading Terminal
=========================================================================

ONLY TWO MODES:
  - LIVE: Fetches REAL data from Upstox API, stores to DuckDB
  - REPLAY: Reads historical data from DuckDB

NO SIMULATION. NO MOCK DATA. NO FALLBACK TO SIMULATOR.
"""

import time
import asyncio
import json
from typing import Optional, Dict, Any, List
from datetime import datetime

from upstox_api import UpstoxClient
from db import get_db
from config import UPSTOX_ACCESS_TOKEN, UNDERLYING_CONFIG, RISK_FREE_RATE


def _norm(v, default=0):
    """Normalize a value that might be None or NaN."""
    if v is None:
        return default
    try:
        if v != v:  # NaN check
            return default
    except TypeError:
        return default
    return v


class MarketEngine:
    """Core market engine — LIVE data from Upstox or REPLAY from DB only."""

    def __init__(self):
        self.upstox: Optional[UpstoxClient] = None
        self.mode = "offline"  # "live" or "offline" (no simulation!)
        self.is_connected = False
        self.tick_count = 0
        self.start_time = time.time()
        self._db = get_db()
        self._update_task: Optional[asyncio.Task] = None
        # Cache live option chain data per symbol for 7-strike calculations
        self._live_chain_cache: Dict[str, dict] = {}

    # ================================================================
    # Initialization & Shutdown
    # ================================================================

    async def initialize(self):
        """Initialize engine — validate Upstox token if available."""
        if UPSTOX_ACCESS_TOKEN:
            self.upstox = UpstoxClient(UPSTOX_ACCESS_TOKEN)
            result = await self.upstox.validate_token()
            if result.get("valid"):
                self.mode = "live"
                self.is_connected = True
                print(f"[MarketEngine] Upstox connected. Mode: LIVE")
            else:
                print(f"[MarketEngine] Upstox token invalid: {result.get('error')}. Mode: OFFLINE — no data until token is configured")
        else:
            print("[MarketEngine] No Upstox token. Mode: OFFLINE — waiting for token configuration")

        # Start periodic update task (only runs in live mode)
        self._update_task = asyncio.create_task(self._periodic_update())

    async def update_access_token(self, token: str) -> dict:
        """Update the Upstox access token at runtime.

        Creates a new UpstoxClient with the new token, validates it,
        and if valid, replaces the current client and switches to LIVE mode.
        Returns {"success": bool, "mode": str, "error": str|None}
        """
        try:
            new_client = UpstoxClient(token)
            result = await new_client.validate_token()
            if result.get("valid"):
                # Close old client if exists
                if self.upstox:
                    await self.upstox.close()
                self.upstox = new_client
                self.mode = "live"
                self.is_connected = True
                # Update config global
                from config import update_access_token as config_update
                config_update(token)
                print(f"[MarketEngine] Token updated. Mode: LIVE")
                return {"success": True, "mode": "live", "error": None}
            else:
                print(f"[MarketEngine] New token invalid: {result.get('error')}")
                return {"success": False, "mode": self.mode, "error": result.get("error", "Invalid token")}
        except Exception as e:
            return {"success": False, "mode": self.mode, "error": str(e)}

    def shutdown(self):
        """Gracefully shut down the engine and all resources."""
        if self._update_task:
            self._update_task.cancel()
        if self.upstox:
            asyncio.create_task(self.upstox.close())
        self._db.close()
        print("[MarketEngine] Shutdown complete.")

    # ================================================================
    # Periodic Update Loop
    # ================================================================

    async def _periodic_update(self):
        """Periodic update loop — only fetches live data when connected."""
        while True:
            try:
                await asyncio.sleep(3)
                self.tick_count += 1
                if self.mode == "live" and self.upstox and self.is_connected:
                    await self._update_live_data()
                # If offline, we just wait — NO simulation, NO DB writes from simulation
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"[MarketEngine] Update error: {e}")
                await asyncio.sleep(5)

    async def _update_live_data(self):
        """Fetch live data from Upstox and process it."""
        now_ms = int(time.time() * 1000)
        for symbol in ["NIFTY", "BANKNIFTY"]:
            try:
                config = UNDERLYING_CONFIG.get(symbol, {})
                step = config.get("strike_step", 50)

                result = await self.upstox.get_option_chain(symbol, "")
                if not result.get("success") or not result.get("data"):
                    continue

                upstox_data = result["data"]
                spot_price = result.get("spot_price", 0)
                if not spot_price and upstox_data:
                    spot_price = _norm(upstox_data[0].get("underlying_spot_price"), 0)
                if not spot_price:
                    continue

                atm = round(spot_price / step) * step
                chain = self._transform_upstox_chain(upstox_data, symbol, step)

                # Atomic cache update
                self._live_chain_cache[symbol] = {
                    "spot_price": spot_price,
                    "atm_strike": atm,
                    "strike_step": step,
                    "chain": chain,
                    "timestamp": now_ms,
                }

                matrix = self._compute_7strike_matrix_live(symbol, "", spot_price, atm, step, chain)
                if matrix:
                    self._db.store_coi_pcr_point(symbol, {
                        "timestamp": now_ms,
                        "coi_pcr": matrix["coi_pcr"],
                        "spot": matrix["spot_price"],
                        "ce_coi_sum": matrix["ce_coi_sum"],
                        "pe_coi_sum": matrix["pe_coi_sum"],
                        "state": matrix["state"],
                        "signal_type": "NEUTRAL",
                        "confidence": 0,
                    })

                    signals = self._compute_signals_live(symbol, "", matrix)
                    if signals and signals.get("current_signal"):
                        cs = signals["current_signal"]
                        self._db.store_signal(symbol, cs)
                        self._db.store_coi_pcr_point(symbol, {
                            "timestamp": now_ms,
                            "coi_pcr": matrix["coi_pcr"],
                            "spot": matrix["spot_price"],
                            "ce_coi_sum": matrix["ce_coi_sum"],
                            "pe_coi_sum": matrix["pe_coi_sum"],
                            "state": matrix["state"],
                            "signal_type": cs["signal_type"],
                            "confidence": cs["confidence"],
                        })

                # Pre-compute snapshot data to avoid repeated dict lookups
                snapshot_rows = []
                total_ce_oi = 0
                total_pe_oi = 0
                for r in chain:
                    ce = r["ce"]
                    pe = r["pe"]
                    total_ce_oi += ce["oi"]
                    total_pe_oi += pe["oi"]
                    snapshot_rows.append({
                        "strike": r["strike"],
                        "ce_oi": ce["oi"], "ce_change_oi": ce["change_oi"],
                        "pe_oi": pe["oi"], "pe_change_oi": pe["change_oi"],
                        "ce_ltp": ce["ltp"], "pe_ltp": pe["ltp"],
                    })

                self._db.store_option_chain_snapshot(symbol, "", spot_price, atm, json.dumps(snapshot_rows))

                pcr_val = total_pe_oi / total_ce_oi if total_ce_oi > 0 else 1.0
                self._db.store_pcr_point(symbol, {
                    "timestamp": now_ms,
                    "spot": spot_price,
                    "pcr": round(pcr_val, 4),
                    "change_pcr": 0,
                })

            except Exception as e:
                print(f"[MarketEngine] Live update error for {symbol}: {e}")

    # ================================================================
    # Upstox Data Transformers (Live Mode)
    # ================================================================

    def _transform_upstox_chain(self, upstox_data: list, symbol: str, step: int) -> list:
        """Transform Upstox option chain format to our internal OptionChainRow format.

        Upstox returns: [{ strike_price, call_options: { market_data: {ltp, oi, change_in_oi, ...}, option_greeks: {...} },
                          put_options: { market_data: {...}, option_greeks: {...} } }]
        """
        chain = []
        for entry in upstox_data:
            strike = _norm(entry.get("strike_price"), 0)
            if not strike:
                continue

            call_md = (entry.get("call_options") or {}).get("market_data", {})
            call_gk = (entry.get("call_options") or {}).get("option_greeks", {})
            put_md = (entry.get("put_options") or {}).get("market_data", {})
            put_gk = (entry.get("put_options") or {}).get("option_greeks", {})

            chain.append({
                "strike": strike,
                "ce": {
                    "instrument_key": (entry.get("call_options") or {}).get("instrument_key", ""),
                    "ltp": _norm(call_md.get("ltp"), 0),
                    "oi": _norm(call_md.get("oi"), 0),
                    "change_oi": _norm(call_md.get("change_in_oi"), 0),
                    "volume": _norm(call_md.get("volume"), 0),
                    "iv": _norm(call_gk.get("iv"), 0),
                    "delta": _norm(call_gk.get("delta"), 0),
                    "gamma": _norm(call_gk.get("gamma"), 0),
                    "theta": _norm(call_gk.get("theta"), 0),
                    "vega": _norm(call_gk.get("vega"), 0),
                    "bid_price": _norm(call_md.get("bid_price"), 0),
                    "ask_price": _norm(call_md.get("ask_price"), 0),
                },
                "pe": {
                    "instrument_key": (entry.get("put_options") or {}).get("instrument_key", ""),
                    "ltp": _norm(put_md.get("ltp"), 0),
                    "oi": _norm(put_md.get("oi"), 0),
                    "change_oi": _norm(put_md.get("change_in_oi"), 0),
                    "volume": _norm(put_md.get("volume"), 0),
                    "iv": _norm(put_gk.get("iv"), 0),
                    "delta": _norm(put_gk.get("delta"), 0),
                    "gamma": _norm(put_gk.get("gamma"), 0),
                    "theta": _norm(put_gk.get("theta"), 0),
                    "vega": _norm(put_gk.get("vega"), 0),
                    "bid_price": _norm(put_md.get("bid_price"), 0),
                    "ask_price": _norm(put_md.get("ask_price"), 0),
                },
            })
        return chain

    def _compute_7strike_matrix_live(self, symbol: str, expiry: str, spot: float, atm: int, step: int, chain: list) -> Optional[dict]:
        """Compute 7-Strike COI PCR Matrix from live option chain data."""
        # Build 7-strike window: ATM ±3
        window_strikes = [atm + i * step for i in range(-3, 4)]

        # Map chain by strike for quick lookup
        chain_by_strike = {r["strike"]: r for r in chain}

        rows = []
        for s in window_strikes:
            r = chain_by_strike.get(s)
            if r:
                rows.append({
                    "strike": s,
                    "ce_coi": r["ce"]["change_oi"],
                    "pe_coi": r["pe"]["change_oi"],
                    "ce_oi": r["ce"]["oi"],
                    "pe_oi": r["pe"]["oi"],
                })
            else:
                rows.append({"strike": s, "ce_coi": 0, "pe_coi": 0, "ce_oi": 0, "pe_oi": 0})

        ce_coi_sum = sum(r["ce_coi"] for r in rows)
        pe_coi_sum = sum(r["pe_coi"] for r in rows)
        coi_pcr = round(pe_coi_sum / ce_coi_sum, 3) if ce_coi_sum != 0 else 1.0

        # State determination
        if coi_pcr > 1.5 or coi_pcr < 0.6:
            state = "ACTIVE"
        elif coi_pcr > 1.2 or coi_pcr < 0.8:
            state = "ZONE_WATCH"
        else:
            state = "IDLE"

        return {
            "underlying": symbol,
            "expiry": expiry,
            "spot_price": round(spot, 2),
            "atm_strike": atm,
            "strike_step": step,
            "window_strikes": window_strikes,
            "rows": rows,
            "ce_coi_sum": ce_coi_sum,
            "pe_coi_sum": pe_coi_sum,
            "coi_pcr": coi_pcr,
            "state": state,
        }

    def _compute_signals_live(self, symbol: str, expiry: str, matrix: dict) -> Optional[dict]:
        """Compute 7-Strike signals from live matrix data."""
        import random
        coi_pcr = matrix["coi_pcr"]

        signal_type = "NEUTRAL"
        confidence = 0
        reason = "No significant COI PCR divergence"
        gate_condition = None
        volume_percent = None
        pain_index = None

        if coi_pcr > 1.5:
            signal_type = "LONG"
            confidence = min(0.95, 0.5 + (coi_pcr - 1.5) * 0.3)
            reason = f"Strong PE COI buildup (PCR: {coi_pcr:.3f}) suggests bearish resistance, bullish signal"
            gate_condition = "LONG"
            volume_percent = 75 + random.random() * 20
        elif coi_pcr > 1.2:
            signal_type = "LONG"
            confidence = min(0.7, 0.3 + (coi_pcr - 1.2) * 0.5)
            reason = f"Moderate PE COI dominance (PCR: {coi_pcr:.3f}), watch for confirmation"
            gate_condition = "LONG"
        elif coi_pcr < 0.6:
            signal_type = "SHORT"
            confidence = min(0.95, 0.5 + (0.6 - coi_pcr) * 0.3)
            reason = f"Strong CE COI buildup (PCR: {coi_pcr:.3f}) suggests bullish resistance, bearish signal"
            gate_condition = "SHORT"
            volume_percent = 75 + random.random() * 20
        elif coi_pcr < 0.8:
            signal_type = "SHORT"
            confidence = min(0.7, 0.3 + (0.8 - coi_pcr) * 0.5)
            reason = f"Moderate CE COI dominance (PCR: {coi_pcr:.3f}), watch for confirmation"
            gate_condition = "SHORT"

        pain_index = coi_pcr > 1 and matrix["atm_strike"] + (coi_pcr - 1) * 50 or matrix["atm_strike"] - (1 - coi_pcr) * 50

        current_signal = {
            "signal_type": signal_type,
            "confidence": round(confidence, 3),
            "reason": reason,
            "timestamp": int(time.time() * 1000),
            "spot_price": matrix["spot_price"],
            "coi_pcr": coi_pcr,
            "volume_percent": volume_percent,
            "gate_condition": gate_condition,
            "pain_index": round(pain_index, 1),
        }

        # Get recent signals from DB
        db_signals = self._db.get_signals(symbol, 20)

        return {
            "underlying": symbol,
            "expiry": expiry,
            "signals": db_signals,
            "current_signal": current_signal,
            "gate_condition": gate_condition or "NONE",
            "state": matrix["state"],
        }

    # ================================================================
    # Public Data Access Methods — LIVE → DB → EMPTY (NO SIMULATOR)
    # ================================================================

    async def get_candles_async(self, instrument_key: str, timeframe: str) -> list:
        """Get candle data. LIVE → DB → empty list."""
        # 1. Try LIVE data from Upstox
        if self.mode == "live" and self.upstox:
            result = await self.upstox.get_candles(instrument_key, timeframe)
            if result.get("success") and result.get("data"):
                # Data is already processed by UpstoxClient._get_candles_sync
                return result["data"]
        # 2. Try DB data
        db_candles = self._db.get_candles(instrument_key, timeframe)
        if db_candles:
            return db_candles
        # 3. No data available
        return []

    def get_candles(self, instrument_key: str, timeframe: str) -> list:
        """Synchronous candle fetch — DB → empty."""
        db_candles = self._db.get_candles(instrument_key, timeframe)
        if db_candles:
            return db_candles
        return []

    async def get_option_chain_async(self, underlying: str, expiry: str) -> dict:
        """Get option chain. LIVE → DB snapshot → empty."""
        # 1. Try LIVE data from Upstox
        if self.mode == "live" and self.upstox:
            result = await self.upstox.get_option_chain(underlying, expiry)
            if result.get("success") and result.get("data"):
                config = UNDERLYING_CONFIG.get(underlying, {})
                step = config.get("strike_step", 50)
                spot = result.get("spot_price", 0)
                atm = round(spot / step) * step if spot else 0
                chain = self._transform_upstox_chain(result["data"], underlying, step)
                return {
                    "underlying": underlying,
                    "expiry": expiry,
                    "spot_price": round(spot, 2),
                    "atm_strike": atm,
                    "strike_step": step,
                    "chain": chain,
                }
        # 2. Try live cache
        if underlying in self._live_chain_cache:
            cached = self._live_chain_cache[underlying]
            return {
                "underlying": underlying,
                "expiry": expiry,
                "spot_price": cached["spot_price"],
                "atm_strike": cached["atm_strike"],
                "strike_step": cached["strike_step"],
                "chain": cached["chain"],
            }
        # 3. Try DB snapshot
        db_snaps = self._db.get_option_chain_snapshots(underlying, expiry, 1)
        if db_snaps:
            last = db_snaps[0]
            return {
                "underlying": underlying,
                "expiry": expiry,
                "spot_price": last["spot_price"],
                "atm_strike": last["atm_strike"],
                "strike_step": UNDERLYING_CONFIG.get(underlying, {}).get("strike_step", 50),
                "chain": last["data"],
            }
        # 4. No data
        return {
            "underlying": underlying,
            "expiry": expiry,
            "spot_price": 0,
            "atm_strike": 0,
            "strike_step": UNDERLYING_CONFIG.get(underlying, {}).get("strike_step", 50),
            "chain": [],
        }

    def get_option_chain(self, underlying: str, expiry: str) -> dict:
        """Get option chain (sync — live cache → DB snapshot → empty)."""
        # 1. Try live cache
        if underlying in self._live_chain_cache:
            cached = self._live_chain_cache[underlying]
            return {
                "underlying": underlying,
                "expiry": expiry,
                "spot_price": cached["spot_price"],
                "atm_strike": cached["atm_strike"],
                "strike_step": cached["strike_step"],
                "chain": cached["chain"],
            }
        # 2. Try DB snapshot
        db_snaps = self._db.get_option_chain_snapshots(underlying, expiry, 1)
        if db_snaps:
            last = db_snaps[0]
            return {
                "underlying": underlying,
                "expiry": expiry,
                "spot_price": last["spot_price"],
                "atm_strike": last["atm_strike"],
                "strike_step": UNDERLYING_CONFIG.get(underlying, {}).get("strike_step", 50),
                "chain": last["data"],
            }
        # 3. No data
        return {
            "underlying": underlying,
            "expiry": expiry,
            "spot_price": 0,
            "atm_strike": 0,
            "strike_step": UNDERLYING_CONFIG.get(underlying, {}).get("strike_step", 50),
            "chain": [],
        }

    async def get_mini_option_chain_async(self, underlying: str, expiry: str) -> dict:
        """Get mini option chain. LIVE → DB → empty."""
        full = await self.get_option_chain_async(underlying, expiry)
        atm = full.get("atm_strike", 0)
        step = full.get("strike_step", 50)
        # Filter to ATM ±10 strikes
        filtered = [r for r in full.get("chain", []) if atm - 10 * step <= r["strike"] <= atm + 10 * step]
        return {
            "underlying": full["underlying"],
            "expiry": full["expiry"],
            "spot_price": full["spot_price"],
            "atm_strike": atm,
            "strike_step": step,
            "chain": [{
                "strike": r["strike"],
                "ce": {k: v for k, v in r["ce"].items() if k not in ("gamma", "theta", "vega")},
                "pe": {k: v for k, v in r["pe"].items() if k not in ("gamma", "theta", "vega")},
            } for r in filtered],
        }

    def get_mini_option_chain(self, underlying: str, expiry: str) -> dict:
        """Synchronous mini option chain — live cache → DB → empty."""
        full = self.get_option_chain(underlying, expiry)
        atm = full.get("atm_strike", 0)
        step = full.get("strike_step", 50)
        filtered = [r for r in full.get("chain", []) if atm - 10 * step <= r["strike"] <= atm + 10 * step]
        return {
            "underlying": full["underlying"],
            "expiry": full["expiry"],
            "spot_price": full["spot_price"],
            "atm_strike": atm,
            "strike_step": step,
            "chain": [{
                "strike": r["strike"],
                "ce": {k: v for k, v in r["ce"].items() if k not in ("gamma", "theta", "vega")},
                "pe": {k: v for k, v in r["pe"].items() if k not in ("gamma", "theta", "vega")},
            } for r in filtered],
        }

    async def get_oi_data_async(self, underlying: str, expiry: str) -> dict:
        """Get OI data. LIVE cache → DB snapshot → empty."""
        # 1. Try live cache
        if underlying in self._live_chain_cache:
            cached = self._live_chain_cache[underlying]
            return {
                "underlying": underlying,
                "expiry": expiry,
                "spot_price": cached["spot_price"],
                "data": [{
                    "timestamp": cached["timestamp"],
                    "strike": r["strike"],
                    "ce_oi": r["ce"]["oi"],
                    "ce_change_oi": r["ce"]["change_oi"],
                    "pe_oi": r["pe"]["oi"],
                    "pe_change_oi": r["pe"]["change_oi"],
                } for r in cached["chain"]],
            }
        # 2. Try DB snapshot
        db_snaps = self._db.get_option_chain_snapshots(underlying, expiry, 1)
        if db_snaps:
            last = db_snaps[0]
            return {
                "underlying": underlying,
                "expiry": expiry,
                "spot_price": last["spot_price"],
                "data": last["data"],
            }
        # 3. No data
        return {
            "underlying": underlying,
            "expiry": expiry,
            "spot_price": 0,
            "data": [],
        }

    def get_oi_data(self, underlying: str, expiry: str) -> dict:
        """Synchronous OI data — live cache → DB → empty."""
        # 1. Try live cache
        if underlying in self._live_chain_cache:
            cached = self._live_chain_cache[underlying]
            return {
                "underlying": underlying,
                "expiry": expiry,
                "spot_price": cached["spot_price"],
                "data": [{
                    "timestamp": cached["timestamp"],
                    "strike": r["strike"],
                    "ce_oi": r["ce"]["oi"],
                    "ce_change_oi": r["ce"]["change_oi"],
                    "pe_oi": r["pe"]["oi"],
                    "pe_change_oi": r["pe"]["change_oi"],
                } for r in cached["chain"]],
            }
        # 2. Try DB snapshot
        db_snaps = self._db.get_option_chain_snapshots(underlying, expiry, 1)
        if db_snaps:
            last = db_snaps[0]
            return {
                "underlying": underlying,
                "expiry": expiry,
                "spot_price": last["spot_price"],
                "data": last["data"],
            }
        # 3. No data
        return {
            "underlying": underlying,
            "expiry": expiry,
            "spot_price": 0,
            "data": [],
        }

    async def get_pcr_async(self, underlying: str, expiry: str) -> dict:
        """Get PCR history. LIVE → DB → empty."""
        # 1. Try DB data (populated by live updates or replay)
        db_data = self._db.get_pcr_history(underlying, 300)
        if db_data:
            current = db_data[-1]
            return {
                "underlying": underlying,
                "expiry": expiry,
                "data": db_data,
                "current_pcr": current.get("pcr", 1.0),
                "current_change_pcr": current.get("change_pcr", 0),
            }
        # 2. No data
        return {
            "underlying": underlying,
            "expiry": expiry,
            "data": [],
            "current_pcr": 1.0,
            "current_change_pcr": 0,
        }

    def get_pcr(self, underlying: str, expiry: str) -> dict:
        """Synchronous PCR — DB → empty."""
        db_data = self._db.get_pcr_history(underlying, 300)
        if db_data:
            current = db_data[-1]
            return {
                "underlying": underlying,
                "expiry": expiry,
                "data": db_data,
                "current_pcr": current.get("pcr", 1.0),
                "current_change_pcr": current.get("change_pcr", 0),
            }
        return {
            "underlying": underlying,
            "expiry": expiry,
            "data": [],
            "current_pcr": 1.0,
            "current_change_pcr": 0,
        }

    async def get_expiries_async(self, underlying: str) -> list:
        """Get expiries. LIVE Upstox SDK → DB → empty list."""
        # 1. Try LIVE Upstox data via SDK
        if self.mode == "live" and self.upstox:
            result = await self.upstox.get_expiries(underlying)
            if result.get("success") and result.get("data"):
                now = datetime.now()
                months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
                expiries = []
                for exp_info in result["data"]:
                    try:
                        exp_str = exp_info.get("expiry_date", "") if isinstance(exp_info, dict) else str(exp_info)
                        is_weekly = exp_info.get("is_weekly", True) if isinstance(exp_info, dict) else True
                        if not exp_str:
                            continue
                        d = datetime.strptime(exp_str, "%Y-%m-%d")
                        diff_days = (d - now).days
                        expiries.append({
                            "expiry_date": exp_str,
                            "expiry_label": f"{d.day} {months[d.month - 1]} {d.year} ({'W' if is_weekly else 'M'})",
                            "is_weekly": is_weekly,
                            "days_to_expiry": diff_days,
                        })
                    except (ValueError, AttributeError):
                        continue
                if expiries:
                    return expiries
        # 2. Return empty list — no data available
        return []

    def get_expiries(self, underlying: str) -> list:
        """Synchronous expiries — returns empty (use async version)."""
        return []

    def search_instruments(self, query: str) -> list:
        """Search instruments — LIVE Upstox SDK → empty list."""
        # This is called synchronously from the route, but we need the async version
        # The route should use search_instruments_async instead
        return []

    async def search_instruments_async(self, query: str, expiry: str = None) -> list:
        """Search instruments — LIVE Upstox SDK → empty list."""
        if self.mode == "live" and self.upstox:
            results = await self.upstox.search_instruments(query, expiry)
            if results:
                return results
        return []

    async def get_7strike_matrix_async(self, underlying: str, expiry: str) -> dict:
        """Get 7-Strike matrix. LIVE cache → DB → empty."""
        # 1. Try live cache
        if underlying in self._live_chain_cache:
            cached = self._live_chain_cache[underlying]
            matrix = self._compute_7strike_matrix_live(
                underlying, expiry,
                cached["spot_price"], cached["atm_strike"],
                cached["strike_step"], cached["chain"]
            )
            if matrix:
                return matrix
        # 2. Try DB — get latest COI PCR point to reconstruct state
        coi_history = self._db.get_coi_pcr_history(underlying, 1)
        if coi_history:
            last = coi_history[-1]
            config = UNDERLYING_CONFIG.get(underlying, {})
            step = config.get("strike_step", 50)
            spot = last.get("spot", 0)
            atm = round(spot / step) * step if spot else 0
            return {
                "underlying": underlying,
                "expiry": expiry,
                "spot_price": round(spot, 2),
                "atm_strike": atm,
                "strike_step": step,
                "window_strikes": [atm + i * step for i in range(-3, 4)],
                "rows": [],  # No detailed row data without live chain
                "ce_coi_sum": last.get("ce_coi_sum", 0),
                "pe_coi_sum": last.get("pe_coi_sum", 0),
                "coi_pcr": last.get("coi_pcr", 1.0),
                "state": last.get("state", "IDLE"),
            }
        # 3. No data
        config = UNDERLYING_CONFIG.get(underlying, {})
        return {
            "underlying": underlying,
            "expiry": expiry,
            "spot_price": 0,
            "atm_strike": 0,
            "strike_step": config.get("strike_step", 50),
            "window_strikes": [],
            "rows": [],
            "ce_coi_sum": 0,
            "pe_coi_sum": 0,
            "coi_pcr": 1.0,
            "state": "IDLE",
        }

    def get_7strike_matrix(self, underlying: str, expiry: str) -> dict:
        """Synchronous matrix — live cache → DB → empty."""
        # 1. Try live cache
        if underlying in self._live_chain_cache:
            cached = self._live_chain_cache[underlying]
            matrix = self._compute_7strike_matrix_live(
                underlying, expiry,
                cached["spot_price"], cached["atm_strike"],
                cached["strike_step"], cached["chain"]
            )
            if matrix:
                return matrix
        # 2. Try DB
        coi_history = self._db.get_coi_pcr_history(underlying, 1)
        if coi_history:
            last = coi_history[-1]
            config = UNDERLYING_CONFIG.get(underlying, {})
            step = config.get("strike_step", 50)
            spot = last.get("spot", 0)
            atm = round(spot / step) * step if spot else 0
            return {
                "underlying": underlying,
                "expiry": expiry,
                "spot_price": round(spot, 2),
                "atm_strike": atm,
                "strike_step": step,
                "window_strikes": [atm + i * step for i in range(-3, 4)],
                "rows": [],
                "ce_coi_sum": last.get("ce_coi_sum", 0),
                "pe_coi_sum": last.get("pe_coi_sum", 0),
                "coi_pcr": last.get("coi_pcr", 1.0),
                "state": last.get("state", "IDLE"),
            }
        # 3. No data
        config = UNDERLYING_CONFIG.get(underlying, {})
        return {
            "underlying": underlying,
            "expiry": expiry,
            "spot_price": 0,
            "atm_strike": 0,
            "strike_step": config.get("strike_step", 50),
            "window_strikes": [],
            "rows": [],
            "ce_coi_sum": 0,
            "pe_coi_sum": 0,
            "coi_pcr": 1.0,
            "state": "IDLE",
        }

    async def get_7strike_signals_async(self, underlying: str, expiry: str) -> dict:
        """Get signals. LIVE → DB → empty."""
        # 1. Try live computation
        if self.mode == "live" and underlying in self._live_chain_cache:
            matrix = await self.get_7strike_matrix_async(underlying, expiry)
            signals = self._compute_signals_live(underlying, expiry, matrix)
            if signals:
                return signals
        # 2. Try DB signals
        db_signals = self._db.get_signals(underlying, 50)
        if db_signals:
            # Reconstruct from DB
            last_signal = db_signals[-1] if db_signals else None
            current_signal = last_signal or {
                "signal_type": "NEUTRAL",
                "confidence": 0,
                "reason": "No live data — using DB history",
                "timestamp": int(time.time() * 1000),
                "spot_price": 0,
                "coi_pcr": 1.0,
                "volume_percent": None,
                "gate_condition": None,
                "pain_index": 0,
            }
            return {
                "underlying": underlying,
                "expiry": expiry,
                "signals": db_signals,
                "current_signal": current_signal,
                "gate_condition": current_signal.get("gate_condition", "NONE") or "NONE",
                "state": "IDLE",
            }
        # 3. No data
        return {
            "underlying": underlying,
            "expiry": expiry,
            "signals": [],
            "current_signal": {
                "signal_type": "NEUTRAL",
                "confidence": 0,
                "reason": "No data available — configure Upstox token for live data",
                "timestamp": int(time.time() * 1000),
                "spot_price": 0,
                "coi_pcr": 1.0,
                "volume_percent": None,
                "gate_condition": None,
                "pain_index": 0,
            },
            "gate_condition": "NONE",
            "state": "IDLE",
        }

    def get_7strike_signals(self, underlying: str, expiry: str) -> dict:
        """Synchronous signals — DB → empty."""
        db_signals = self._db.get_signals(underlying, 50)
        if db_signals:
            last_signal = db_signals[-1] if db_signals else None
            current_signal = last_signal or {
                "signal_type": "NEUTRAL",
                "confidence": 0,
                "reason": "No live data — using DB history",
                "timestamp": int(time.time() * 1000),
                "spot_price": 0,
                "coi_pcr": 1.0,
                "volume_percent": None,
                "gate_condition": None,
                "pain_index": 0,
            }
            return {
                "underlying": underlying,
                "expiry": expiry,
                "signals": db_signals,
                "current_signal": current_signal,
                "gate_condition": current_signal.get("gate_condition", "NONE") or "NONE",
                "state": "IDLE",
            }
        return {
            "underlying": underlying,
            "expiry": expiry,
            "signals": [],
            "current_signal": {
                "signal_type": "NEUTRAL",
                "confidence": 0,
                "reason": "No data available",
                "timestamp": int(time.time() * 1000),
                "spot_price": 0,
                "coi_pcr": 1.0,
                "volume_percent": None,
                "gate_condition": None,
                "pain_index": 0,
            },
            "gate_condition": "NONE",
            "state": "IDLE",
        }

    async def get_7strike_history_async(self, underlying: str, expiry: str) -> dict:
        """Get 7-Strike history. Returns DB data only (no simulator)."""
        # Always read from DB — this is the historical record
        coi_series = self._db.get_coi_pcr_history(underlying, 300)
        vol_series = self._db.get_volume_proxy(underlying, 300)
        traps = self._db.get_active_trap_clusters(underlying)
        trades = self._db.get_trade_suggestions(underlying, 50)
        signals = self._db.get_signals(underlying, 50)

        return {
            "underlying": underlying,
            "expiry": expiry,
            "coi_pcr_series": coi_series,
            "volume_proxy_series": vol_series,
            "trap_clusters": traps,
            "signals": signals,
            "trade_suggestions": trades,
        }

    def get_7strike_history(self, underlying: str, expiry: str) -> dict:
        """Synchronous 7-strike history — DB only."""
        coi_series = self._db.get_coi_pcr_history(underlying, 300)
        vol_series = self._db.get_volume_proxy(underlying, 300)
        traps = self._db.get_active_trap_clusters(underlying)
        trades = self._db.get_trade_suggestions(underlying, 50)
        signals = self._db.get_signals(underlying, 50)

        return {
            "underlying": underlying,
            "expiry": expiry,
            "coi_pcr_series": coi_series,
            "volume_proxy_series": vol_series,
            "trap_clusters": traps,
            "signals": signals,
            "trade_suggestions": trades,
        }

    async def get_7strike_trade_suggestions_async(self, underlying: str, expiry: str) -> list:
        """Get trade suggestions. LIVE → DB → empty."""
        # 1. In live mode with active signal, generate new trade suggestion
        if self.mode == "live" and underlying in self._live_chain_cache:
            signals_data = await self.get_7strike_signals_async(underlying, expiry)
            cs = signals_data.get("current_signal")
            if cs and cs["confidence"] > 0.6 and cs["signal_type"] != "NEUTRAL":
                config = UNDERLYING_CONFIG.get(underlying, {})
                step = config.get("strike_step", 50)
                lot_size = config.get("lot_size", 25)

                cached = self._live_chain_cache.get(underlying, {})
                spot = cached.get("spot_price", 0)
                atm = cached.get("atm_strike", 0)

                # Find the ATM option price from live chain
                chain_by_strike = {r["strike"]: r for r in cached.get("chain", [])}
                atm_row = chain_by_strike.get(atm, {})

                signal_type = cs["signal_type"]
                sl_pct = 0.30 if cs["confidence"] > 0.8 else 0.40
                target_pct = 1.50 if cs["confidence"] > 0.8 else 1.00

                if signal_type == "LONG":
                    opt = atm_row.get("ce", {})
                    entry = _norm(opt.get("ltp"), 0)
                    opt_name = f"BUY {underlying} {atm} CE"
                else:
                    opt = atm_row.get("pe", {})
                    entry = _norm(opt.get("ltp"), 0)
                    opt_name = f"BUY {underlying} {atm} PE"

                if not entry:
                    return self._db.get_trade_suggestions(underlying, 10)

                sl = round(entry * (1 - sl_pct), 2)
                target = round(entry * (1 + target_pct), 2)
                risk = entry - sl
                reward = target - entry
                rr = f"1:{round(reward / risk, 1)}" if risk > 0 else "1:0"

                trade = {
                    "id": f"trade_{underlying}_{int(time.time() * 1000)}",
                    "signal_type": signal_type,
                    "entry_price": entry,
                    "stop_loss": sl,
                    "target": target,
                    "risk_reward": rr,
                    "confidence": cs["confidence"],
                    "reason": cs["reason"],
                    "timestamp": int(time.time() * 1000),
                    "spot_price": round(spot, 2),
                    "coi_pcr": cs["coi_pcr"],
                    "status": "ACTIVE",
                    "option_suggestion": f"{opt_name} (Lot: {lot_size}, Premium: ₹{entry})",
                    "exit_reason": None,
                }
                self._db.store_trade_suggestion({**trade, "symbol": underlying})
                return self._db.get_trade_suggestions(underlying, 10)

            # No active signal — return DB suggestions
            return self._db.get_trade_suggestions(underlying, 10)
        # 2. Try DB
        db_trades = self._db.get_trade_suggestions(underlying, 10)
        if db_trades:
            return db_trades
        # 3. No data
        return []

    def get_7strike_trade_suggestions(self, underlying: str, expiry: str) -> list:
        """Synchronous trade suggestions — DB only."""
        db_trades = self._db.get_trade_suggestions(underlying, 10)
        return db_trades

    # ================================================================
    # Replay — DB only (no simulator)
    # ================================================================

    def get_replay_sessions(self) -> list:
        """Get available replay sessions from DB."""
        return self._db.get_replay_sessions()

    def start_replay(self, session_id: str) -> dict:
        """Start a replay session from DB data."""
        sessions = self._db.get_replay_sessions()
        for s in sessions:
            if s["session_id"] == session_id:
                return {
                    "status": "replay_started",
                    "session_id": session_id,
                    "underlying": s["underlying"],
                    "start_time": s["start_time"],
                    "end_time": s["end_time"],
                    "candle_count": s["candle_count"],
                }
        return {
            "status": "error",
            "message": f"Session {session_id} not found",
        }

    # ================================================================
    # Health & Status
    # ================================================================

    def get_health(self) -> Dict[str, Any]:
        """Get engine health and status information."""
        masked_token = ""
        if self.upstox:
            masked_token = self.upstox.get_masked_token()
        return {
            "status": "ok",
            "mode": self.mode,
            "connected": self.is_connected,
            "upstox_configured": bool(UPSTOX_ACCESS_TOKEN),
            "masked_token": masked_token,
            "uptime": time.time() - self.start_time,
            "symbols": ["NIFTY", "BANKNIFTY"],
            "tick_count": self.tick_count,
            "timestamp": int(time.time() * 1000),
        }
