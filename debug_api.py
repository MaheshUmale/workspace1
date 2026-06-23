import asyncio
import os
from upstox_api import UpstoxClient
from config import UPSTOX_ACCESS_TOKEN

async def debug_candles():
    if not UPSTOX_ACCESS_TOKEN:
        print("No access token")
        return

    client = UpstoxClient(UPSTOX_ACCESS_TOKEN)
    print(f"Validating token...")
    val = await client.validate_token()
    print(f"Token valid: {val.get('valid')}")

    print("\nFetching NIFTY 1m candles...")
    res = await client.get_candles("NIFTY", "1m")
    if res.get("success"):
        data = res.get("data", [])
        print(f"Success! Got {len(data)} candles")
        if data:
            print(f"First candle: {data[0]}")
            print(f"Last candle: {data[-1]}")
    else:
        print(f"Failed: {res.get('error')}")

    # Try an option if possible
    # We need a valid instrument key. From the screenshot: NSE_FO|NIFTY2662324100CE (estimated)
    # Actually let's search for it
    print("\nSearching for NIFTY 24100 CE...")
    instruments = await client.search_instruments("NIFTY 24100 CE")
    if instruments:
        key = instruments[0]['instrument_key']
        print(f"Found instrument key: {key}")
        print(f"Fetching candles for {key}...")
        res = await client.get_candles(key, "1m")
        if res.get("success"):
            data = res.get("data", [])
            print(f"Success! Got {len(data)} candles")
        else:
            print(f"Failed: {res.get('error')}")
    else:
        print("Instrument not found")

if __name__ == "__main__":
    asyncio.run(debug_candles())
