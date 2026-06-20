import duckdb
import os
import json
import time
from pathlib import Path

DB_PATH = os.environ.get("DUCKDB_PATH", "python-engine/data/trading.duckdb")


class Database:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._conn = None
        return cls._instance

    @property
    def conn(self) -> duckdb.DuckDBPyConnection:
        if self._conn is None:
            # Ensure data directory exists
            Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
            self._conn = duckdb.connect(DB_PATH)
            self._init_schema()
        return self._conn

    def _init_schema(self):
        """Initialize all tables"""
        # Create sequences FIRST (before tables that reference them)
        self._conn.execute("CREATE SEQUENCE IF NOT EXISTS oc_snap_seq START 1")
        self._conn.execute("CREATE SEQUENCE IF NOT EXISTS signal_seq START 1")
        
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS candles (
                symbol VARCHAR,
                timeframe VARCHAR,
                time_stamp BIGINT,
                open DOUBLE,
                high DOUBLE,
                low DOUBLE,
                close DOUBLE,
                volume BIGINT,
                PRIMARY KEY (symbol, timeframe, time_stamp)
            )
        """)
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS option_chain_snapshots (
                id INTEGER PRIMARY KEY DEFAULT nextval('oc_snap_seq'),
                symbol VARCHAR,
                expiry VARCHAR,
                time_stamp BIGINT,
                spot_price DOUBLE,
                atm_strike INTEGER,
                data_json VARCHAR
            )
        """)
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS pcr_history (
                symbol VARCHAR,
                time_stamp BIGINT,
                spot DOUBLE,
                pcr DOUBLE,
                change_pcr DOUBLE,
                PRIMARY KEY (symbol, time_stamp)
            )
        """)
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS coi_pcr_history (
                symbol VARCHAR,
                time_stamp BIGINT,
                coi_pcr DOUBLE,
                spot DOUBLE,
                ce_coi_sum BIGINT,
                pe_coi_sum BIGINT,
                state VARCHAR,
                signal_type VARCHAR,
                confidence DOUBLE,
                PRIMARY KEY (symbol, time_stamp)
            )
        """)
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS signals (
                id INTEGER PRIMARY KEY DEFAULT nextval('signal_seq'),
                symbol VARCHAR,
                signal_type VARCHAR,
                confidence DOUBLE,
                reason VARCHAR,
                time_stamp BIGINT,
                spot_price DOUBLE,
                coi_pcr DOUBLE,
                volume_percent DOUBLE,
                gate_condition VARCHAR,
                pain_index DOUBLE
            )
        """)
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS trade_suggestions (
                id VARCHAR PRIMARY KEY,
                symbol VARCHAR,
                signal_type VARCHAR,
                entry_price DOUBLE,
                stop_loss DOUBLE,
                target DOUBLE,
                risk_reward VARCHAR,
                confidence DOUBLE,
                reason VARCHAR,
                time_stamp BIGINT,
                spot_price DOUBLE,
                coi_pcr DOUBLE,
                status VARCHAR DEFAULT 'ACTIVE',
                option_suggestion VARCHAR,
                exit_reason VARCHAR
            )
        """)
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS volume_proxy (
                symbol VARCHAR,
                time_stamp BIGINT,
                volume_percent DOUBLE,
                classification VARCHAR,
                spot DOUBLE,
                PRIMARY KEY (symbol, time_stamp)
            )
        """)
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS trap_clusters (
                id VARCHAR PRIMARY KEY,
                symbol VARCHAR,
                price_high DOUBLE,
                price_low DOUBLE,
                timestamp_start BIGINT,
                volume_trapped BIGINT,
                direction VARCHAR,
                pain_index DOUBLE,
                active BOOLEAN DEFAULT TRUE,
                triggered BOOLEAN DEFAULT FALSE
            )
        """)
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS replay_sessions (
                session_id VARCHAR PRIMARY KEY,
                symbol VARCHAR,
                start_time VARCHAR,
                end_time VARCHAR,
                candle_count INTEGER DEFAULT 0
            )
        """)

    def close(self):
        if self._conn:
            self._conn.close()
            self._conn = None

    # ============ Candle Methods ============

    def store_candles(self, symbol: str, timeframe: str, candles: list):
        """Store candles, replacing existing ones for same symbol/tf"""
        if not candles:
            return
        self.conn.execute("""
            DELETE FROM candles WHERE symbol = ? AND timeframe = ?
        """, [symbol, timeframe])
        for c in candles:
            self.conn.execute("""
                INSERT INTO candles VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, [symbol, timeframe, c['time'], c['open'], c['high'], c['low'], c['close'], c['volume']])

    def get_candles(self, symbol: str, timeframe: str) -> list:
        """Get candles for symbol/timeframe"""
        result = self.conn.execute("""
            SELECT time_stamp, open, high, low, close, volume
            FROM candles WHERE symbol = ? AND timeframe = ?
            ORDER BY time_stamp ASC
        """, [symbol, timeframe]).fetchall()
        return [{'time': r[0], 'open': r[1], 'high': r[2], 'low': r[3], 'close': r[4], 'volume': r[5]} for r in result]

    # ============ COI PCR History ============

    def store_coi_pcr_point(self, symbol: str, point: dict):
        """Store a COI PCR data point"""
        self.conn.execute("""
            INSERT OR REPLACE INTO coi_pcr_history VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [symbol, point['timestamp'], point['coi_pcr'], point['spot'],
              point['ce_coi_sum'], point['pe_coi_sum'], point['state'],
              point['signal_type'], point['confidence']])

    def get_coi_pcr_history(self, symbol: str, limit: int = 300) -> list:
        """Get COI PCR history for symbol"""
        result = self.conn.execute("""
            SELECT time_stamp, coi_pcr, spot, ce_coi_sum, pe_coi_sum, state, signal_type, confidence
            FROM coi_pcr_history WHERE symbol = ?
            ORDER BY time_stamp ASC LIMIT ?
        """, [symbol, limit]).fetchall()
        return [{'timestamp': r[0], 'coi_pcr': r[1], 'spot': r[2], 'ce_coi_sum': r[3],
                 'pe_coi_sum': r[4], 'state': r[5], 'signal_type': r[6], 'confidence': r[7]} for r in result]

    # ============ PCR History ============

    def store_pcr_point(self, symbol: str, point: dict):
        """Store a PCR data point"""
        self.conn.execute("""
            INSERT OR REPLACE INTO pcr_history VALUES (?, ?, ?, ?, ?)
        """, [symbol, point['timestamp'], point['spot'], point['pcr'], point['change_pcr']])

    def get_pcr_history(self, symbol: str, limit: int = 300) -> list:
        result = self.conn.execute("""
            SELECT time_stamp, spot, pcr, change_pcr
            FROM pcr_history WHERE symbol = ?
            ORDER BY time_stamp ASC LIMIT ?
        """, [symbol, limit]).fetchall()
        return [{'timestamp': r[0], 'spot': r[1], 'pcr': r[2], 'change_pcr': r[3]} for r in result]

    # ============ Signals ============

    def store_signal(self, symbol: str, signal: dict):
        self.conn.execute("""
            INSERT INTO signals (symbol, signal_type, confidence, reason, time_stamp, spot_price, coi_pcr, volume_percent, gate_condition, pain_index)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [symbol, signal['signal_type'], signal['confidence'], signal['reason'],
              signal['timestamp'], signal['spot_price'], signal['coi_pcr'],
              signal.get('volume_percent'), signal.get('gate_condition'), signal.get('pain_index')])

    def get_signals(self, symbol: str, limit: int = 50) -> list:
        result = self.conn.execute("""
            SELECT signal_type, confidence, reason, time_stamp, spot_price, coi_pcr, volume_percent, gate_condition, pain_index
            FROM signals WHERE symbol = ?
            ORDER BY time_stamp DESC LIMIT ?
        """, [symbol, limit]).fetchall()
        return [{'signal_type': r[0], 'confidence': r[1], 'reason': r[2], 'timestamp': r[3],
                 'spot_price': r[4], 'coi_pcr': r[5], 'volume_percent': r[6],
                 'gate_condition': r[7], 'pain_index': r[8]} for r in reversed(result)]

    # ============ Trade Suggestions ============

    def store_trade_suggestion(self, trade: dict):
        self.conn.execute("""
            INSERT OR REPLACE INTO trade_suggestions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [trade['id'], trade.get('symbol', ''), trade['signal_type'], trade['entry_price'],
              trade['stop_loss'], trade['target'], trade['risk_reward'], trade['confidence'],
              trade['reason'], trade['timestamp'], trade['spot_price'], trade['coi_pcr'],
              trade['status'], trade['option_suggestion'], trade.get('exit_reason')])

    def get_trade_suggestions(self, symbol: str, limit: int = 50) -> list:
        result = self.conn.execute("""
            SELECT id, signal_type, entry_price, stop_loss, target, risk_reward, confidence,
                   reason, time_stamp, spot_price, coi_pcr, status, option_suggestion, exit_reason
            FROM trade_suggestions WHERE symbol = ? OR ? = ''
            ORDER BY time_stamp DESC LIMIT ?
        """, [symbol, symbol, limit]).fetchall()
        return [{'id': r[0], 'signal_type': r[1], 'entry_price': r[2], 'stop_loss': r[3],
                 'target': r[4], 'risk_reward': r[5], 'confidence': r[6], 'reason': r[7],
                 'timestamp': r[8], 'spot_price': r[9], 'coi_pcr': r[10], 'status': r[11],
                 'option_suggestion': r[12], 'exit_reason': r[13]} for r in reversed(result)]

    # ============ Volume Proxy ============

    def store_volume_proxy(self, symbol: str, point: dict):
        self.conn.execute("""
            INSERT OR REPLACE INTO volume_proxy VALUES (?, ?, ?, ?, ?)
        """, [symbol, point['timestamp'], point['volume_percent'], point['classification'], point['spot']])

    def get_volume_proxy(self, symbol: str, limit: int = 300) -> list:
        result = self.conn.execute("""
            SELECT time_stamp, volume_percent, classification, spot
            FROM volume_proxy WHERE symbol = ?
            ORDER BY time_stamp ASC LIMIT ?
        """, [symbol, limit]).fetchall()
        return [{'timestamp': r[0], 'volume_percent': r[1], 'classification': r[2], 'spot': r[3]} for r in result]

    # ============ Trap Clusters ============

    def store_trap_cluster(self, cluster: dict):
        self.conn.execute("""
            INSERT OR REPLACE INTO trap_clusters VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [cluster['id'], cluster.get('symbol', ''), cluster['price_high'], cluster['price_low'],
              cluster['timestamp_start'], cluster['volume_trapped'], cluster['direction'],
              cluster['pain_index'], cluster['active'], cluster['triggered']])

    def get_active_trap_clusters(self, symbol: str) -> list:
        result = self.conn.execute("""
            SELECT id, price_high, price_low, timestamp_start, volume_trapped, direction, pain_index, active, triggered
            FROM trap_clusters WHERE (symbol = ? OR ? = '') AND active = TRUE
            ORDER BY timestamp_start DESC
        """, [symbol, symbol]).fetchall()
        return [{'id': r[0], 'price_high': r[1], 'price_low': r[2], 'timestamp_start': r[3],
                 'volume_trapped': r[4], 'direction': r[5], 'pain_index': r[6],
                 'active': r[7], 'triggered': r[8]} for r in result]

    # ============ Option Chain Snapshots ============

    def store_option_chain_snapshot(self, symbol: str, expiry: str, spot_price: float, atm_strike: int, data_json: str):
        self.conn.execute("""
            INSERT INTO option_chain_snapshots (symbol, expiry, time_stamp, spot_price, atm_strike, data_json)
            VALUES (?, ?, ?, ?, ?, ?)
        """, [symbol, expiry, int(time.time() * 1000), spot_price, atm_strike, data_json])

    def get_option_chain_snapshots(self, symbol: str, expiry: str, limit: int = 100) -> list:
        result = self.conn.execute("""
            SELECT time_stamp, spot_price, atm_strike, data_json
            FROM option_chain_snapshots WHERE symbol = ? AND expiry = ?
            ORDER BY time_stamp DESC LIMIT ?
        """, [symbol, expiry, limit]).fetchall()
        return [{'timestamp': r[0], 'spot_price': r[1], 'atm_strike': r[2], 'data': json.loads(r[3])} for r in result]

    # ============ Replay Sessions ============

    def store_replay_session(self, session: dict):
        self.conn.execute("""
            INSERT OR REPLACE INTO replay_sessions VALUES (?, ?, ?, ?, ?)
        """, [session['session_id'], session['underlying'], session['start_time'],
              session['end_time'], session['candle_count']])

    def get_replay_sessions(self) -> list:
        result = self.conn.execute("SELECT * FROM replay_sessions").fetchall()
        return [{'session_id': r[0], 'underlying': r[1], 'start_time': r[2],
                 'end_time': r[3], 'candle_count': r[4]} for r in result]


def get_db() -> Database:
    return Database()
