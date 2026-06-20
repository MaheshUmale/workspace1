"""
RL Warmup — Pre-load 1-min bars from DuckDB into RL engine at startup
======================================================================
The RL engine needs ~500 bars of 1-min data before it can generate
its first signal. Without warmup, it takes ~8 hours of live data
collection before the first signal appears.

This module solves that by:
  1. Reading pre-aggregated 1-min bars from the `rl_bars_1min` table
     (populated by rl_bar_aggregator during previous trading sessions)
  2. Converting them to BarData objects
  3. Feeding them sequentially into the RL engine

Expected warmup time: ~2-3 seconds for 600 bars.

Prerequisites:
  - rl_bar_aggregator must have been running for at least 1-2 trading days
    to accumulate 600+ 1-min bars (600 min = 10 hours of market data,
    so ~2 trading days)
  - OR: manually populate rl_bars_1min from historical data

Fallback behavior:
  - If rl_bars_1min is empty or doesn't exist, falls back to aggregating
    from raw option_chain_snapshots (slower, requires more data)

Usage:
    from rl_warmup import warmup_rl_engine
    
    bars_fed = await warmup_rl_engine(
        rl_engine,           # RLSignalEngine instance
        duckdb_path,         # path to 7Strike's DuckDB
        symbol="NIFTY",
        max_bars=600
    )
    print(f"Warmup complete: {bars_fed} bars fed")
"""

import time
from pathlib import Path
from typing import Optional
from loguru import logger


async def warmup_rl_engine(rl_engine, db_path: str, symbol: str = "NIFTY",
                           max_bars: int = 600) -> int:
    """
    Load recent 1-min bars from DuckDB into the RL engine for warmup.
    
    Priority order:
      1. Read from rl_bars_1min table (fast, pre-aggregated)
      2. Fallback: aggregate from option_chain_snapshots (slower)
      3. Fallback: aggregate from coi_pcr_history (PCR only, limited)
    
    Args:
        rl_engine: RLSignalEngine instance (must have load_models() called)
        db_path: Path to 7Strike's DuckDB database
        symbol: NIFTY or BANKNIFTY
        max_bars: Number of bars to load (default 600 > 500 lookback)
    
    Returns:
        Number of bars successfully fed to the RL engine
    """
    try:
        import duckdb
    except ImportError:
        logger.error("[RL Warmup] duckdb not installed. pip install duckdb")
        return 0

    from live_engine import BarData

    db_file = Path(db_path)
    if not db_file.exists():
        logger.warning(f"[RL Warmup] DB not found: {db_path}")
        return 0

    conn = duckdb.connect(str(db_path), read_only=True)

    try:
        tables = [t[0] for t in conn.execute("SHOW TABLES").fetchall()]
        logger.info(f"[RL Warmup] Available tables: {tables}")

        # ── Strategy 1: Read from rl_bars_1min (preferred) ──
        if "rl_bars_1min" in tables:
            bars = _read_from_rl_bars(conn, symbol, max_bars)
            if bars:
                fed = _feed_bars(rl_engine, bars)
                logger.info(f"[RL Warmup] Fed {fed} bars from rl_bars_1min for {symbol}")
                return fed

        # ── Strategy 2: Aggregate from option_chain_snapshots ──
        if "option_chain_snapshots" in tables:
            bars = _aggregate_from_snapshots(conn, symbol, max_bars)
            if bars:
                fed = _feed_bars(rl_engine, bars)
                logger.info(f"[RL Warmup] Fed {fed} bars (aggregated from snapshots) for {symbol}")
                return fed

        # ── Strategy 3: Aggregate from coi_pcr_history (limited) ──
        if "coi_pcr_history" in tables:
            bars = _aggregate_from_coi(conn, symbol, max_bars)
            if bars:
                fed = _feed_bars(rl_engine, bars)
                logger.info(f"[RL Warmup] Fed {fed} bars (from COI history, PCR only) for {symbol}")
                return fed

        logger.warning(f"[RL Warmup] No suitable data found for {symbol}")
        return 0

    finally:
        conn.close()


def _read_from_rl_bars(conn, symbol: str, max_bars: int) -> list:
    """Read pre-aggregated 1-min bars from rl_bars_1min table."""
    rows = conn.execute(f"""
        SELECT * FROM rl_bars_1min
        WHERE symbol = '{symbol}'
        ORDER BY minute_ts DESC
        LIMIT {max_bars}
    """).fetchall()

    if not rows:
        return []

    cols = [d[0] for d in conn.description]
    records = [dict(zip(cols, row)) for row in rows]
    records.reverse()  # oldest first
    return records


def _aggregate_from_snapshots(conn, symbol: str, max_bars: int) -> list:
    """
    Aggregate raw 3s snapshots into 1-min bars on-the-fly.
    This is the fallback when rl_bars_1min hasn't been populated yet.
    Slower but works from day 1.
    """
    # First, figure out the time range we need
    # We need max_bars * 60 seconds of raw data
    time_col = _find_time_column(conn, "option_chain_snapshots")
    if time_col is None:
        return []

    # Get the most recent data
    rows = conn.execute(f"""
        SELECT * FROM option_chain_snapshots
        WHERE {time_col} > 0
        ORDER BY {time_col} DESC
        LIMIT {max_bars * 25}  -- ~25 ticks per minute * max_bars minutes
    """).fetchall()

    if not rows:
        return []

    cols = [d[0] for d in conn.description]
    records = [dict(zip(cols, row)) for row in rows]
    records.reverse()  # oldest first

    # Group into 1-minute buckets
    from collections import defaultdict
    buckets = defaultdict(list)
    for rec in records:
        ts = rec.get(time_col, 0)
        if isinstance(ts, (int, float)):
            # Millisecond timestamp — truncate to minute
            minute_key = (ts // 60000) * 60000
        else:
            # String timestamp — truncate to minute
            try:
                ts_str = str(ts)[:16]  # '2025-01-15 09:16'
                minute_key = ts_str
            except Exception:
                continue
        buckets[minute_key].append(rec)

    # Aggregate each bucket into a 1-min bar
    bars = []
    for minute_key in sorted(buckets.keys())[:max_bars]:
        tick_records = buckets[minute_key]
        bar = _aggregate_ticks_to_bar(tick_records, minute_key, cols)
        if bar and bar.get("spot_close", 0) > 0:
            bars.append(bar)

    return bars


def _aggregate_from_coi(conn, symbol: str, max_bars: int) -> list:
    """Fallback: aggregate from coi_pcr_history (limited data)."""
    time_col = _find_time_column(conn, "coi_pcr_history")
    if time_col is None:
        return []

    rows = conn.execute(f"""
        SELECT * FROM coi_pcr_history
        WHERE symbol = '{symbol}'
        ORDER BY {time_col} DESC
        LIMIT {max_bars * 25}
    """).fetchall()

    if not rows:
        return []

    cols = [d[0] for d in conn.description]
    records = [dict(zip(cols, row)) for row in rows]
    records.reverse()

    # Group by minute
    from collections import defaultdict
    buckets = defaultdict(list)
    for rec in records:
        ts = rec.get(time_col, 0)
        if isinstance(ts, (int, float)):
            minute_key = (ts // 60000) * 60000
        else:
            try:
                minute_key = str(ts)[:16]
            except Exception:
                continue
        buckets[minute_key].append(rec)

    bars = []
    for minute_key in sorted(buckets.keys())[:max_bars]:
        tick_records = buckets[minute_key]
        last = tick_records[-1]
        
        # Convert minute_key to datetime string
        if isinstance(minute_key, (int, float)):
            dt_str = time.strftime("%Y-%m-%d %H:%M:00", time.localtime(minute_key / 1000))
        else:
            dt_str = minute_key + ":00"

        bars.append({
            "datetime_str": dt_str,
            "spot_open": 0, "spot_high": 0, "spot_low": 0, "spot_close": 0,
            "spot_volume": 0, "atm_strike": 0,
            "ce_oi": 0, "pe_oi": 0, "ce_volume": 0, "pe_volume": 0,
            "ce_ltp_open": 0, "ce_ltp_high": 0, "ce_ltp_low": 0, "ce_ltp_close": 0,
            "pe_ltp_open": 0, "pe_ltp_high": 0, "pe_ltp_low": 0, "pe_ltp_close": 0,
            "coi_pcr": last.get("coi_pcr", last.get("pcr", 0.0)) or 0.0,
            "pcr": last.get("pcr", 0.0) or 0.0,
        })

    return bars


def _aggregate_ticks_to_bar(ticks: list, minute_key, all_cols: list) -> dict:
    """Aggregate multiple 3s ticks into one 1-min bar dict."""
    if not ticks:
        return None

    # Find column names
    def find_col(*candidates):
        for c in candidates:
            if c in all_cols:
                return c
        return None

    spot_col = find_col("spot_price", "underlying_price", "ltp")
    strike_col = find_col("strike")
    atm_col = find_col("atm_strike")

    # Spot OHLC
    spot_prices = []
    for t in ticks:
        if spot_col and t.get(spot_col, 0) > 0:
            spot_prices.append(t[spot_col])

    if not spot_prices:
        return None

    # ATM strike (from last tick)
    atm_strike = 0
    last_tick = ticks[-1]
    if atm_col and last_tick.get(atm_col, 0) > 0:
        atm_strike = last_tick[atm_col]
    elif strike_col:
        spot = spot_prices[-1]
        # Find strike closest to spot
        strikes = set(t.get(strike_col, 0) for t in ticks if t.get(strike_col, 0) > 0)
        if strikes:
            atm_strike = min(strikes, key=lambda s: abs(s - spot))

    # Find ATM row for CE/PE data
    atm_row = None
    if strike_col:
        for t in reversed(ticks):
            if t.get(strike_col) == atm_strike:
                atm_row = t
                break

    # CE/PE data
    ce_oi = atm_row.get("ce_oi", 0) if atm_row else 0
    pe_oi = atm_row.get("pe_oi", 0) if atm_row else 0
    ce_vol = sum(t.get("ce_volume", t.get("ce_traded_volume", 0) or 0 for t in ticks)
    pe_vol = sum(t.get("pe_volume", t.get("pe_traded_volume", 0) or 0 for t in ticks))

    # CE LTP OHLC
    ce_ltps = [t.get("ce_ltp", t.get("ce_last_price", 0) or 0) for t in ticks]
    pe_ltps = [t.get("pe_ltp", t.get("pe_last_price", 0) or 0) for t in ticks]
    ce_ltps = [v for v in ce_ltps if v > 0]
    pe_ltps = [v for v in pe_ltps if v > 0]

    # COI PCR (from last tick)
    coi_pcr = last_tick.get("coi_pcr", last_tick.get("pcr", 0.0)) or 0.0

    # Datetime
    if isinstance(minute_key, (int, float)):
        dt_str = time.strftime("%Y-%m-%d %H:%M:00", time.localtime(minute_key / 1000))
    else:
        dt_str = str(minute_key) + ":00"

    return {
        "datetime_str": dt_str,
        "spot_open": spot_prices[0],
        "spot_high": max(spot_prices),
        "spot_low": min(spot_prices),
        "spot_close": spot_prices[-1],
        "spot_volume": 0,
        "atm_strike": atm_strike,
        "ce_oi": float(ce_oi),
        "pe_oi": float(pe_oi),
        "ce_volume": float(ce_vol),
        "pe_volume": float(pe_vol),
        "ce_ltp_open": ce_ltps[0] if ce_ltps else 0,
        "ce_ltp_high": max(ce_ltps) if ce_ltps else 0,
        "ce_ltp_low": min(ce_ltps) if ce_ltps else 0,
        "ce_ltp_close": ce_ltps[-1] if ce_ltps else 0,
        "pe_ltp_open": pe_ltps[0] if pe_ltps else 0,
        "pe_ltp_high": max(pe_ltps) if pe_ltps else 0,
        "pe_ltp_low": min(pe_ltps) if pe_ltps else 0,
        "pe_ltp_close": pe_ltps[-1] if pe_ltps else 0,
        "coi_pcr": float(coi_pcr),
        "pcr": 0.0,
    }


def _find_time_column(conn, table_name: str) -> Optional[str]:
    """Find the time column name in a table."""
    try:
        cols = [c[0] for c in conn.execute(f"DESCRIBE {table_name}").fetchall()]
        for candidate in ["time_stamp", "timestamp", "datetime", "time"]:
            if candidate in cols:
                return candidate
    except Exception:
        pass
    return None


def _feed_bars(rl_engine, bars: list) -> int:
    """Convert bar dicts to BarData and feed to RL engine."""
    from live_engine import BarData

    fed = 0
    for bar in bars:
        try:
            bar_data = BarData(
                timestamp=bar.get("datetime_str", ""),
                open=bar.get("spot_open", 0),
                high=bar.get("spot_high", 0),
                low=bar.get("spot_low", 0),
                close=bar.get("spot_close", 0),
                volume=bar.get("spot_volume", 0),
                ce_oi=bar.get("ce_oi", 0),
                pe_oi=bar.get("pe_oi", 0),
                ce_volume=bar.get("ce_volume", 0),
                pe_volume=bar.get("pe_volume", 0),
                ce_close=bar.get("ce_ltp_close", bar.get("ce_ltp", 0)),
                pe_close=bar.get("pe_ltp_close", bar.get("pe_ltp", 0)),
                ce_open=bar.get("ce_ltp_open", 0),
                ce_high=bar.get("ce_ltp_high", 0),
                ce_low=bar.get("ce_ltp_low", 0),
                pe_open=bar.get("pe_ltp_open", 0),
                pe_high=bar.get("pe_ltp_high", 0),
                pe_low=bar.get("pe_ltp_low", 0),
                atm_strike=bar.get("atm_strike", 0),
                coi_pcr_7=bar.get("coi_pcr", 0),
                coi_ce_7=bar.get("ce_oi", 0),
                coi_pe_7=bar.get("pe_oi", 0),
                cum_pcr_7=bar.get("pcr", bar.get("coi_pcr", 0)),
            )
            rl_engine._live_engine.on_new_bar(bar_data)
            fed += 1
        except Exception as e:
            logger.debug(f"[RL Warmup] Skipping bar: {e}")

    return fed