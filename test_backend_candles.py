import asyncio
import os
import sys
from datetime import datetime

# Add python-engine to path
sys.path.append(os.path.join(os.getcwd(), 'python-engine'))

from upstox_api import UpstoxClient
from config import UPSTOX_ACCESS_TOKEN

async def test_candles():
    if not UPSTOX_ACCESS_TOKEN:
        print("No UPSTOX_ACCESS_TOKEN found in config")
        return

    client = UpstoxClient(UPSTOX_ACCESS_TOKEN)
    print("Testing NIFTY 1m candles...")
    try:
        # We call the internal sync method via the async wrapper's logic but directly to see trace
        from upstox_api import _run_sync
        result = await client.get_candles("NIFTY", "1m")
        if result.get("success"):
            print(f"Success! Got {len(result['data'])} candles")
        else:
            print(f"Failed: {result.get('error')}")
    except Exception as e:
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_candles())
