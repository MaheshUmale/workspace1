/**
 * TypeScript type definitions for the Trading Engine service.
 */

// ============ Configuration ============

export interface UnderlyingConfig {
  symbol: string;
  basePrice: number;
  strikeStep: number;
  lotSize: number;
  atmStrikesRange: number;
  volatilityDaily: number;
  tickIntervalSeconds: number;
}

export const UNDERLYINGS: Record<string, UnderlyingConfig> = {
  NIFTY: {
    symbol: 'NIFTY',
    basePrice: 23500,
    strikeStep: 50,
    lotSize: 25,
    atmStrikesRange: 10,
    volatilityDaily: 0.012,
    tickIntervalSeconds: 1,
  },
  BANKNIFTY: {
    symbol: 'BANKNIFTY',
    basePrice: 51000,
    strikeStep: 100,
    lotSize: 15,
    atmStrikesRange: 10,
    volatilityDaily: 0.015,
    tickIntervalSeconds: 1,
  },
};

export const SEVEN_STRIKE_WINDOW = 7;
export const STABILIZATION_MINUTES = 15;

// ============ Instrument Models ============

export interface Instrument {
  instrument_key: string;
  trading_symbol: string;
  name: string;
  expiry?: string;
  strike?: number;
  option_type?: string; // CE / PE
  lot_size: number;
  underlying: string;
  exchange: string;
  tick_size: number;
}

export interface ExpiryInfo {
  underlying: string;
  expiry_date: string;
  expiry_label: string;
  is_weekly: boolean;
  days_to_expiry: number;
}

// ============ Candle Models ============

export interface Candle {
  time: number;     // epoch seconds for lightweight-charts
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CandleResponse {
  instrument_key: string;
  timeframe: string;
  candles: Candle[];
}

// ============ Option Chain Models ============

export interface OptionStrike {
  strike: number;
  option_type: string;
  instrument_key: string;
  trading_symbol: string;
  ltp: number;
  volume: number;
  oi: number;
  change_oi: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  bid_price: number;
  ask_price: number;
  bid_qty: number;
  ask_qty: number;
}

export interface OptionChainRow {
  strike: number;
  ce: OptionStrike | null;
  pe: OptionStrike | null;
}

export interface OptionChainResponse {
  underlying: string;
  expiry: string;
  spot_price: number;
  atm_strike: number;
  strike_step: number;
  chain: OptionChainRow[];
}

// ============ OI Data Models ============

export interface OIDataPoint {
  timestamp: number;
  oi: number;
  change_oi: number;
}

export interface OIDataResponse {
  instrument_key: string;
  data: OIDataPoint[];
}

// ============ PCR Models ============

export interface PCRDataPoint {
  timestamp: number;
  spot: number;
  pcr: number;
  change_pcr: number;
}

export interface PCRResponse {
  underlying: string;
  expiry: string;
  data: PCRDataPoint[];
  current_pcr: number;
  current_change_pcr: number;
}

// ============ 7-Strike Models ============

export interface SevenStrikeRow {
  strike: number;
  ce_coi: number;
  pe_coi: number;
  ce_oi: number;
  pe_oi: number;
}

export interface SevenStrikeMatrix {
  underlying: string;
  expiry: string;
  spot_price: number;
  atm_strike: number;
  strike_step: number;
  window_strikes: number[];
  rows: SevenStrikeRow[];
  ce_coi_sum: number;
  pe_coi_sum: number;
  coi_pcr: number;
  state: string; // STABLE | WINDOW_SHIFTING_STABILIZING
  last_shift_time: number | null;
  stabilization_end_time: number | null;
}

export interface Signal {
  signal_type: string; // LONG | SHORT | NEUTRAL | EXIT_LONG | EXIT_SHORT
  confidence: number;  // 0.0 to 1.0
  reason: string;
  timestamp: number;
  spot_price: number;
  coi_pcr: number;
  volume_percent: number | null;
  gate_condition: string | null; // NONE | LONG | SHORT
  pain_index: number | null;
}

export interface SevenStrikeSignalsResponse {
  underlying: string;
  expiry: string;
  signals: Signal[];
  current_signal: Signal | null;
  gate_condition: string; // NONE | LONG | SHORT
  state: string; // IDLE | ZONE_WATCH | ACTIVE
}

// ============ Spot Tick Models ============

export interface SpotTick {
  symbol: string;
  ltp: number;
  change: number;
  change_pct: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

export interface OptionTick {
  instrument_key: string;
  strike: number;
  option_type: string;
  ltp: number;
  volume: number;
  oi: number;
  change_oi: number;
  bid_price: number;
  ask_price: number;
  timestamp: number;
}

export interface OIUpdate {
  underlying: string;
  strikes: Array<{
    strike: number;
    ce_oi: number;
    ce_change_oi: number;
    pe_oi: number;
    pe_change_oi: number;
  }>;
}

export interface PCRUpdate {
  underlying: string;
  pcr: number;
  change_pcr: number;
  spot: number;
  timestamp: number;
}

export interface SevenStrikeUpdate {
  matrix: SevenStrikeMatrix;
  signals: SevenStrikeSignalsResponse;
}

// ============ Replay Models ============

export interface ReplaySession {
  date: string;
  underlying: string;
  status: string; // available | in_progress | completed
  tick_count: number;
}

export interface ReplayStartRequest {
  date: string;
  underlying: string;
  speed: number;
}

// ============ Health Models ============

export interface HealthResponse {
  status: string;
  mode: string;
  uptime_seconds: number;
  tick_count: number;
  last_tick_time: number | null;
}

// ============ 7-Strike State Tracking ============

export interface SevenStrikeState {
  currentAtm: number | null;
  prevAtm: number | null;
  lastShiftTime: number | null;
  stabilizationEndTime: number | null;
  state: string; // STABLE | WINDOW_SHIFTING_STABILIZING
}

// ============ OI State ============

export interface OIStateEntry {
  openOi: number;
  currentOi: number;
}

// ============ Candle State ============

export interface CandleState {
  candles: Candle[];
  current: {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    startTime: number;
  } | null;
}
