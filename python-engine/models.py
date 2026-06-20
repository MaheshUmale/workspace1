from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class CandleData(BaseModel):
    time: int  # Unix timestamp
    open: float
    high: float
    low: float
    close: float
    volume: int


class SpotTick(BaseModel):
    symbol: str
    ltp: float
    change: float
    change_pct: float
    open: float
    high: float
    low: float
    close: float
    volume: int
    timestamp: int


class OptionEntry(BaseModel):
    instrument_key: str
    ltp: float
    oi: int
    change_oi: int
    volume: int
    iv: float
    delta: float
    gamma: float
    theta: float
    vega: float
    bid_price: float
    ask_price: float


class OptionChainRow(BaseModel):
    strike: int
    ce: OptionEntry
    pe: OptionEntry


class MiniOptionEntry(BaseModel):
    instrument_key: str
    ltp: float
    oi: int
    change_oi: int
    volume: int
    iv: float
    delta: float
    bid_price: float
    ask_price: float


class MiniOptionChainRow(BaseModel):
    strike: int
    ce: MiniOptionEntry
    pe: MiniOptionEntry


class Instrument(BaseModel):
    instrument_key: str
    name: str
    underlying: str
    type: str  # INDEX, CE, PE, FUT
    expiry: Optional[str] = None
    strike: Optional[int] = None
    display_name: Optional[str] = None


class ExpiryInfo(BaseModel):
    expiry_date: str
    expiry_label: str
    is_weekly: bool
    days_to_expiry: int


class OIDatum(BaseModel):
    timestamp: int
    strike: int
    ce_oi: int
    ce_change_oi: int
    pe_oi: int
    pe_change_oi: int


class PCRPoint(BaseModel):
    timestamp: int
    spot: float
    pcr: float
    change_pcr: float


class SevenStrikeRow(BaseModel):
    strike: int
    ce_coi: int
    pe_coi: int
    ce_oi: int
    pe_oi: int


class SevenStrikeMatrix(BaseModel):
    underlying: str
    expiry: str
    spot_price: float
    atm_strike: int
    strike_step: int
    window_strikes: List[int]
    rows: List[SevenStrikeRow]
    ce_coi_sum: int
    pe_coi_sum: int
    coi_pcr: float
    state: str


class Signal(BaseModel):
    signal_type: str
    confidence: float
    reason: str
    timestamp: int
    spot_price: float
    coi_pcr: float
    volume_percent: Optional[float] = None
    gate_condition: Optional[str] = None
    pain_index: Optional[float] = None


class SevenStrikeSignals(BaseModel):
    underlying: str
    expiry: str
    signals: List[Signal]
    current_signal: Optional[Signal] = None
    gate_condition: str
    state: str


class COIPCRPoint(BaseModel):
    timestamp: int
    coi_pcr: float
    spot: float
    ce_coi_sum: int
    pe_coi_sum: int
    state: str
    signal_type: str
    confidence: float


class TradeSuggestion(BaseModel):
    id: str
    signal_type: str  # LONG or SHORT
    entry_price: float
    stop_loss: float
    target: float
    risk_reward: str
    confidence: float
    reason: str
    timestamp: int
    spot_price: float
    coi_pcr: float
    status: str  # ACTIVE, HIT_TARGET, HIT_SL, EXPIRED, CANCELLED
    option_suggestion: str
    exit_reason: Optional[str] = None


class VolumeProxyPoint(BaseModel):
    timestamp: int
    volume_percent: float
    classification: str  # NORMAL, ELEVATED, HIGH, EXTREME
    spot: float


class TrapCluster(BaseModel):
    id: str
    price_high: float
    price_low: float
    timestamp_start: int
    volume_trapped: int
    direction: str  # BULLISH_TRAP, BEARISH_TRAP
    pain_index: float
    active: bool
    triggered: bool


class SevenStrikeHistory(BaseModel):
    underlying: str
    expiry: str
    coi_pcr_series: List[COIPCRPoint]
    volume_proxy_series: List[VolumeProxyPoint]
    trap_clusters: List[TrapCluster]
    signals: List[Signal]
    trade_suggestions: List[TradeSuggestion]


class ReplaySession(BaseModel):
    session_id: str
    underlying: str
    start_time: str
    end_time: str
    candle_count: int


class HealthResponse(BaseModel):
    status: str
    mode: str
    connected: bool
    upstox_configured: bool
    masked_token: str
    uptime: float
    symbols: List[str]
    tick_count: int
    timestamp: int


class OptionChainResponse(BaseModel):
    underlying: str
    expiry: str
    spot_price: float
    atm_strike: int
    strike_step: int
    chain: List[OptionChainRow]


class MiniOptionChainResponse(BaseModel):
    underlying: str
    expiry: str
    spot_price: float
    atm_strike: int
    strike_step: int
    chain: List[MiniOptionChainRow]


class OIResponse(BaseModel):
    underlying: str
    expiry: str
    spot_price: float
    data: List[OIDatum]


class PCRResponse(BaseModel):
    underlying: str
    expiry: str
    data: List[PCRPoint]
    current_pcr: float
    current_change_pcr: float


class ExpiriesResponse(BaseModel):
    underlying: str
    expiries: List[ExpiryInfo]
