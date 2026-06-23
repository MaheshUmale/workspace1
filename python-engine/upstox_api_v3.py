"""
Upstox API Client V3 — Support for custom intervals via V3 APIs.
"""

import time
import json
import asyncio
import httpx
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta

class UpstoxClientV3:
    def __init__(self, access_token: str):
        self.access_token = access_token
        self.base_url = "https://api.upstox.com/v3"
        self.headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json"
        }

    async def get_candles_v3(self, instrument_key: str, timeframe: str) -> Dict[str, Any]:
        """Fetch candles using V3 API which supports custom minute intervals."""

        # Map timeframe to V3 unit and interval
        if timeframe.endswith('m'):
            unit = "minutes"
            interval = timeframe[:-1]
        elif timeframe.endswith('h'):
            unit = "hours"
            interval = timeframe[:-1]
        elif timeframe == "1d":
            unit = "days"
            interval = "1"
        else:
            unit = "minutes"
            interval = "1"

        # V3 Intraday URL: /historical-candle/intraday/{instrument_key}/{unit}/{interval}
        url = f"{self.base_url}/historical-candle/intraday/{instrument_key}/{unit}/{interval}"

        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(url, headers=self.headers)
                if response.status_code == 200:
                    data = response.json()
                    if data.get("status") == "success" and "data" in data and "candles" in data["data"]:
                        processed = self._process_v3_candles(data["data"]["candles"])
                        return {"success": True, "data": processed}

                # Fallback to V2 for standard intervals if V3 fails or is not available
                print(f"[UpstoxV3] V3 API failed ({response.status_code}), consider fallback")
                return {"success": False, "error": f"API Error {response.status_code}"}
            except Exception as e:
                return {"success": False, "error": str(e)}

    def _process_v3_candles(self, candles: list) -> list:
        processed = []
        for c in candles:
            try:
                dt = datetime.fromisoformat(c[0].replace('Z', '+00:00'))
                processed.append({
                    "time": int(dt.timestamp()),
                    "open": float(c[1]),
                    "high": float(c[2]),
                    "low": float(c[3]),
                    "close": float(c[4]),
                    "volume": int(c[5]) if len(c) > 5 else 0
                })
            except:
                continue
        processed.sort(key=lambda x: x["time"])
        return processed
