"""
Upstox API Client — Official Upstox Python SDK integration.
Uses upstox-python-sdk v2.27.0 for robust API access.
Handles token validation, option chain fetching, candle data, and expiry dates.
Includes 5-second response caching and proper error handling.
"""

import time
import json
import asyncio
from functools import partial
from typing import Optional, Dict, Any, List
from datetime import datetime

from upstox_client import Configuration, ApiClient
from upstox_client.api import UserApi, HistoryApi, OptionsApi, InstrumentsApi, MarketQuoteApi
from upstox_client.rest import ApiException

# Executor for running synchronous SDK calls without blocking the event loop
_executor = None


def _get_executor():
    global _executor
    if _executor is None:
        from concurrent.futures import ThreadPoolExecutor
        _executor = ThreadPoolExecutor(max_workers=4)
    return _executor


async def _run_sync(func, *args, **kwargs):
    """Run a synchronous function in a thread pool executor."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_get_executor(), partial(func, *args, **kwargs))


class UpstoxClient:
    """Async-compatible Upstox API client using the official Python SDK.
    
    The SDK itself is synchronous, so we wrap calls with asyncio for
    compatibility with our async FastAPI routes.
    """

    def __init__(self, access_token: str, api_key: str = ""):
        self.access_token = access_token
        self.api_key = api_key
        self._cache: Dict[str, tuple] = {}  # key -> (data, timestamp)
        self.cache_ttl = 5  # seconds
        self._setup_sdk()

    def _setup_sdk(self):
        """Initialize the SDK configuration and API clients."""
        self._configuration = Configuration()
        self._configuration.access_token = self.access_token
        self._api_client = ApiClient(self._configuration)

        # Initialize API instances
        self._user_api = UserApi(self._api_client)
        self._history_api = HistoryApi(self._api_client)
        self._options_api = OptionsApi(self._api_client)
        self._instruments_api = InstrumentsApi(self._api_client)
        self._market_quote_api = MarketQuoteApi(self._api_client)

    # ============ Cache Helpers ============

    def _cache_key(self, method: str, path: str, **kwargs) -> str:
        """Generate a deterministic cache key from method, path, and params."""
        return f"{method}:{path}:{json.dumps(kwargs, sort_keys=True)}"

    def _get_cached(self, key: str) -> Optional[Any]:
        """Return cached data if within TTL, else None."""
        if key in self._cache:
            data, ts = self._cache[key]
            if time.time() - ts < self.cache_ttl:
                return data
        return None

    def _set_cached(self, key: str, data: Any):
        """Store data in cache with current timestamp."""
        self._cache[key] = (data, time.time())
        # Evict oldest entry if cache exceeds 100 items
        if len(self._cache) > 100:
            oldest_key = min(self._cache.items(), key=lambda x: x[1][1])[0]
            del self._cache[oldest_key]

    # ============ Token Helpers ============

    def get_masked_token(self) -> str:
        """Return masked access token for display (first 10 + **** + last 4)."""
        if not self.access_token or len(self.access_token) < 14:
            return ""
        return self.access_token[:10] + "****" + self.access_token[-4:]

    # ============ API Methods ============

    def _validate_token_sync(self) -> Dict[str, Any]:
        """Synchronous token validation using the SDK."""
        try:
            profile = self._user_api.get_profile(api_version='2.0')
            if profile and hasattr(profile, 'data'):
                return {"valid": True, "data": profile.data.to_dict() if hasattr(profile.data, 'to_dict') else str(profile.data)}
            return {"valid": True, "data": {}}
        except ApiException as e:
            return {"valid": False, "error": f"API Error {e.status}: {e.reason}"}
        except Exception as e:
            return {"valid": False, "error": str(e)}

    async def validate_token(self) -> Dict[str, Any]:
        """Validate the access token by fetching user profile from Upstox."""
        return await _run_sync(self._validate_token_sync)

    def _get_option_chain_sync(self, underlying: str, expiry: str) -> Dict[str, Any]:
        """Synchronous option chain fetch using the SDK."""
        from config import UNDERLYING_CONFIG

        instrument_key = UNDERLYING_CONFIG.get(underlying, {}).get("upstox_key", "")
        if not instrument_key:
            return {"success": False, "error": f"Unknown underlying: {underlying}"}

        if not expiry:
            return {"success": False, "error": "expiry_date is required for option chain"}

        try:
            response = self._options_api.get_put_call_option_chain(
                instrument_key=instrument_key,
                expiry_date=expiry
            )

            if response and hasattr(response, 'data') and response.data:
                chain_data = []
                spot_price = 0.0
                for item in response.data:
                    entry = self._convert_option_strike(item)
                    if entry.get("underlying_spot_price") and not spot_price:
                        spot_price = entry["underlying_spot_price"]
                    chain_data.append(entry)

                return {"success": True, "data": chain_data, "spot_price": spot_price}

            return {"success": False, "error": "No data returned from option chain API"}

        except ApiException as e:
            return {"success": False, "error": f"API Error {e.status}: {e.reason}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def get_option_chain(self, underlying: str, expiry: str) -> Dict[str, Any]:
        """Fetch option chain from Upstox for given underlying and expiry date.

        Uses OptionsApi.get_put_call_option_chain() from the official SDK.
        Results are cached for 5 seconds.
        """
        cache_key = self._cache_key(
            "GET", "/option/chain", underlying=underlying, expiry=expiry
        )
        cached = self._get_cached(cache_key)
        if cached is not None:
            return cached

        result = await _run_sync(self._get_option_chain_sync, underlying, expiry)
        if result.get("success"):
            self._set_cached(cache_key, result)
        return result

    def _convert_option_strike(self, item) -> dict:
        """Convert an SDK OptionStrikeData object to a plain dict."""
        result = {
            "strike_price": item.strike_price if hasattr(item, 'strike_price') else 0,
            "expiry": str(item.expiry) if hasattr(item, 'expiry') else "",
            "underlying_spot_price": item.underlying_spot_price if hasattr(item, 'underlying_spot_price') else 0,
            "underlying_key": item.underlying_key if hasattr(item, 'underlying_key') else "",
        }

        # Convert call_options
        if hasattr(item, 'call_options') and item.call_options:
            call = item.call_options
            result["call_options"] = {
                "instrument_key": call.instrument_key if hasattr(call, 'instrument_key') else "",
            }
            if hasattr(call, 'market_data') and call.market_data:
                md = call.market_data
                result["call_options"]["market_data"] = {
                    "ltp": md.ltp or 0,
                    "oi": md.oi or 0,
                    "prev_oi": md.prev_oi or 0,
                    "change_in_oi": (md.oi or 0) - (md.prev_oi or 0),
                    "volume": md.volume or 0,
                    "bid_price": md.bid_price or 0,
                    "bid_qty": md.bid_qty or 0,
                    "ask_price": md.ask_price or 0,
                    "ask_qty": md.ask_qty or 0,
                    "close_price": md.close_price or 0,
                }
            else:
                result["call_options"]["market_data"] = self._empty_market_data()

            if hasattr(call, 'option_greeks') and call.option_greeks:
                gk = call.option_greeks
                result["call_options"]["option_greeks"] = {
                    "iv": gk.iv or 0,
                    "delta": gk.delta or 0,
                    "gamma": gk.gamma or 0,
                    "theta": gk.theta or 0,
                    "vega": gk.vega or 0,
                }
            else:
                result["call_options"]["option_greeks"] = self._empty_greeks()
        else:
            result["call_options"] = {"instrument_key": "", "market_data": self._empty_market_data(), "option_greeks": self._empty_greeks()}

        # Convert put_options
        if hasattr(item, 'put_options') and item.put_options:
            put = item.put_options
            result["put_options"] = {
                "instrument_key": put.instrument_key if hasattr(put, 'instrument_key') else "",
            }
            if hasattr(put, 'market_data') and put.market_data:
                md = put.market_data
                result["put_options"]["market_data"] = {
                    "ltp": md.ltp or 0,
                    "oi": md.oi or 0,
                    "prev_oi": md.prev_oi or 0,
                    "change_in_oi": (md.oi or 0) - (md.prev_oi or 0),
                    "volume": md.volume or 0,
                    "bid_price": md.bid_price or 0,
                    "bid_qty": md.bid_qty or 0,
                    "ask_price": md.ask_price or 0,
                    "ask_qty": md.ask_qty or 0,
                    "close_price": md.close_price or 0,
                }
            else:
                result["put_options"]["market_data"] = self._empty_market_data()

            if hasattr(put, 'option_greeks') and put.option_greeks:
                gk = put.option_greeks
                result["put_options"]["option_greeks"] = {
                    "iv": gk.iv or 0,
                    "delta": gk.delta or 0,
                    "gamma": gk.gamma or 0,
                    "theta": gk.theta or 0,
                    "vega": gk.vega or 0,
                }
            else:
                result["put_options"]["option_greeks"] = self._empty_greeks()
        else:
            result["put_options"] = {"instrument_key": "", "market_data": self._empty_market_data(), "option_greeks": self._empty_greeks()}

        # PCR if available
        if hasattr(item, 'pcr') and item.pcr is not None:
            result["pcr"] = item.pcr

        return result

    @staticmethod
    def _empty_market_data() -> dict:
        return {
            "ltp": 0, "oi": 0, "prev_oi": 0, "change_in_oi": 0,
            "volume": 0, "bid_price": 0, "bid_qty": 0,
            "ask_price": 0, "ask_qty": 0, "close_price": 0,
        }

    @staticmethod
    def _empty_greeks() -> dict:
        return {"iv": 0, "delta": 0, "gamma": 0, "theta": 0, "vega": 0}

    def _get_candles_sync(self, instrument_key: str, timeframe: str) -> Dict[str, Any]:
        """Synchronous candle fetch using the SDK."""
        from config import UPSTOX_TIMEFRAME_MAP

        upstox_key = instrument_key
        if instrument_key == "NIFTY":
            upstox_key = "NSE_INDEX|Nifty 50"
        elif instrument_key == "BANKNIFTY":
            upstox_key = "NSE_INDEX|Nifty Bank"

        upstox_tf = UPSTOX_TIMEFRAME_MAP.get(timeframe, "1minute")

        try:
            if timeframe == "1d":
                today = datetime.now().strftime("%Y-%m-%d")
                from datetime import timedelta
                from_date = (datetime.now() - timedelta(days=365)).strftime("%Y-%m-%d")
                response = self._history_api.get_historical_candle_data1(
                    instrument_key=upstox_key,
                    interval=upstox_tf,
                    to_date=today,
                    from_date=from_date,
                    api_version='2.0'
                )
            else:
                response = self._history_api.get_intra_day_candle_data(
                    instrument_key=upstox_key,
                    interval=upstox_tf,
                    api_version='2.0'
                )

            if response and hasattr(response, 'data') and response.data:
                candles_raw = response.data.candles if hasattr(response.data, 'candles') else []
                if candles_raw:
                    return {"success": True, "data": candles_raw}

            return {"success": False, "error": "No candle data returned"}

        except ApiException as e:
            return {"success": False, "error": f"API Error {e.status}: {e.reason}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def get_candles(
        self, instrument_key: str, timeframe: str
    ) -> Dict[str, Any]:
        """Fetch historical candle data from Upstox.

        Uses HistoryApi from the official SDK.
        For intraday timeframes (1m, 3m, 5m, 15m, 1h), uses get_intra_day_candle_data.
        For daily timeframes, uses get_historical_candle_data1.
        Results are cached for 5 seconds.
        """
        cache_key = self._cache_key(
            "GET", "/historical/candle", key=instrument_key, tf=timeframe
        )
        cached = self._get_cached(cache_key)
        if cached is not None:
            return {"success": True, "data": cached}

        result = await _run_sync(self._get_candles_sync, instrument_key, timeframe)
        if result.get("success") and result.get("data"):
            self._set_cached(cache_key, result["data"])
        return result

    def _get_historical_candles_sync(self, instrument_key: str, timeframe: str, from_date: str, to_date: str) -> Dict[str, Any]:
        """Synchronous historical candle fetch using the SDK."""
        from config import UPSTOX_TIMEFRAME_MAP

        upstox_key = instrument_key
        if instrument_key == "NIFTY":
            upstox_key = "NSE_INDEX|Nifty 50"
        elif instrument_key == "BANKNIFTY":
            upstox_key = "NSE_INDEX|Nifty Bank"

        upstox_tf = UPSTOX_TIMEFRAME_MAP.get(timeframe, "1minute")

        try:
            response = self._history_api.get_historical_candle_data1(
                instrument_key=upstox_key,
                interval=upstox_tf,
                to_date=to_date,
                from_date=from_date,
                api_version='2.0'
            )

            if response and hasattr(response, 'data') and response.data:
                candles_raw = response.data.candles if hasattr(response.data, 'candles') else []
                if candles_raw:
                    return {"success": True, "data": candles_raw}

            return {"success": False, "error": "No candle data returned"}

        except ApiException as e:
            return {"success": False, "error": f"API Error {e.status}: {e.reason}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def get_historical_candles(
        self, instrument_key: str, timeframe: str, from_date: str, to_date: str
    ) -> Dict[str, Any]:
        """Fetch historical candle data for a specific date range.

        Uses HistoryApi.get_historical_candle_data1() from the official SDK.
        This is useful for preloading data at startup.
        """
        return await _run_sync(self._get_historical_candles_sync, instrument_key, timeframe, from_date, to_date)

    def _get_expiries_sync(self, underlying: str) -> Dict[str, Any]:
        """Synchronous expiry fetch using the SDK."""
        from config import UNDERLYING_CONFIG

        try:
            search_query = "Nifty" if underlying == "NIFTY" else "NIFTY" if underlying == "BANKNIFTY" else underlying
            if underlying == "BANKNIFTY":
                search_query = "Nifty Bank"

            all_expiries = {}

            for period in ["current_month", "next_month"]:
                try:
                    response = self._instruments_api.search_instrument(
                        query=search_query,
                        expiry=period,
                    )
                    if response and hasattr(response, 'data') and response.data:
                        for item in response.data:
                            exp_date = item.get("expiry", "")
                            if not exp_date:
                                continue

                            underlying_key = item.get("underlying_key", "")
                            expected_key = UNDERLYING_CONFIG.get(underlying, {}).get("upstox_key", "")
                            if expected_key and underlying_key != expected_key:
                                continue

                            is_weekly = item.get("weekly", False)
                            instrument_type = item.get("instrument_type", "")

                            if exp_date not in all_expiries:
                                all_expiries[exp_date] = {
                                    "expiry_date": exp_date,
                                    "is_weekly": is_weekly,
                                    "instrument_types": set(),
                                    "underlying_key": underlying_key,
                                }
                            if is_weekly:
                                all_expiries[exp_date]["is_weekly"] = True
                            if instrument_type:
                                all_expiries[exp_date]["instrument_types"].add(instrument_type)

                except Exception as e:
                    print(f"[UpstoxClient] Search error for {period}: {e}")
                    continue

            if all_expiries:
                sorted_expiries = sorted(all_expiries.values(), key=lambda x: x["expiry_date"])
                for exp in sorted_expiries:
                    exp["instrument_types"] = list(exp["instrument_types"])
                return {"success": True, "data": sorted_expiries}

            return {"success": False, "error": "No expiries found"}

        except ApiException as e:
            return {"success": False, "error": f"API Error {e.status}: {e.reason}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def get_expiries(self, underlying: str) -> Dict[str, Any]:
        """Fetch available expiry dates for an underlying instrument.

        Uses InstrumentsApi.search_instrument() with expiry=current_month and 
        expiry=next_month to get both weekly and monthly expiries.
        Returns unique sorted expiry dates with metadata.
        """
        cache_key = self._cache_key(
            "GET", "/instruments/search/expiries", underlying=underlying
        )
        cached = self._get_cached(cache_key)
        if cached is not None:
            return {"success": True, "data": cached}

        result = await _run_sync(self._get_expiries_sync, underlying)
        if result.get("success"):
            self._set_cached(cache_key, result["data"])
        return result

    def _get_ltp_sync(self, instrument_key: str) -> Dict[str, Any]:
        """Synchronous LTP fetch using the SDK."""
        upstox_key = instrument_key
        if instrument_key == "NIFTY":
            upstox_key = "NSE_INDEX|Nifty 50"
        elif instrument_key == "BANKNIFTY":
            upstox_key = "NSE_INDEX|Nifty Bank"

        try:
            response = self._market_quote_api.ltp(
                symbol=upstox_key,
                api_version='2.0'
            )
            if response and hasattr(response, 'data') and response.data:
                key = upstox_key.replace("|", ":")
                ltp_data = response.data.get(key, {})
                return {"success": True, "ltp": ltp_data.get("last_price", 0)}
            return {"success": False, "error": "No LTP data returned"}

        except ApiException as e:
            return {"success": False, "error": f"API Error {e.status}: {e.reason}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def get_ltp(self, instrument_key: str) -> Dict[str, Any]:
        """Fetch Last Traded Price for an instrument.

        Uses MarketQuoteApi.ltp() from the official SDK.
        """
        return await _run_sync(self._get_ltp_sync, instrument_key)

    def _get_user_profile_sync(self) -> Dict[str, Any]:
        """Synchronous user profile fetch using the SDK."""
        try:
            profile = self._user_api.get_profile(api_version='2.0')
            if profile and hasattr(profile, 'data'):
                return {"success": True, "data": profile.data.to_dict() if hasattr(profile.data, 'to_dict') else {}}
            return {"success": False, "error": "No profile data returned"}
        except ApiException as e:
            return {"success": False, "error": f"API Error {e.status}: {e.reason}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def get_user_profile(self) -> Dict[str, Any]:
        """Fetch authenticated user profile from Upstox."""
        return await _run_sync(self._get_user_profile_sync)

    def _search_instruments_sync(self, query: str) -> List[Dict[str, Any]]:
        """Synchronous instrument search using the SDK.

        Uses InstrumentsApi.search_instrument() to search by human-readable query.
        Returns a list of SearchResult dicts matching the frontend's expected format.
        """
        try:
            response = self._instruments_api.search_instrument(query=query)
            if response and hasattr(response, 'data') and response.data:
                results = []
                for item in response.data:
                    # Map SDK response fields to our SearchResult format
                    instrument_type = item.get("instrument_type", "")
                    strike_price = item.get("strike_price", 0)
                    underlying_symbol = item.get("underlying_symbol", "")
                    underlying_key = item.get("underlying_key", "")

                    # Determine the underlying name (NIFTY, BANKNIFTY, etc.)
                    underlying = underlying_symbol
                    if "Nifty 50" in underlying_key or underlying_symbol == "NIFTY":
                        underlying = "NIFTY"
                    elif "Nifty Bank" in underlying_key or underlying_symbol == "BANKNIFTY":
                        underlying = "BANKNIFTY"
                    elif "FinNifty" in underlying_key or underlying_symbol == "FINNIFTY":
                        underlying = "FINNIFTY"

                    result = {
                        "instrument_key": item.get("instrument_key", ""),
                        "trading_symbol": item.get("trading_symbol", ""),
                        "name": item.get("trading_symbol", ""),  # Use trading_symbol as display name
                        "expiry": item.get("expiry", ""),
                        "strike": int(strike_price) if strike_price else None,
                        "option_type": instrument_type if instrument_type in ("CE", "PE") else None,
                        "lot_size": item.get("lot_size", 0),
                        "underlying": underlying,
                        "segment": item.get("segment", ""),
                        "exchange": item.get("exchange", ""),
                        "underlying_key": underlying_key,
                        "instrument_type": instrument_type,
                        "weekly": item.get("weekly", False),
                    }
                    results.append(result)
                return results
            return []
        except ApiException as e:
            print(f"[UpstoxClient] Search API error: {e.status} {e.reason}")
            return []
        except Exception as e:
            print(f"[UpstoxClient] Search error: {e}")
            return []

    async def search_instruments(self, query: str) -> List[Dict[str, Any]]:
        """Search instruments by human-readable query like 'NIFTY 23900 CE'.

        Uses InstrumentsApi.search_instrument() from the official SDK.
        Results are cached for 30 seconds (longer than other API calls
        since instrument data changes infrequently).
        """
        if not query or len(query) < 2:
            return []

        cache_key = self._cache_key("GET", "/instruments/search", q=query)
        cached = self._get_cached(cache_key)
        if cached is not None:
            return cached

        results = await _run_sync(self._search_instruments_sync, query)

        if results:
            # Cache instrument search for 30 seconds
            old_ttl = self.cache_ttl
            self.cache_ttl = 30
            self._set_cached(cache_key, results)
            self.cache_ttl = old_ttl

        return results

    # ============ Instrument Cache ============

    async def build_instrument_cache(self, underlyings: List[str] = None):
        """Pre-build a local cache of instruments for fast search.

        Searches for common option contracts for the given underlyings
        and caches them locally for instant lookups.
        """
        if underlyings is None:
            underlyings = ["NIFTY", "BANKNIFTY"]

        print(f"[UpstoxClient] Building instrument cache for {underlyings}...")
        count = 0
        for underlying in underlyings:
            search_query = underlying
            if underlying == "BANKNIFTY":
                search_query = "NIFTY Bank"
            elif underlying == "NIFTY":
                search_query = "Nifty"

            for period in ["current_month", "next_month"]:
                try:
                    response = self._instruments_api.search_instrument(
                        query=search_query,
                        expiry=period,
                    )
                    if response and hasattr(response, 'data') and response.data:
                        for item in response.data:
                            # Cache each item by its trading_symbol for fast lookup
                            ts = item.get("trading_symbol", "")
                            if ts:
                                cache_key = self._cache_key("SEARCH", ts.upper())
                                old_ttl = self.cache_ttl
                                self.cache_ttl = 300  # 5 minutes for instrument cache
                                self._set_cached(cache_key, item)
                                self.cache_ttl = old_ttl
                                count += 1
                except Exception as e:
                    print(f"[UpstoxClient] Cache build error for {underlying}/{period}: {e}")
                    continue

        print(f"[UpstoxClient] Instrument cache built: {count} instruments cached")

    async def close(self):
        """Close the API client and release resources."""
        try:
            self._api_client.close()
        except Exception:
            pass
