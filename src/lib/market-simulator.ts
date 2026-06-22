// ============================================================
// Market Data Simulator — Types & Interfaces
// (Simulation logic removed — Live & Replay only)
// ============================================================

export interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

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

export interface OptionEntry {
  instrument_key: string;
  ltp: number;
  oi: number;
  change_oi: number;
  volume: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  bid_price: number;
  ask_price: number;
}

export interface OptionChainRow {
  strike: number;
  ce: OptionEntry;
  pe: OptionEntry;
}

export interface MiniOptionEntry {
  instrument_key: string;
  ltp: number;
  oi: number;
  change_oi: number;
  volume: number;
  iv: number;
  delta: number;
  bid_price: number;
  ask_price: number;
}

export interface MiniOptionChainRow {
  strike: number;
  ce: MiniOptionEntry;
  pe: MiniOptionEntry;
}

export interface Instrument {
  instrument_key: string;
  name: string;
  underlying: string;
  type: 'INDEX' | 'FUT' | 'CE' | 'PE';
  expiry?: string;
  strike?: number;
  display_name?: string;
}

export interface ExpiryInfo {
  expiry_date: string;
  expiry_label: string;
  is_weekly: boolean;
  days_to_expiry: number;
}

export interface OIDatum {
  timestamp: number;
  strike: number;
  ce_oi: number;
  ce_change_oi: number;
  pe_oi: number;
  pe_change_oi: number;
}

export interface PCRPoint {
  timestamp: number;
  spot: number;
  pcr: number;
  change_pcr: number;
}

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
  state: string;
}

export interface Signal {
  signal_type: string;
  confidence: number;
  reason: string;
  timestamp: number;
  spot_price: number;
  coi_pcr: number;
  volume_percent: number | null;
  gate_condition: string | null;
  pain_index: number | null;
}

export interface SevenStrikeSignals {
  underlying: string;
  expiry: string;
  signals: Signal[];
  current_signal: Signal | null;
  gate_condition: string;
  state: string;
}

export interface COIPCRPoint {
  timestamp: number;
  coi_pcr: number;
  spot: number;
  ce_coi_sum: number;
  pe_coi_sum: number;
  state: string;
  signal_type: string;
  confidence: number;
}

export interface TradeSuggestion {
  id: string;
  signal_type: 'LONG' | 'SHORT';
  entry_price: number;
  stop_loss: number;
  target: number;
  risk_reward: string;
  confidence: number;
  reason: string;
  timestamp: number;
  spot_price: number;
  coi_pcr: number;
  status: 'ACTIVE' | 'HIT_TARGET' | 'HIT_SL' | 'EXPIRED' | 'CANCELLED';
  option_suggestion: string;
  exit_reason: string | null;
}

export interface VolumeProxyPoint {
  timestamp: number;
  volume_percent: number;
  classification: 'NORMAL' | 'ELEVATED' | 'HIGH' | 'EXTREME';
  spot: number;
}

export interface TrapCluster {
  id: string;
  price_high: number;
  price_low: number;
  timestamp_start: number;
  volume_trapped: number;
  direction: 'BULLISH_TRAP' | 'BEARISH_TRAP';
  pain_index: number;
  active: boolean;
  triggered: boolean;
}

export interface SevenStrikeHistory {
  underlying: string;
  expiry: string;
  coi_pcr_series: COIPCRPoint[];
  volume_proxy_series: VolumeProxyPoint[];
  trap_clusters: TrapCluster[];
  signals: Signal[];
  trade_suggestions: TradeSuggestion[];
}
