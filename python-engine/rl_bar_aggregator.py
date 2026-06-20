"""
RL Bar Aggregator — 3-second ticks → 1-minute OHLCV bars for RL engine
========================================================================
Runs inside the 7Strike Python engine alongside market_engine.

The app stores data at ~3s resolution in DuckDB. The RL engine needs
1-minute bars with 500-bar lookback. This module:

  1. Every 60 seconds, reads the last 60s of 3s snapshots from DuckDB
  2. Aggregates them into one 1-min bar (OHLCV for spot + ATM CE/PE)
  3. Stores the result in a new `rl_bars_1min` table

Startup flow:
  - At 9:15 AM, the aggregator starts collecting 3s data
  - By ~9:25 AM, it has enough 1-min bars for the RL engine warmup
  - After that, the table continuously grows (use a retention policy if needed)

Integration (add to market_engine._periodic_update or lifespan):
    from rl_bar_aggregator import RLBarAggregator
    aggregator = RLBarAggregator(duckdb_path, symbols=["NIFTY", "BANKNIFTY"])
    # Call every 60 seconds:
    aggregator.aggregate_minute()
"""

import time
from pathlib import Path
from typing import List, Optional, Dict, Any
from loguru import logger


class RLBarAggregator:
    """
    Aggregates 3-second option chain snapshots into 1-minute RL bars.
    
    Reads from: option_chain_snapshots (3s raw data, EXISTING table)
    Writes to:   rl_bars_1min (NEW table, 1-min aggregated)
    
    Also reads from coi_pcr_history for PCR data.
    """

    def __init__(self, db_path: str, symbols: List[str] = None):
        """
        Args:
            db_path: Path to 7Strike's DuckDB database
            symbols: List of symbols to aggregate (default: NIFTY, BANKNIFTY)
        """
        self.db_path = Path(db_path)
        self.symbols = symbols or ["NIFTY", "BANKNICKY"]
        self._conn = None
        self._last_agg_time: Dict[str, int] = {}  # symbol -> last aggregated minute timestamp
        self._initialized = False

    def _get_conn(self):
        """Lazy connection to DuckDB."""
        if self._conn is None:
            import duckdb
            self._conn = duckdb.connect(str(self.db_path))
            self._create_table()
            self._discover_schema()
            self._initialized = True
        return self._conn

    def _create_table(self):
        """Create the rl_bars_1min table if it doesn't exist."""
        conn = self._get_conn()
        conn.execute("""
            CREATE TABLE IF NOT EXISTS rl_bars_1min (
                symbol         VARCHAR,
                minute_ts      BIGINT,       -- millisecond timestamp, truncated to minute
                datetime_str   VARCHAR,      -- '2025-01-15 09:16:00'
                spot_open      DOUBLE,
                spot_high      DOUBLE,
                spot_low       DOUBLE,
                spot_close     DOUBLE,
                spot_volume    DOUBLE,
                atm_strike     DOUBLE,
                ce_oi          DOUBLE,       -- ATM CE OI (last value in minute)
                pe_oi          DOUBLE,       -- ATM PE OI (last value in minute)
                ce_volume      DOUBLE,       -- ATM CE volume (sum)
                pe_volume      DOUBLE,       -- ATM PE volume (sum)
                ce_ltp_open    DOUBLE,
                ce_ltp_high    DOUBLE,
                ce_ltp_low     DOUBLE,
                ce_ltp_close   DOUBLE,       -- ATM CE LTP at end of minute
                pe_ltp_open    DOUBLE,
                pe_ltp_high    DOUBLE,
                pe_ltp_low     DOUBLE,
                pe_ltp_close   DOUBLE,       -- ATM PE LTP at end of minute
                coi_pcr        DOUBLE,       -- from coi_pcr_history (last value)
                pcr            DOUBLE,       -- from pcr_history (last value)
                n_ticks        INTEGER,      -- how many 3s ticks went into this bar
                PRIMARY KEY (symbol, minute_ts)
            )
        """)
        logger.info("[RLBarAggregator] Created/verified rl_bars_1min table")

    def _discover_schema(self):
        """Discover the actual column names in option_chain_snapshots."""
        conn = self._get_conn()
        tables = [r[0] for r in conn.execute("SHOW TABLES").fetchall()]
        self._tables = tables
        logger.info(f"[RLBarAggregator] Available tables: {tables}")

        # Get column names for key tables
        if "option_chain_snapshots" in tables:
            cols = conn.execute("DESCRIBE option_chain_snapshots").fetchall()
            self._snapshot_cols = [c[0] for c in cols]
            logger.debug(f"[RLBarAggregator] snapshot columns: {self._snapshot_cols}")

        if "coi_pcr_history" in tables:
            cols = conn.execute("DESCRIBE coi_pcr_history").fetchall()
            self._coi_cols = [c[0] for c in cols]

    def aggregate_minute(self) -> Dict[str, int]:
        """
        Aggregate the last ~60 seconds of 3s data into 1-min bars.
        Call this every 60 seconds from a timer or the periodic update loop.
        
        Returns:
            Dict of {symbol: bars_written} for each symbol processed.
        """
        conn = self._get_conn()
        now_ms = int(time.time() * 1000)
        result = {}

        for symbol in self.symbols:
            try:
                n = self._aggregate_symbol(conn, symbol, now_ms)
                result[symbol] = n
            except Exception as e:
                logger.error(f"[RLBarAggregator] Error aggregating {symbol}: {e}")

        return result

    def _aggregate_symbol(self, conn, symbol: str, now_ms: int) -> int:
        """Aggregate one symbol's data for the last complete minute."""
        # Determine the minute boundary (previous complete minute)
        current_minute = (now_ms // 60000) * 60000
        prev_minute = current_minute - 60000

        # Skip if we already aggregated this minute
        if symbol in self._last_agg_time and self._last_agg_time[symbol] >= prev_minute:
            return 0

        bars_written = 0

        # ── Strategy 1: Aggregate from option_chain_snapshots ──
        if "option_chain_snapshots" in self._tables:
            bars_written = self._aggregate_from_snapshots(conn, symbol, prev_minute, current_minute)

        # ── Strategy 2: Aggregate from coi_pcr_history (fallback) ──
        elif "coi_pcr_history" in self._tables:
            bars_written = self._aggregate_from_coi_history(conn, symbol, prev_minute, current_minute)

        if bars_written > 0:
            self._last_agg_time[symbol] = prev_minute
            logger.debug(f"[RLBarAggregator] {symbol}: wrote {bars_written} 1-min bar(s)")

        return bars_written

    def _aggregate_from_snapshots(self, conn, symbol: str, start_ms: int, end_ms: int) -> int:
        """
        Aggregate from option_chain_snapshots table.
        
        This table stores raw chain data at ~3s intervals.
        We need to figure out the exact column names since they may vary.
        Common patterns:
          - strike, ce_oi, pe_oi, ce_ltp, pe_ltp, ce_volume, pe_volume
          - symbol, time_stamp, spot_price, atm_strike
        """
        # First, get the data for this time window
        # Try common column names for time filtering
        time_col = "time_stamp" if "time_stamp" in self._snapshot_cols else \
                   "timestamp" if "timestamp" in self._snapshot_cols else \
                   "datetime" if "datetime" in self._snapshot_cols else None

        if time_col is None:
            logger.warning("[RLBarAggregator] Cannot find time column in option_chain_snapshots")
            return 0

        # Find spot price column
        spot_col = None
        for candidate in ["spot_price", "underlying_price", "ltp", "spot_ltp"]:
            if candidate in self._snapshot_cols:
                spot_col = candidate
                break

        # Find strike column
        strike_col = "strike" if "strike" in self._snapshot_cols else None
        atm_col = "atm_strike" if "atm_strike" in self._snapshot_cols else None

        if not strike_col:
            logger.warning("[RLBarAggregator] No strike column found in snapshots")
            return 0

        # Get all rows for this symbol and time window
        query = f"""
            SELECT * FROM option_chain_snapshots
            WHERE {time_col} >= {start_ms} AND {time_col} < {end_ms}
        """
        
        # Add symbol filter if the column exists
        if "symbol" in self._snapshot_cols:
            query += f" AND symbol = '{symbol}'"

        try:
            rows = conn.execute(query).fetchall()
        except Exception as e:
            logger.error(f"[RLBarAggregator] Query failed: {e}")
            return 0

        if not rows:
            return 0

        col_names = [desc[0] for desc in conn.description]
        records = [dict(zip(col_names, row)) for row in rows]

        # Group by minute (all records here are within the same minute)
        # Sort by time
        if time_col in records[0]:
            records.sort(key=lambda r: r.get(time_col, 0))

        # Extract ATM strike (use the most recent one or from config)
        atm_strike = 0
        if atm_col:
            atm_strike = records[-1].get(atm_col, 0)
        elif strike_col:
            # Find the strike closest to spot price as ATM
            if spot_col and records[-1].get(spot_col, 0) > 0:
                spot = records[-1][spot_col]
                strikes = set(r.get(strike_col, 0) for r in records if r.get(strike_col, 0) > 0)
                if strikes:
                    atm_strike = min(strikes, key=lambda s: abs(s - spot))

        if atm_strike <= 0 and strike_col:
            # Fallback: use the most common strike
            from collections import Counter
            strikes = [r.get(strike_col, 0) for r in records if r.get(strike_col, 0) > 0]
            if strikes:
                atm_strike = Counter(strikes).most_common(1)[0][0]

        # Find ATM row in the LAST tick (most recent data)
        atm_row = None
        if strike_col and records:
            last_tick = records[-1]
            # If this row already is ATM-level data
            if last_tick.get(strike_col) == atm_strike:
                atm_row = last_tick
            else:
                # Search all rows for ATM strike
                for r in reversed(records):
                    if r.get(strike_col) == atm_strike:
                        atm_row = r
                        break

        # Aggregate spot data
        spot_prices = [r.get(spot_col, 0) for r in records if r.get(spot_col, 0) > 0] if spot_col else []
        
        # Get CE/PE data from ATM row or aggregated
        ce_oi = atm_row.get("ce_oi", 0) if atm_row else 0
        pe_oi = atm_row.get("pe_oi", 0) if atm_row else 0
        ce_vol = sum(r.get("ce_volume", r.get("ce_traded_volume", 0) or 0 for r in records)
        pe_vol = sum(r.get("pe_volume", r.get("pe_traded_volume", 0) or 0 for r in records)

        # CE/PE LTP aggregation (OHLC from tick LTPs)
        ce_ltps = [r.get("ce_ltp", r.get("ce_last_price", 0) or 0) for r in records]
        pe_ltps = [r.get("pe_ltp", r.get("pe_last_price", 0) or 0) for r in records]
        ce_ltps = [v for v in ce_ltps if v > 0]
        pe_ltps = [v for v in pe_ltps if v > 0]

        # Get COI PCR from coi_pcr_history if available
        coi_pcr_val = 0.0
        pcr_val = 0.0
        if "coi_pcr_history" in self._tables:
            try:
                pcr_row = conn.execute(f"""
                    SELECT * FROM coi_pcr_history
                    WHERE symbol = '{symbol}'
                    AND time_stamp >= {start_ms} AND time_stamp < {end_ms}
                    ORDER BY time_stamp DESC LIMIT 1
                """).fetchone()
                if pcr_row:
                    pcr_cols = [d[0] for d in conn.description]
                    pcr_dict = dict(zip(pcr_cols, pcr_row))
                    coi_pcr_val = pcr_dict.get("coi_pcr", pcr_dict.get("pcr", pcr_dict.get("current_pcr", 0.0)) or 0.0)
            except Exception:
                pass

        if "pcr_history" in self._tables:
            try:
                pcr_row2 = conn.execute(f"""
                    SELECT * FROM pcr_history
                    WHERE symbol = '{symbol}'
                    AND time_stamp >= {start_ms} AND time_stamp < {end_ms}
                    ORDER BY time_stamp DESC LIMIT 1
                """).fetchone()
                if pcr_row2:
                    pcr_cols2 = [d[0] for d in conn.description]
                    pcr_dict2 = dict(zip(pcr_cols2, pcr_row2))
                    pcr_val = pcr_dict2.get("pcr", pcr_dict2.get("current_pcr", 0.0)) or 0.0
            except Exception:
                pass

        # Build the 1-min bar
        spot_open = spot_prices[0] if spot_prices else 0
        spot_high = max(spot_prices) if spot_prices else 0
        spot_low = min(spot_prices) if spot_prices else 0
        spot_close = spot_prices[-1] if spot_prices else 0

        # Convert minute_ts to datetime string
        dt_str = time.strftime("%Y-%m-%d %H:%M:00", time.localtime(prev_minute / 1000))

        # Upsert the 1-min bar
        conn.execute("""
            INSERT OR REPLACE INTO rl_bars_1min VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            symbol,
            prev_minute,
            dt_str,
            spot_open,
            spot_high,
            spot_low,
            spot_close,
            0,  # spot_volume (not typically in chain snapshots)
            atm_strike,
            float(ce_oi),
            float(pe_oi),
            float(ce_vol),
            float(pe_vol),
            ce_ltps[0] if ce_ltps else 0,     # ce_ltp_open
            max(ce_ltps) if ce_ltps else 0,   # ce_ltp_high
            min(ce_ltps) if ce_ltps else 0,   # ce_ltp_low
            ce_ltps[-1] if ce_ltps else 0,    # ce_ltp_close
            pe_ltps[0] if pe_ltps else 0,     # pe_ltp_open
            max(pe_ltps) if pe_ltps else 0,   # pe_ltp_high
            min(pe_ltps) if pe_ltps else 0,   # pe_ltp_low
            pe_ltps[-1] if pe_ltps else 0,    # pe_ltp_close
            float(coi_pcr_val),
            float(pcr_val),
            len(records),
        ))

        return 1

    def _aggregate_from_coi_history(self, conn, symbol: str, start_ms: int, end_ms: int) -> int:
        """
        Fallback: aggregate from coi_pcr_history table.
        This gives us PCR + some price data but less detail than snapshots.
        """
        try:
            rows = conn.execute(f"""
                SELECT * FROM coi_pcr_history
                WHERE symbol = '{symbol}'
                AND time_stamp >= {start_ms} AND time_stamp < {end_ms}
                ORDER BY time_stamp
            """).fetchall()
        except Exception:
            return 0

        if not rows:
            return 0

        cols = [d[0] for d in conn.description]
        records = [dict(zip(cols, row)) for row in rows]

        # Try to extract what we can
        dt_str = time.strftime("%Y-%m-%d %H:%M:00", time.localtime(start_ms / 1000))

        # Get last PCR value
        coi_pcr_val = records[-1].get("coi_pcr", records[-1].get("pcr", 0.0)) or 0.0

        conn.execute("""
            INSERT OR REPLACE INTO rl_bars_1min VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            symbol, start_ms, dt_str,
            0, 0, 0, 0, 0, 0,  # spot OHLCV + atm (not available here)
            0, 0, 0, 0,        # CE/PE OI + volume
            0, 0, 0, 0,        # CE LTP OHLC
            0, 0, 0, 0,        # PE LTP OHLC
            float(coi_pcr_val), 0.0,
            len(records),
        ))

        return 1

    def get_recent_bars(self, symbol: str, n_bars: int = 600) -> list:
        """
        Get the most recent N 1-min bars for RL warmup.
        Returns list of dicts, ordered chronologically (oldest first).
        """
        conn = self._get_conn()
        rows = conn.execute(f"""
            SELECT * FROM rl_bars_1min
            WHERE symbol = '{symbol}'
            ORDER BY minute_ts DESC
            LIMIT {n_bars}
        """).fetchall()

        if not rows:
            return []

        cols = [d[0] for d in conn.description]
        records = [dict(zip(cols, row)) for row in rows]
        records.reverse()  # oldest first
        return records

    def get_bar_count(self, symbol: str) -> int:
        """Get total number of 1-min bars stored for a symbol."""
        conn = self._get_conn()
        try:
            row = conn.execute(f"""
                SELECT COUNT(*) FROM rl_bars_1min WHERE symbol = '{symbol}'
            """).fetchone()
            return row[0] if row else 0
        except Exception:
            return 0

    def cleanup_old_bars(self, symbol: str, keep_days: int = 5):
        """Remove bars older than keep_days to prevent unbounded growth."""
        conn = self._get_conn()
        cutoff_ms = int(time.time() * 1000) - (keep_days * 86400 * 1000)
        try:
            result = conn.execute(f"""
                DELETE FROM rl_bars_1min
                WHERE symbol = '{symbol}' AND minute_ts < {cutoff_ms}
            """)
            deleted = result.rowcount
            if deleted > 0:
                logger.info(f"[RLBarAggregator] Cleaned {deleted} old bars for {symbol}")
            return deleted
        except Exception as e:
            logger.error(f"[RLBarAggregator] Cleanup error: {e}")
            return 0

    def close(self):
        if self._conn:
            self._conn.close()
            self._conn = None