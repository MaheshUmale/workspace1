"""
Upstox API Client — Robust V3 implementation with V2 fallback.
Handles custom timeframes (3m, 5m, 15m, etc.) using Upstox V3 REST API.
Uses V3 REST as primary for all candle data.
"""

import time
import json
import asyncio
import httpx
import urllib.parse
from functools import partial
from collections import OrderedDict
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta

# Try to import SDK for other methods (Option Chain, Search, etc.)
try:
    from upstox_client import Configuration, ApiClient
    from upstox_client.api import UserApi, HistoryApi, OptionsApi, InstrumentsApi, MarketQuoteApi
    HAS_SDK = True
except ImportError:
    HAS_SDK = False

_executor = None

def _get_executor():
    global _executor
    if _executor is None:
        from concurrent.futures import ThreadPoolExecutor
        _executor = ThreadPoolExecutor(max_workers=8)
    return _executor

async def _run_sync(func, *args, **kwargs):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_get_executor(), partial(func, *args, **kwargs))

class UpstoxClient:
    def __init__(self, access_token: str, api_key: str = ""):
        self.access_token = access_token
        self.api_key = api_key
        self._cache: OrderedDict[str, tuple] = OrderedDict()
        self.cache_ttl = 5
        if HAS_SDK:
            self._setup_sdk()

    def _setup_sdk(self):
        self._configuration = Configuration()
        self._configuration.access_token = self.access_token
        self._api_client = ApiClient(self._configuration)
        self._user_api = UserApi(self._api_client)
        self._history_api = HistoryApi(self._api_client)
        self._options_api = OptionsApi(self._api_client)
        self._instruments_api = InstrumentsApi(self._api_client)
        self._market_quote_api = MarketQuoteApi(self._api_client)

    def _cache_key(self, method: str, path: str, **kwargs) -> str:
        parts = [f"{k}={v}" for k, v in sorted(kwargs.items())]
        return f"{method}:{path}:{'&'.join(parts)}"

    def _get_cached(self, key: str) -> Optional[Any]:
        if key in self._cache:
            data, ts = self._cache[key]
            if time.time() - ts < self.cache_ttl:
                self._cache.move_to_end(key)
                return data
            del self._cache[key]
        return None

    def _set_cached(self, key: str, data: Any):
        now = time.time()
        if key in self._cache:
            del self._cache[key]
        self._cache[key] = (data, now)
        if len(self._cache) > 200:
            self._cache.popitem(last=False)

    def get_masked_token(self) -> str:
        if not self.access_token or len(self.access_token) < 14:
            return ""
        return self.access_token[:10] + "****" + self.access_token[-4:]

    async def validate_token(self) -> Dict[str, Any]:
        if not HAS_SDK: return {"valid": True}
        return await _run_sync(self._validate_token_sync)

    def _validate_token_sync(self) -> Dict[str, Any]:
        try:
            self._user_api.get_profile(api_version='2.0')
            return {"valid": True}
        except Exception as e:
            return {"valid": False, "error": str(e)}

    # ================================================================
    # Candle Data (V3 REST Primary)
    # ================================================================

    async def get_candles(self, instrument_key: str, timeframe: str) -> Dict[str, Any]:
        """Fetch candles using V3 REST API as primary to support custom timeframes."""
        cache_key = self._cache_key("GET", "/candles", key=instrument_key, tf=timeframe)
        cached = self._get_cached(cache_key)
        if cached is not None:
            return {"success": True, "data": cached}

        # 1. Try V3 REST API (Supports 1m, 3m, 5m, 15m, 30m, 1h, 1d)
        result = await self._get_candles_v3(instrument_key, timeframe)
        if result.get("success") and result.get("data"):
            self._set_cached(cache_key, result["data"])
            return result

        # 2. Fallback to V2 SDK ONLY for standard intervals if V3 fails
        if timeframe in ("1m", "30m", "1d") and HAS_SDK:
            print(f"[UpstoxClient] V3 failed for {instrument_key} @ {timeframe}, falling back to V2 SDK")
            result = await _run_sync(self._get_candles_v2_sync, instrument_key, timeframe)
            if result.get("success"):
                self._set_cached(cache_key, result["data"])
                return result

        return {"success": False, "error": result.get("error", "Failed to fetch candles")}

    async def _get_candles_v3(self, instrument_key: str, timeframe: str) -> Dict[str, Any]:
        """Fetch candles using V3 REST APIs (Historical + Intraday fallback)."""
        upstox_key = instrument_key
        if instrument_key == "NIFTY": upstox_key = "NSE_INDEX|Nifty 50"
        elif instrument_key == "BANKNIFTY": upstox_key = "NSE_INDEX|Nifty Bank"

        if timeframe.endswith('m'):
            unit, interval = "minutes", timeframe[:-1]
        elif timeframe.endswith('h'):
            unit, interval = "hours", timeframe[:-1]
        elif timeframe == "1d":
            unit, interval = "day", "1"
        else:
            unit, interval = "minutes", "1"

        encoded_key = urllib.parse.quote(upstox_key)
        now = datetime.now()
        today_str = now.strftime("%Y-%m-%d")
        # Support longer lookback for daily timeframe
        days_back = 365 if timeframe == "1d" else 4
        from_date = (now - timedelta(days=days_back)).strftime("%Y-%m-%d")

        headers = {"Authorization": f"Bearer {self.access_token}", "Accept": "application/json"}
        all_candles = []

        async with httpx.AsyncClient() as client:
            urls = []
            if timeframe != "1d":
                urls.append(f"https://api.upstox.com/v3/historical-candle/intraday/{encoded_key}/{unit}/{interval}")
            urls.append(f"https://api.upstox.com/v3/historical-candle/{encoded_key}/{unit}/{interval}/{today_str}/{from_date}")

            try:
                responses = await asyncio.gather(*(client.get(u, headers=headers, timeout=10.0) for u in urls), return_exceptions=True)
                for res in responses:
                    if isinstance(res, httpx.Response) and res.status_code == 200:
                        data = res.json()
                        if data.get("status") == "success":
                            candles = data.get("data", {}).get("candles", [])
                            all_candles.extend(candles)
            except Exception as e:
                print(f"[UpstoxClient] V3 REST Fetch Error: {e}")

        if not all_candles:
            return {"success": False, "error": "No data from V3"}

        processed = []
        for c in all_candles:
            try:
                dt = datetime.fromisoformat(c[0].replace('Z', '+00:00'))
                processed.append({
                    "time": int(dt.timestamp()),
                    "open": float(c[1]),
                    "high": float(c[2]),
                    "low": float(c[3]),
                    "close": float(c[4]),
                    "volume": int(c[5])
                })
            except: continue

        processed.sort(key=lambda x: x["time"])
        unique = []
        last_ts = None
        for c in processed:
            if c["time"] != last_ts:
                unique.append(c)
                last_ts = c["time"]

        return {"success": True, "data": unique}

    def _get_candles_v2_sync(self, instrument_key: str, timeframe: str) -> Dict[str, Any]:
        """V2 SDK fallback."""
        from config import UPSTOX_TIMEFRAME_MAP

        upstox_key = instrument_key
        if instrument_key == "NIFTY": upstox_key = "NSE_INDEX|Nifty 50"
        elif instrument_key == "BANKNIFTY": upstox_key = "NSE_INDEX|Nifty Bank"

        upstox_tf = UPSTOX_TIMEFRAME_MAP.get(timeframe)
        if not upstox_tf or timeframe not in ("1m", "30m", "1d"):
            return {"success": False, "error": f"V2 SDK does not support {timeframe}"}

        try:
            all_candles = []
            now = datetime.now()
            if timeframe != "1d":
                res = self._history_api.get_intra_day_candle_data(instrument_key=upstox_key, interval=upstox_tf, api_version='2.0')
                if res and hasattr(res, 'data') and res.data:
                    all_candles.extend(res.data.candles)
            else:
                from_date = (now - timedelta(days=365)).strftime("%Y-%m-%d")
                res = self._history_api.get_historical_candle_data1(instrument_key=upstox_key, interval='day', to_date=now.strftime("%Y-%m-%d"), from_date=from_date, api_version='2.0')
                if res and hasattr(res, 'data') and res.data:
                    all_candles.extend(res.data.candles)

            processed = []
            for c in all_candles:
                try:
                    ts_val = c[0]
                    if isinstance(ts_val, str): ts = int(datetime.fromisoformat(ts_val.replace('Z', '+00:00')).timestamp())
                    else: ts = int(ts_val / 1000) if ts_val > 1e11 else int(ts_val)
                    processed.append({"time": ts, "open": float(c[1]), "high": float(c[2]), "low": float(c[3]), "close": float(c[4]), "volume": int(c[5])})
                except: continue

            processed.sort(key=lambda x: x["time"])
            unique = []
            last_ts = None
            for c in processed:
                if c["time"] != last_ts:
                    unique.append(c)
                    last_ts = c["time"]
            return {"success": True, "data": unique}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ================================================================
    # Other Market Data (V2 SDK)
    # ================================================================

    async def get_ltp(self, instrument_key: str) -> Dict[str, Any]:
        """Fetch Last Traded Price for an instrument."""
        if not HAS_SDK: return {"success": False}
        return await _run_sync(self._get_ltp_sync, instrument_key)

    def _get_ltp_sync(self, instrument_key: str) -> Dict[str, Any]:
        upstox_key = instrument_key
        if instrument_key == "NIFTY": upstox_key = "NSE_INDEX|Nifty 50"
        elif instrument_key == "BANKNIFTY": upstox_key = "NSE_INDEX|Nifty Bank"
        try:
            response = self._market_quote_api.ltp(symbol=upstox_key, api_version='2.0')
            if response and hasattr(response, 'data') and response.data:
                key = upstox_key.replace("|", ":")
                ltp_data = response.data.get(key, {})
                return {"success": True, "ltp": ltp_data.get("last_price", 0)}
        except: pass
        return {"success": False}

    async def get_user_profile(self) -> Dict[str, Any]:
        """Fetch authenticated user profile from Upstox."""
        if not HAS_SDK: return {"success": False}
        return await _run_sync(self._get_user_profile_sync)

    def _get_user_profile_sync(self) -> Dict[str, Any]:
        try:
            profile = self._user_api.get_profile(api_version='2.0')
            if profile and hasattr(profile, 'data'):
                return {"success": True, "data": profile.data.to_dict() if hasattr(profile.data, 'to_dict') else {}}
        except: pass
        return {"success": False}

    async def build_instrument_cache(self, underlyings: List[str] = None):
        """Pre-build a local cache of instruments for fast search."""
        if not HAS_SDK: return
        if underlyings is None: underlyings = ["NIFTY", "BANKNIFTY"]
        print(f"[UpstoxClient] Building instrument cache for {underlyings}...")
        for underlying in underlyings:
            query = "Nifty" if underlying == "NIFTY" else "Nifty Bank" if underlying == "BANKNIFTY" else underlying
            for period in ["current_month", "next_month"]:
                try:
                    res = self._instruments_api.search_instrument(query=query, expiry=period)
                    if res and res.data:
                        for item in res.data:
                            ts = item.get("trading_symbol")
                            if ts: self._set_cached(self._cache_key("SEARCH", ts.upper()), item)
                except: continue

    async def get_option_chain(self, underlying: str, expiry: str) -> Dict[str, Any]:
        if not HAS_SDK: return {"success": False}
        return await _run_sync(self._get_option_chain_sync, underlying, expiry)

    def _get_option_chain_sync(self, underlying: str, expiry: str) -> Dict[str, Any]:
        from config import UNDERLYING_CONFIG
        ukey = UNDERLYING_CONFIG.get(underlying, {}).get("upstox_key", "")
        try:
            res = self._options_api.get_put_call_option_chain(instrument_key=ukey, expiry_date=expiry)
            if res and res.data:
                chain = [self._convert_option_strike(item) for item in res.data]
                spot = chain[0]["underlying_spot_price"] if chain else 0
                return {"success": True, "data": chain, "spot_price": spot}
        except: pass
        return {"success": False}

    def _convert_option_strike(self, item) -> dict:
        def _get_md(opt):
            if not opt or not hasattr(opt, 'market_data') or not opt.market_data:
                return {"ltp": 0, "oi": 0, "change_in_oi": 0, "volume": 0}
            md = opt.market_data
            return {"ltp": md.ltp or 0, "oi": md.oi or 0, "change_in_oi": (md.oi or 0) - (md.prev_oi or 0), "volume": md.volume or 0}

        return {
            "strike_price": item.strike_price,
            "underlying_spot_price": item.underlying_spot_price,
            "call_options": {"instrument_key": item.call_options.instrument_key if item.call_options else "", "market_data": _get_md(item.call_options)},
            "put_options": {"instrument_key": item.put_options.instrument_key if item.put_options else "", "market_data": _get_md(item.put_options)}
        }

    async def get_expiries(self, underlying: str) -> Dict[str, Any]:
        if not HAS_SDK: return {"success": False}
        return await _run_sync(self._get_expiries_sync, underlying)

    def _get_expiries_sync(self, underlying: str) -> Dict[str, Any]:
        query = "Nifty 50" if underlying == "NIFTY" else "Nifty Bank" if underlying == "BANKNIFTY" else underlying
        all_exp = {}
        for p in ["current_month", "next_month"]:
            try:
                res = self._instruments_api.search_instrument(query=query, expiry=p)
                if res and res.data:
                    for item in res.data:
                        ed = item.get("expiry")
                        if ed: all_exp[ed] = {"expiry_date": ed, "is_weekly": item.get("weekly", False)}
            except: continue
        return {"success": True, "data": sorted(all_exp.values(), key=lambda x: x["expiry_date"])}

    async def search_instruments(self, query: str, expiry: str = None) -> List[Dict[str, Any]]:
        if not HAS_SDK: return []
        return await _run_sync(self._search_instruments_sync, query, expiry)

    def _search_instruments_sync(self, query: str, expiry: str = None) -> List[Dict[str, Any]]:
        try:
            res = self._instruments_api.search_instrument(query=query, expiry=expiry)
            if res and res.data:
                results = []
                for item in res.data:
                    results.append({
                        "instrument_key": item.get("instrument_key", ""),
                        "trading_symbol": item.get("trading_symbol", ""),
                        "expiry": item.get("expiry", ""),
                        "strike": int(item.get("strike_price", 0)) if item.get("strike_price") else None,
                        "option_type": item.get("instrument_type") if item.get("instrument_type") in ("CE", "PE") else None,
                        "underlying": "NIFTY" if "Nifty 50" in item.get("underlying_key", "") else "BANKNIFTY" if "Nifty Bank" in item.get("underlying_key", "") else item.get("underlying_symbol", "")
                    })
                return results
        except: pass
        return []

    async def close(self):
        if HAS_SDK and hasattr(self, '_api_client'):
            try: self._api_client.close()
            except: pass
