// ============================================================
// Market Data Simulator — Singleton Engine
// Generates realistic Indian market data in-memory
// ============================================================

// ============ Seeded PRNG (Mulberry32) ============

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============ Normal distribution (Box-Muller) ============

function normalRandom(rng: () => number, mean = 0, std = 1): number {
  const u1 = rng();
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1 || 1e-10)) * Math.cos(2 * Math.PI * u2);
  return z * std + mean;
}

// ============ Types ============

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

// ============ Helper functions ============

function nextThursdays(count: number): Date[] {
  const now = new Date();
  const results: Date[] = [];
  const d = new Date(now);
  // Find next Thursday (4 = Thursday)
  while (d.getDay() !== 4) {
    d.setDate(d.getDate() + 1);
  }
  for (let i = 0; i < count; i++) {
    results.push(new Date(d));
    d.setDate(d.getDate() + 7);
  }
  return results;
}

function formatDateLabel(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function formatExpiryDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function compactExpiry(expiryDate: string): string {
  // "2026-06-25" -> "260625"
  return expiryDate.replace(/-/g, '').slice(2);
}

// Cumulative Normal Distribution (Abramowitz & Stegun approximation)
function cdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.SQRT2;
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
}

// Standard Normal PDF
function ndist(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// ============ Constants ============

const UNDERLYING_CONFIG: Record<string, {
  basePrice: number;
  strikeStep: number;
  volatility: number;
  displayName: string;
}> = {
  NIFTY: {
    basePrice: 23500,
    strikeStep: 50,
    volatility: 0.13,
    displayName: 'NIFTY 50',
  },
  BANKNIFTY: {
    basePrice: 51000,
    strikeStep: 100,
    volatility: 0.16,
    displayName: 'BANK NIFTY',
  },
};

const TIMEFRAME_SECONDS: Record<string, number> = {
  '1m': 60,
  '3m': 180,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
};

const RISK_FREE_RATE = 0.07;

// ============ Market Simulator Class ============

class MarketSimulator {
  private rng: () => number;
  private spotPrices: Record<string, number>;
  private openPrices: Record<string, number>;
  private highPrices: Record<string, number>;
  private lowPrices: Record<string, number>;
  private prevClosePrices: Record<string, number>;
  private volumes: Record<string, number>;
  private candles: Record<string, CandleData[]>;
  private oiData: Record<string, Record<number, { ce_oi: number; ce_change_oi: number; pe_oi: number; pe_change_oi: number }>>;
  private pcrHistory: Record<string, PCRPoint[]>;
  private tickCount: number;
  private signalHistory: Record<string, Signal[]>;
  private lastState: Record<string, string>;
  private lastPcr: Record<string, number>;
  private coiPcrHistory: Record<string, COIPCRPoint[]> = {};
  private volumeProxyHistory: Record<string, VolumeProxyPoint[]> = {};
  private trapClustersData: Record<string, TrapCluster[]> = {};
  private tradeSuggestions: Record<string, TradeSuggestion[]> = {};
  private lastATMStrike: Record<string, number> = {};
  private stabilizationUntil: Record<string, number> = {};
  private lastSignalType: Record<string, string> = {};
  private gateConditionActive: Record<string, { type: 'LONG' | 'SHORT'; since: number } | null> = {};

  constructor() {
    this.rng = mulberry32(42);
    this.spotPrices = {};
    this.openPrices = {};
    this.highPrices = {};
    this.lowPrices = {};
    this.prevClosePrices = {};
    this.volumes = {};
    this.candles = {};
    this.oiData = {};
    this.pcrHistory = {};
    this.tickCount = 0;
    this.signalHistory = {};
    this.lastState = {};
    this.lastPcr = {};

    // Initialize for each underlying
    for (const [symbol, config] of Object.entries(UNDERLYING_CONFIG)) {
      const startPrice = config.basePrice + (this.rng() - 0.5) * config.basePrice * 0.02;
      this.spotPrices[symbol] = startPrice;
      this.openPrices[symbol] = startPrice;
      this.highPrices[symbol] = startPrice * 1.005;
      this.lowPrices[symbol] = startPrice * 0.995;
      this.prevClosePrices[symbol] = startPrice * (1 + (this.rng() - 0.5) * 0.01);
      this.volumes[symbol] = Math.floor(this.rng() * 5_000_000) + 1_000_000;
      this.candles[symbol] = [];
      this.oiData[symbol] = {};
      this.pcrHistory[symbol] = [];
      this.signalHistory[symbol] = [];
      this.lastState[symbol] = 'IDLE';
      this.lastPcr[symbol] = 1.0;
    }

    // Generate historical candle data for each underlying and timeframe
    this.generateHistoricalCandles();
    // Generate initial OI data
    this.generateInitialOI();
    // Generate initial PCR history
    this.generateInitialPCR();
    // Generate 7-Strike COI PCR history (120 points simulating 2 hours of 1-min data)
    this.generate7StrikeHistory();
  }

  // ============ Spot Price Generation ============

  generateTick(symbol: string): SpotTick {
    const config = UNDERLYING_CONFIG[symbol];
    if (!config) {
      throw new Error(`Unknown symbol: ${symbol}`);
    }

    const prevPrice = this.spotPrices[symbol];
    // GBM: dS = mu * S * dt + sigma * S * sqrt(dt) * Z
    const mu = 0.0001; // small drift
    const dt = 1 / 252 / 375; // ~1 tick in a trading day
    const sigma = config.volatility;
    const z = normalRandom(this.rng);
    const dS = mu * prevPrice * dt + sigma * prevPrice * Math.sqrt(dt) * z;
    const newPrice = Math.max(prevPrice + dS, prevPrice * 0.95); // prevent going too low

    this.spotPrices[symbol] = newPrice;
    this.highPrices[symbol] = Math.max(this.highPrices[symbol], newPrice);
    this.lowPrices[symbol] = Math.min(this.lowPrices[symbol], newPrice);
    this.volumes[symbol] += Math.floor(this.rng() * 5000) + 100;

    const change = newPrice - this.prevClosePrices[symbol];
    const changePct = (change / this.prevClosePrices[symbol]) * 100;

    this.tickCount++;

    // Occasionally update OI
    if (this.tickCount % 5 === 0) {
      this.updateOI(symbol);
    }

    return {
      symbol,
      ltp: Math.round(newPrice * 100) / 100,
      change: Math.round(change * 100) / 100,
      change_pct: Math.round(changePct * 100) / 100,
      open: Math.round(this.openPrices[symbol] * 100) / 100,
      high: Math.round(this.highPrices[symbol] * 100) / 100,
      low: Math.round(this.lowPrices[symbol] * 100) / 100,
      close: Math.round(newPrice * 100) / 100,
      volume: this.volumes[symbol],
      timestamp: Date.now(),
    };
  }

  getSpotPrice(symbol: string): number {
    return this.spotPrices[symbol] ?? UNDERLYING_CONFIG[symbol]?.basePrice ?? 23500;
  }

  // ============ Historical Candle Generation ============

  private generateHistoricalCandles(): void {
    const now = Math.floor(Date.now() / 1000);

    for (const symbol of Object.keys(UNDERLYING_CONFIG)) {
      for (const [tf, tfSeconds] of Object.entries(TIMEFRAME_SECONDS)) {
        const key = `${symbol}_${tf}`;
        const candles: CandleData[] = [];
        const numCandles = 220;
        const startPrice = this.spotPrices[symbol];
        const config = UNDERLYING_CONFIG[symbol];
        let price = startPrice * (1 + (this.rng() - 0.5) * 0.03); // start a bit off

        // Use a separate deterministic rng for candles based on symbol+tf
        const candleRng = mulberry32(
          symbol === 'NIFTY' ? 1234 : 5678 + (tf === '1m' ? 0 : tf === '3m' ? 1 : tf === '5m' ? 2 : tf === '15m' ? 3 : 4)
        );

        for (let i = numCandles; i > 0; i--) {
          const time = now - i * tfSeconds;
          const open = price;
          // Simulate intra-candle movement
          const numSteps = tf === '1h' ? 60 : tf === '15m' ? 15 : tf === '5m' ? 5 : tf === '3m' ? 3 : 1;
          let high = open;
          let low = open;
          let close = open;

          for (let s = 0; s < numSteps; s++) {
            const mu = 0.00002;
            const dt = 1 / 252 / 375;
            const sigma = config.volatility;
            const z = normalRandom(candleRng);
            const dS = mu * close * dt + sigma * close * Math.sqrt(dt) * z;
            close = Math.max(close + dS, close * 0.98);
            high = Math.max(high, close);
            low = Math.min(low, close);
          }

          const volume = Math.floor(candleRng() * 200000) + 50000 +
            Math.floor(Math.sin(i / 20) * 30000); // periodic volume pattern

          candles.push({
            time,
            open: Math.round(open * 100) / 100,
            high: Math.round(high * 100) / 100,
            low: Math.round(low * 100) / 100,
            close: Math.round(close * 100) / 100,
            volume: Math.max(volume, 1000),
          });

          price = close;
        }

        // Make sure last candle aligns with current price
        if (candles.length > 0) {
          candles[candles.length - 1].close = Math.round(this.spotPrices[symbol] * 100) / 100;
        }

        this.candles[key] = candles;
      }
    }
  }

  // ============ OI Generation ============

  private generateInitialOI(): void {
    for (const [symbol, config] of Object.entries(UNDERLYING_CONFIG)) {
      const spot = this.spotPrices[symbol];
      const step = config.strikeStep;
      const atm = Math.round(spot / step) * step;
      const strikes = this.getStrikes(symbol, 10);

      this.oiData[symbol] = {};
      for (const strike of strikes) {
        const distanceFromATM = Math.abs(strike - atm);
        const roundBonus = strike % 1000 === 0 ? 1.5 : strike % 500 === 0 ? 1.2 : 1.0;
        const baseOI = Math.floor(
          (2_000_000 + this.rng() * 4_000_000) *
          Math.exp(-distanceFromATM / (step * 15)) *
          roundBonus
        );

        const ceChangeOi = Math.floor((this.rng() - 0.4) * 400_000);
        const peChangeOi = Math.floor((this.rng() - 0.4) * 400_000);

        this.oiData[symbol][strike] = {
          ce_oi: baseOI + Math.floor(this.rng() * 1_000_000),
          ce_change_oi: ceChangeOi,
          pe_oi: baseOI + Math.floor(this.rng() * 1_000_000),
          pe_change_oi: peChangeOi,
        };
      }
    }
  }

  private updateOI(symbol: string): void {
    const data = this.oiData[symbol];
    if (!data) return;
    for (const strike of Object.keys(data)) {
      const s = Number(strike);
      const d = data[s];
      // Small random OI changes
      d.ce_change_oi += Math.floor((this.rng() - 0.45) * 10_000);
      d.pe_change_oi += Math.floor((this.rng() - 0.45) * 10_000);
      d.ce_oi += Math.floor(this.rng() * 5_000);
      d.pe_oi += Math.floor(this.rng() * 5_000);
      // Clamp change OI to reasonable range
      d.ce_change_oi = Math.max(-d.ce_oi, Math.min(d.ce_oi, d.ce_change_oi));
      d.pe_change_oi = Math.max(-d.pe_oi, Math.min(d.pe_oi, d.pe_change_oi));
    }
  }

  private getStrikes(symbol: string, numEachSide: number): number[] {
    const config = UNDERLYING_CONFIG[symbol];
    const spot = this.spotPrices[symbol];
    const step = config.strikeStep;
    const atm = Math.round(spot / step) * step;
    const strikes: number[] = [];
    for (let i = -numEachSide; i <= numEachSide; i++) {
      strikes.push(atm + i * step);
    }
    return strikes;
  }

  // ============ PCR History ============

  private generateInitialPCR(): void {
    const now = Date.now();
    for (const symbol of Object.keys(UNDERLYING_CONFIG)) {
      const pcrPoints: PCRPoint[] = [];
      let lastPcr = 0.9 + this.rng() * 0.3;
      const baseSpot = this.spotPrices[symbol];
      let spot = baseSpot * (1 + (this.rng() - 0.5) * 0.01);

      for (let i = 60; i > 0; i--) {
        const timestamp = now - i * 60_000; // 1-minute intervals
        spot += (this.rng() - 0.5) * baseSpot * 0.001;
        lastPcr += (this.rng() - 0.5) * 0.05;
        lastPcr = Math.max(0.3, Math.min(2.5, lastPcr));
        const change_pcr = (this.rng() - 0.5) * 0.1;

        pcrPoints.push({
          timestamp,
          spot: Math.round(spot * 100) / 100,
          pcr: Math.round(lastPcr * 1000) / 1000,
          change_pcr: Math.round(change_pcr * 1000) / 1000,
        });
      }

      this.pcrHistory[symbol] = pcrPoints;
      this.lastPcr[symbol] = lastPcr;
    }
  }

  // ============ Black-Scholes Pricing ============

  private bsPrice(
    S: number, K: number, T: number, sigma: number, type: 'CE' | 'PE'
  ): { price: number; delta: number; gamma: number; theta: number; vega: number } {
    if (T <= 0) {
      // At expiry
      const intrinsic = type === 'CE' ? Math.max(S - K, 0) : Math.max(K - S, 0);
      return { price: intrinsic, delta: 0, gamma: 0, theta: 0, vega: 0 };
    }

    const r = RISK_FREE_RATE;
    const sqrtT = Math.sqrt(T);
    const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * sqrtT);
    const d2 = d1 - sigma * sqrtT;

    const nd1 = cdf(d1);
    const nd2 = cdf(d2);
    const nNd1 = cdf(-d1);
    const nNd2 = cdf(-d2);
    const npd1 = ndist(d1);

    let price: number;
    let delta: number;

    if (type === 'CE') {
      price = S * nd1 - K * Math.exp(-r * T) * nd2;
      delta = nd1;
    } else {
      price = K * Math.exp(-r * T) * nNd2 - S * nNd1;
      delta = nd1 - 1;
    }

    const gamma = npd1 / (S * sigma * sqrtT);
    const theta = (
      -(S * npd1 * sigma) / (2 * sqrtT) -
      (type === 'CE' ? r * K * Math.exp(-r * T) * nd2 : -r * K * Math.exp(-r * T) * nNd2)
    ) / 365;
    const vega = (S * npd1 * sqrtT) / 100;

    return {
      price: Math.max(price, 0.05),
      delta: Math.round(delta * 10000) / 10000,
      gamma: Math.round(gamma * 1000000) / 1000000,
      theta: Math.round(theta * 100) / 100,
      vega: Math.round(vega * 100) / 100,
    };
  }

  private getIV(strike: number, atm: number, baseIV: number): number {
    // IV smile: higher IV for OTM options
    const moneyness = (strike - atm) / atm;
    const skew = moneyness * moneyness * 2; // quadratic smile
    // Add slight negative skew (put IV > call IV)
    const tilt = -moneyness * 0.05;
    return Math.max(0.05, baseIV + skew + tilt + (this.rng() - 0.5) * 0.02);
  }

  // ============ Public API Methods ============

  getCandles(instrumentKey: string, timeframe: string): CandleData[] {
    // instrumentKey can be "NIFTY", "BANKNIFTY", or option key like "NSE_FO|NIFTY26062523500CE"
    let symbol = instrumentKey;
    if (instrumentKey.startsWith('NSE_FO|')) {
      const parsed = this.parseInstrumentKeySimple(instrumentKey);
      if (parsed) symbol = parsed.underlying;
    }

    const tf = TIMEFRAME_SECONDS[timeframe] ? timeframe : '1m';
    const key = `${symbol}_${tf}`;
    return this.candles[key] || [];
  }

  private parseInstrumentKeySimple(key: string): { underlying: string; expiry: string; strike: number; optionType: string } | null {
    try {
      const parts = key.split('|');
      if (parts.length < 2) return null;
      const body = parts[1];

      let underlying = '';
      let rest = body;
      if (body.startsWith('BANKNIFTY')) {
        underlying = 'BANKNIFTY';
        rest = body.slice(9);
      } else if (body.startsWith('NIFTY')) {
        underlying = 'NIFTY';
        rest = body.slice(5);
      } else {
        return null;
      }

      const optionType = rest.endsWith('CE') ? 'CE' : rest.endsWith('PE') ? 'PE' : '';
      if (!optionType) return null;
      rest = rest.slice(0, -2);

      const strikeMatch = rest.match(/(\d+)$/);
      if (!strikeMatch) return null;
      const strike = parseInt(strikeMatch[1]);
      const expiryPart = rest.slice(0, -strikeMatch[1].length);

      const year = 2000 + parseInt(expiryPart.slice(0, 2));
      const month = parseInt(expiryPart.slice(2, 4));
      const day = parseInt(expiryPart.slice(4, 6));
      const expiry = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      return { underlying, expiry, strike, optionType };
    } catch {
      return null;
    }
  }

  getOptionChain(underlying: string, expiry: string): {
    underlying: string;
    expiry: string;
    spot_price: number;
    atm_strike: number;
    strike_step: number;
    chain: OptionChainRow[];
  } {
    const config = UNDERLYING_CONFIG[underlying];
    if (!config) {
      return { underlying, expiry, spot_price: 0, atm_strike: 0, strike_step: 0, chain: [] };
    }

    const spot = this.getSpotPrice(underlying);
    const step = config.strikeStep;
    const atm = Math.round(spot / step) * step;
    const strikes = this.getStrikes(underlying, 10);

    // Parse expiry for time calculation
    const T = this.timeToExpiry(expiry);
    const baseIV = config.volatility;

    const chain: OptionChainRow[] = strikes.map((strike) => {
      const iv = this.getIV(strike, atm, baseIV);
      const ceGreeks = this.bsPrice(spot, strike, T, iv, 'CE');
      const peGreeks = this.bsPrice(spot, strike, T, iv, 'PE');
      const oiInfo = this.oiData[underlying]?.[strike] || { ce_oi: 0, ce_change_oi: 0, pe_oi: 0, pe_change_oi: 0 };

      const spread = Math.max(0.5, ceGreeks.price * 0.005);

      return {
        strike,
        ce: {
          instrument_key: `NSE_FO|${underlying}${compactExpiry(expiry)}${strike}CE`,
          ltp: Math.round(ceGreeks.price * 100) / 100,
          oi: oiInfo.ce_oi,
          change_oi: oiInfo.ce_change_oi,
          volume: Math.floor(this.rng() * 100_000) + 10_000,
          iv: Math.round(iv * 100) / 100,
          delta: ceGreeks.delta,
          gamma: ceGreeks.gamma,
          theta: ceGreeks.theta,
          vega: ceGreeks.vega,
          bid_price: Math.round((ceGreeks.price - spread / 2) * 100) / 100,
          ask_price: Math.round((ceGreeks.price + spread / 2) * 100) / 100,
        },
        pe: {
          instrument_key: `NSE_FO|${underlying}${compactExpiry(expiry)}${strike}PE`,
          ltp: Math.round(peGreeks.price * 100) / 100,
          oi: oiInfo.pe_oi,
          change_oi: oiInfo.pe_change_oi,
          volume: Math.floor(this.rng() * 100_000) + 10_000,
          iv: Math.round(iv * 100) / 100,
          delta: peGreeks.delta,
          gamma: peGreeks.gamma,
          theta: peGreeks.theta,
          vega: peGreeks.vega,
          bid_price: Math.round((peGreeks.price - spread / 2) * 100) / 100,
          ask_price: Math.round((peGreeks.price + spread / 2) * 100) / 100,
        },
      };
    });

    return {
      underlying,
      expiry,
      spot_price: Math.round(spot * 100) / 100,
      atm_strike: atm,
      strike_step: step,
      chain,
    };
  }

  getMiniOptionChain(underlying: string, expiry: string): {
    underlying: string;
    expiry: string;
    spot_price: number;
    atm_strike: number;
    strike_step: number;
    chain: MiniOptionChainRow[];
  } {
    const full = this.getOptionChain(underlying, expiry);
    return {
      underlying: full.underlying,
      expiry: full.expiry,
      spot_price: full.spot_price,
      atm_strike: full.atm_strike,
      strike_step: full.strike_step,
      chain: full.chain.map((row) => ({
        strike: row.strike,
        ce: {
          instrument_key: row.ce.instrument_key,
          ltp: row.ce.ltp,
          oi: row.ce.oi,
          change_oi: row.ce.change_oi,
          volume: row.ce.volume,
          iv: row.ce.iv,
          delta: row.ce.delta,
          bid_price: row.ce.bid_price,
          ask_price: row.ce.ask_price,
        },
        pe: {
          instrument_key: row.pe.instrument_key,
          ltp: row.pe.ltp,
          oi: row.pe.oi,
          change_oi: row.pe.change_oi,
          volume: row.pe.volume,
          iv: row.pe.iv,
          delta: row.pe.delta,
          bid_price: row.pe.bid_price,
          ask_price: row.pe.ask_price,
        },
      })),
    };
  }

  getOIData(underlying: string, expiry: string): {
    underlying: string;
    expiry: string;
    spot_price: number;
    data: OIDatum[];
  } {
    const config = UNDERLYING_CONFIG[underlying];
    if (!config) return { underlying, expiry, spot_price: 0, data: [] };

    const spot = this.getSpotPrice(underlying);
    const strikes = this.getStrikes(underlying, 10);

    const data: OIDatum[] = strikes.map((strike) => {
      const oiInfo = this.oiData[underlying]?.[strike] || { ce_oi: 0, ce_change_oi: 0, pe_oi: 0, pe_change_oi: 0 };
      return {
        timestamp: Date.now(),
        strike,
        ce_oi: oiInfo.ce_oi,
        ce_change_oi: oiInfo.ce_change_oi,
        pe_oi: oiInfo.pe_oi,
        pe_change_oi: oiInfo.pe_change_oi,
      };
    });

    return { underlying, expiry, spot_price: Math.round(spot * 100) / 100, data };
  }

  getPCR(underlying: string, expiry: string): {
    underlying: string;
    expiry: string;
    data: PCRPoint[];
    current_pcr: number;
    current_change_pcr: number;
  } {
    const history = this.pcrHistory[underlying] || [];
    const currentPcr = history.length > 0 ? history[history.length - 1].pcr : 1.0;
    const currentChange = history.length > 0 ? history[history.length - 1].change_pcr : 0;

    return {
      underlying,
      expiry,
      data: history,
      current_pcr: Math.round(currentPcr * 1000) / 1000,
      current_change_pcr: Math.round(currentChange * 1000) / 1000,
    };
  }

  get7StrikeMatrix(underlying: string, expiry: string): SevenStrikeMatrix {
    const config = UNDERLYING_CONFIG[underlying];
    if (!config) {
      return { underlying, expiry, spot_price: 0, atm_strike: 0, strike_step: 0, window_strikes: [], rows: [], ce_coi_sum: 0, pe_coi_sum: 0, coi_pcr: 1, state: 'IDLE' };
    }

    const spot = this.getSpotPrice(underlying);
    const step = config.strikeStep;
    const atm = Math.round(spot / step) * step;

    // 7-strike window: ATM ±3
    const windowStrikes: number[] = [];
    for (let i = -3; i <= 3; i++) {
      windowStrikes.push(atm + i * step);
    }

    const rows: SevenStrikeRow[] = windowStrikes.map((strike) => {
      const oiInfo = this.oiData[underlying]?.[strike] || { ce_oi: 0, ce_change_oi: 0, pe_oi: 0, pe_change_oi: 0 };
      return {
        strike,
        ce_coi: oiInfo.ce_change_oi,
        pe_coi: oiInfo.pe_change_oi,
        ce_oi: oiInfo.ce_oi,
        pe_oi: oiInfo.pe_oi,
      };
    });

    const ceCoiSum = rows.reduce((sum, r) => sum + r.ce_coi, 0);
    const peCoiSum = rows.reduce((sum, r) => sum + r.pe_coi, 0);
    const coiPcr = ceCoiSum !== 0 ? peCoiSum / ceCoiSum : 1;

    // State determination
    let state = 'IDLE';
    if (coiPcr > 1.5 || coiPcr < 0.6) {
      state = 'ACTIVE';
    } else if (coiPcr > 1.2 || coiPcr < 0.8) {
      state = 'ZONE_WATCH';
    }

    this.lastState[underlying] = state;
    this.lastPcr[underlying] = coiPcr;

    return {
      underlying,
      expiry,
      spot_price: Math.round(spot * 100) / 100,
      atm_strike: atm,
      strike_step: step,
      window_strikes: windowStrikes,
      rows,
      ce_coi_sum: ceCoiSum,
      pe_coi_sum: peCoiSum,
      coi_pcr: Math.round(coiPcr * 1000) / 1000,
      state,
    };
  }

  get7StrikeSignals(underlying: string, expiry: string): SevenStrikeSignals {
    const matrix = this.get7StrikeMatrix(underlying, expiry);
    const coiPcr = matrix.coi_pcr;
    const state = matrix.state;

    // Generate signals based on COI PCR
    const signals = this.signalHistory[underlying] || [];

    // Determine signal
    let signalType = 'NEUTRAL';
    let confidence = 0;
    let reason = 'No significant COI PCR divergence';
    let gateCondition: string | null = null;
    let volumePercent: number | null = null;

    if (coiPcr > 1.5) {
      signalType = 'LONG';
      confidence = Math.min(0.95, 0.5 + (coiPcr - 1.5) * 0.3 + this.rng() * 0.1);
      reason = `Strong PE COI buildup (PCR: ${coiPcr.toFixed(3)}) suggests bearish resistance, bullish signal`;
      gateCondition = 'LONG';
      volumePercent = 75 + this.rng() * 20;
    } else if (coiPcr > 1.2) {
      signalType = 'LONG';
      confidence = Math.min(0.7, 0.3 + (coiPcr - 1.2) * 0.5 + this.rng() * 0.1);
      reason = `Moderate PE COI dominance (PCR: ${coiPcr.toFixed(3)}), watch for confirmation`;
      gateCondition = 'LONG';
    } else if (coiPcr < 0.6) {
      signalType = 'SHORT';
      confidence = Math.min(0.95, 0.5 + (0.6 - coiPcr) * 0.3 + this.rng() * 0.1);
      reason = `Strong CE COI buildup (PCR: ${coiPcr.toFixed(3)}) suggests bullish resistance, bearish signal`;
      gateCondition = 'SHORT';
      volumePercent = 75 + this.rng() * 20;
    } else if (coiPcr < 0.8) {
      signalType = 'SHORT';
      confidence = Math.min(0.7, 0.3 + (0.8 - coiPcr) * 0.5 + this.rng() * 0.1);
      reason = `Moderate CE COI dominance (PCR: ${coiPcr.toFixed(3)}), watch for confirmation`;
      gateCondition = 'SHORT';
    }

    const currentSignal: Signal = {
      signal_type: signalType,
      confidence: Math.round(confidence * 1000) / 1000,
      reason,
      timestamp: Date.now(),
      spot_price: matrix.spot_price,
      coi_pcr: coiPcr,
      volume_percent: volumePercent,
      gate_condition: gateCondition,
      pain_index: coiPcr > 1 ? matrix.atm_strike + (coiPcr - 1) * 50 : matrix.atm_strike - (1 - coiPcr) * 50,
    };

    // Add to history if different from last
    if (signals.length === 0 || signals[signals.length - 1].signal_type !== signalType) {
      signals.push(currentSignal);
      if (signals.length > 50) signals.shift();
      this.signalHistory[underlying] = signals;
    }

    return {
      underlying,
      expiry,
      signals,
      current_signal: currentSignal,
      gate_condition: gateCondition || 'NONE',
      state,
    };
  }

  searchInstruments(query: string): Instrument[] {
    const q = query.toUpperCase().trim();
    const results: Instrument[] = [];

    // Parse human-readable query like "NIFTY 23900 CE 25 Jun 2026"
    // Extract: underlying, strike, optionType, expiry parts
    const parts = q.split(/\s+/);
    let searchUnderlying = '';
    let searchStrike: number | null = null;
    let searchOptionType = '';
    const monthNames = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

    for (const part of parts) {
      if (part === 'NIFTY' || part === 'NIFTY50') searchUnderlying = 'NIFTY';
      else if (part === 'BANKNIFTY' || part === 'BANK' || part === 'BNF') searchUnderlying = 'BANKNIFTY';
      else if (part === 'CE' || part === 'PE') searchOptionType = part;
      else if (/^\d{3,5}$/.test(part)) searchStrike = parseInt(part);
    }

    // If no underlying detected, try to match from full query
    if (!searchUnderlying) {
      if (q.includes('NIFTY') && !q.includes('BANK')) searchUnderlying = 'NIFTY';
      else if (q.includes('BANKNIFTY') || q.includes('BNF')) searchUnderlying = 'BANKNIFTY';
    }

    // Search across all expiries
    const expiries = nextThursdays(6);

    for (const [symbol, config] of Object.entries(UNDERLYING_CONFIG)) {
      // If specific underlying requested, skip others
      if (searchUnderlying && symbol !== searchUnderlying) continue;
      // If no specific underlying, match by query containing symbol name
      if (!searchUnderlying && !q.includes(symbol) && !config.displayName.toUpperCase().includes(q)) continue;

      // Add index
      results.push({
        instrument_key: `NSE_INDEX|${symbol}`,
        name: config.displayName,
        underlying: symbol,
        type: 'INDEX',
      });

      // Add options for each expiry
      for (const expiryDate of expiries) {
        const expiry = formatExpiryDate(expiryDate);
        const expiryCompact = compactExpiry(expiry);
        const expiryLabel = formatDateLabel(expiryDate);

        // Add futures
        results.push({
          instrument_key: `NSE_FO|${symbol}${expiryCompact}FUT`,
          name: `${symbol} ${expiryLabel} FUT`,
          underlying: symbol,
          type: 'FUT',
          expiry,
        });

        // Options
        const spot = this.getSpotPrice(symbol);
        const step = config.strikeStep;
        const atm = Math.round(spot / step) * step;
        const range = searchStrike ? 3 : 5; // Narrower range if specific strike
        const baseStrike = searchStrike || atm;

        for (let i = -range; i <= range; i++) {
          const strike = baseStrike + i * step;
          if (strike <= 0) continue;
          for (const optType of ['CE', 'PE'] as const) {
            // If specific option type requested, skip others
            if (searchOptionType && optType !== searchOptionType) continue;

            const key = `NSE_FO|${symbol}${expiryCompact}${strike}${optType}`;
            results.push({
              instrument_key: key,
              name: `${symbol} ${strike} ${optType}`,
              underlying: symbol,
              type: optType,
              expiry,
              strike,
              display_name: `${symbol} ${strike} ${optType} ${expiryLabel}`,
            });
          }
        }
      }
    }

    return results.slice(0, 30);
  }

  getExpiries(underlying: string): ExpiryInfo[] {
    const thursdays = nextThursdays(6);
    const now = new Date();
    return thursdays.map((d) => {
      const diffDays = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return {
        expiry_date: formatExpiryDate(d),
        expiry_label: formatDateLabel(d),
        is_weekly: true,
        days_to_expiry: diffDays,
      };
    });
  }

  getReplaySessions(): Array<{
    session_id: string;
    underlying: string;
    start_time: string;
    end_time: string;
    candle_count: number;
  }> {
    return [
      {
        session_id: 'demo-session-1',
        underlying: 'NIFTY',
        start_time: new Date(Date.now() - 3600000).toISOString(),
        end_time: new Date().toISOString(),
        candle_count: 60,
      },
      {
        session_id: 'demo-session-2',
        underlying: 'BANKNIFTY',
        start_time: new Date(Date.now() - 7200000).toISOString(),
        end_time: new Date(Date.now() - 3600000).toISOString(),
        candle_count: 120,
      },
    ];
  }

  startReplay(sessionId: string): {
    session_id: string;
    status: string;
    message: string;
  } {
    return {
      session_id: sessionId,
      status: 'started',
      message: `Replay session ${sessionId} started. Data will be emitted via WebSocket.`,
    };
  }

  getHealth(): {
    status: string;
    uptime: number;
    symbols: string[];
    tick_count: number;
    timestamp: number;
  } {
    return {
      status: 'ok',
      uptime: process.uptime(),
      symbols: Object.keys(UNDERLYING_CONFIG),
      tick_count: this.tickCount,
      timestamp: Date.now(),
    };
  }

  // ============ 7-Strike History Generation ============

  private generate7StrikeHistory(): void {
    const now = Date.now();
    for (const symbol of Object.keys(UNDERLYING_CONFIG)) {
      const config = UNDERLYING_CONFIG[symbol];
      const step = config.strikeStep;
      const baseSpot = this.spotPrices[symbol];

      // Initialize arrays
      this.coiPcrHistory[symbol] = [];
      this.volumeProxyHistory[symbol] = [];
      this.trapClustersData[symbol] = [];
      this.tradeSuggestions[symbol] = [];
      this.lastATMStrike[symbol] = Math.round(baseSpot / step) * step;
      this.stabilizationUntil[symbol] = 0;
      this.lastSignalType[symbol] = 'NEUTRAL';
      this.gateConditionActive[symbol] = null;

      // Use a separate deterministic rng for history generation
      const histRng = mulberry32(symbol === 'NIFTY' ? 9876 : 5432);
      let spot = baseSpot * (1 + (histRng() - 0.5) * 0.005);
      let lastPcr = 0.9 + histRng() * 0.3;
      let lastSignal = 'NEUTRAL';
      let gateActive: { type: 'LONG' | 'SHORT'; since: number } | null = null;
      const prevATM = Math.round(spot / step) * step;

      for (let i = 120; i > 0; i--) {
        const timestamp = now - i * 60_000; // 1-minute intervals

        // Simulate spot movement
        spot += (histRng() - 0.5) * baseSpot * 0.001;
        const currentATM = Math.round(spot / step) * step;

        // Check for ATM shift
        if (currentATM !== prevATM) {
          this.stabilizationUntil[symbol] = timestamp + 120_000; // 2-min stabilization
        }

        // Generate COI PCR values
        const ceCoiBase = Math.floor((histRng() - 0.4) * 400_000);
        const peCoiBase = Math.floor((histRng() - 0.4) * 400_000);
        const ceCoiSum = ceCoiBase + Math.floor(histRng() * 200_000);
        const peCoiSum = peCoiBase + Math.floor(histRng() * 200_000);

        lastPcr += (histRng() - 0.5) * 0.04;
        lastPcr = Math.max(0.3, Math.min(2.5, lastPcr));
        const coiPcr = ceCoiSum !== 0 ? peCoiSum / ceCoiSum : 1;

        // Determine state
        let state = 'IDLE';
        if (coiPcr > 1.5 || coiPcr < 0.6) {
          state = 'ACTIVE';
        } else if (coiPcr > 1.2 || coiPcr < 0.8) {
          state = 'ZONE_WATCH';
        }

        // Determine signal type
        let signalType = 'NEUTRAL';
        let confidence = 0;
        if (coiPcr > 1.5) {
          signalType = 'LONG';
          confidence = Math.min(0.95, 0.5 + (coiPcr - 1.5) * 0.3 + histRng() * 0.1);
        } else if (coiPcr > 1.2) {
          signalType = 'LONG';
          confidence = Math.min(0.7, 0.3 + (coiPcr - 1.2) * 0.5 + histRng() * 0.1);
        } else if (coiPcr < 0.6) {
          signalType = 'SHORT';
          confidence = Math.min(0.95, 0.5 + (0.6 - coiPcr) * 0.3 + histRng() * 0.1);
        } else if (coiPcr < 0.8) {
          signalType = 'SHORT';
          confidence = Math.min(0.7, 0.3 + (0.8 - coiPcr) * 0.5 + histRng() * 0.1);
        }

        // Track gate condition
        if (signalType === 'LONG' || signalType === 'SHORT') {
          if (!gateActive || gateActive.type !== signalType) {
            gateActive = { type: signalType as 'LONG' | 'SHORT', since: timestamp };
          }
        } else {
          gateActive = null;
        }

        // Add COI PCR point
        this.coiPcrHistory[symbol].push({
          timestamp,
          coi_pcr: Math.round(coiPcr * 1000) / 1000,
          spot: Math.round(spot * 100) / 100,
          ce_coi_sum: ceCoiSum,
          pe_coi_sum: peCoiSum,
          state,
          signal_type: signalType,
          confidence: Math.round(confidence * 1000) / 1000,
        });

        // Generate volume proxy
        let volumePercent = 0.5 + histRng() * 3;
        // Occasional spikes
        if (histRng() < 0.05) {
          volumePercent = 5 + histRng() * 3; // spike
        }
        const classification: VolumeProxyPoint['classification'] =
          volumePercent >= 5 ? 'EXTREME' :
          volumePercent >= 3 ? 'HIGH' :
          volumePercent >= 1.5 ? 'ELEVATED' : 'NORMAL';

        this.volumeProxyHistory[symbol].push({
          timestamp,
          volume_percent: Math.round(volumePercent * 100) / 100,
          classification,
          spot: Math.round(spot * 100) / 100,
        });

        // Check for trap clusters when volume is HIGH or EXTREME
        if (volumePercent >= 3.0) {
          const direction: TrapCluster['direction'] = signalType === 'LONG' ? 'BEARISH_TRAP' : signalType === 'SHORT' ? 'BULLISH_TRAP' : (histRng() > 0.5 ? 'BULLISH_TRAP' : 'BEARISH_TRAP');
          const painIndex = direction === 'BULLISH_TRAP'
            ? currentATM + Math.floor(histRng() * 4) * step
            : currentATM - Math.floor(histRng() * 4) * step;

          this.trapClustersData[symbol].push({
            id: `trap_${symbol}_${timestamp}`,
            price_high: currentATM + step,
            price_low: currentATM - step,
            timestamp_start: timestamp,
            volume_trapped: Math.floor(volumePercent * 100_000),
            direction,
            pain_index: painIndex,
            active: i <= 5, // Only last 5 are still active
            triggered: i > 5, // Older ones are triggered
          });
        }

        // Generate trade suggestions for significant signals
        if ((signalType === 'LONG' || signalType === 'SHORT') && confidence > 0.6 && i % 15 === 0) {
          const lotSize = symbol === 'BANKNIFTY' ? 15 : 25;
          const entryStrike = currentATM;

          // Option buying: SL below entry, target above entry
          const slPct = confidence > 0.8 ? 0.30 : 0.40;
          const targetPct = confidence > 0.8 ? 1.50 : 1.00;

          let entry_price: number, stop_loss: number, target: number, option_suggestion: string;

          if (signalType === 'LONG') {
            const T = 7 / 365;
            const iv = config.volatility;
            const ceGreeks = this.bsPrice(spot, entryStrike, T, iv, 'CE');
            entry_price = Math.round(ceGreeks.price * 100) / 100;
            stop_loss = Math.max(0.05, Math.round(entry_price * (1 - slPct) * 100) / 100);
            target = Math.round(entry_price * (1 + targetPct) * 100) / 100;
            option_suggestion = `BUY ${symbol} ${entryStrike} CE (Lot: ${lotSize})`;
          } else {
            const T = 7 / 365;
            const iv = config.volatility;
            const peGreeks = this.bsPrice(spot, entryStrike, T, iv, 'PE');
            entry_price = Math.round(peGreeks.price * 100) / 100;
            stop_loss = Math.max(0.05, Math.round(entry_price * (1 - slPct) * 100) / 100);
            target = Math.round(entry_price * (1 + targetPct) * 100) / 100;
            option_suggestion = `BUY ${symbol} ${entryStrike} PE (Lot: ${lotSize})`;
          }

          const risk = entry_price - stop_loss;
          const reward = target - entry_price;
          const rrRatio = risk > 0 ? (reward / risk).toFixed(1) : '0.0';

          this.tradeSuggestions[symbol].push({
            id: `trade_${symbol}_${timestamp}`,
            signal_type: signalType as 'LONG' | 'SHORT',
            entry_price,
            stop_loss,
            target,
            risk_reward: `1:${rrRatio}`,
            confidence: Math.round(confidence * 1000) / 1000,
            reason: signalType === 'LONG'
              ? `Strong PE COI buildup (PCR: ${coiPcr.toFixed(3)}) — bullish signal`
              : `Strong CE COI buildup (PCR: ${coiPcr.toFixed(3)}) — bearish signal`,
            timestamp,
            spot_price: Math.round(spot * 100) / 100,
            coi_pcr: Math.round(coiPcr * 1000) / 1000,
            status: i > 10 ? 'HIT_TARGET' : 'ACTIVE',
            option_suggestion,
            exit_reason: i > 10 ? 'Target achieved' : null,
          });
        }

        lastSignal = signalType;
      }

      this.lastATMStrike[symbol] = prevATM;
      this.lastSignalType[symbol] = lastSignal;
      this.gateConditionActive[symbol] = gateActive;
    }
  }

  // ============ 7-Strike COI PCR History Update ============

  updateCOIPCRHistory(underlying: string): void {
    const config = UNDERLYING_CONFIG[underlying];
    if (!config) return;

    const matrix = this.get7StrikeMatrix(underlying, '');
    const spot = matrix.spot_price;
    const step = matrix.strike_step;
    const currentATM = matrix.atm_strike;

    // Check for ATM shift — add stabilization
    const prevATM = this.lastATMStrike[underlying] || currentATM;
    if (currentATM !== prevATM) {
      this.stabilizationUntil[underlying] = Date.now() + 120_000; // 2-min stabilization
      this.lastATMStrike[underlying] = currentATM;
    }

    // Determine signal from current matrix
    const coiPcr = matrix.coi_pcr;
    let signalType = 'NEUTRAL';
    let confidence = 0;
    if (coiPcr > 1.5) {
      signalType = 'LONG';
      confidence = Math.min(0.95, 0.5 + (coiPcr - 1.5) * 0.3 + this.rng() * 0.1);
    } else if (coiPcr > 1.2) {
      signalType = 'LONG';
      confidence = Math.min(0.7, 0.3 + (coiPcr - 1.2) * 0.5 + this.rng() * 0.1);
    } else if (coiPcr < 0.6) {
      signalType = 'SHORT';
      confidence = Math.min(0.95, 0.5 + (0.6 - coiPcr) * 0.3 + this.rng() * 0.1);
    } else if (coiPcr < 0.8) {
      signalType = 'SHORT';
      confidence = Math.min(0.7, 0.3 + (0.8 - coiPcr) * 0.5 + this.rng() * 0.1);
    }

    // Update gate condition tracking
    if (signalType === 'LONG' || signalType === 'SHORT') {
      if (!this.gateConditionActive[underlying] || this.gateConditionActive[underlying]?.type !== signalType) {
        this.gateConditionActive[underlying] = { type: signalType as 'LONG' | 'SHORT', since: Date.now() };
      }
    } else {
      this.gateConditionActive[underlying] = null;
    }

    const point: COIPCRPoint = {
      timestamp: Date.now(),
      coi_pcr: coiPcr,
      spot,
      ce_coi_sum: matrix.ce_coi_sum,
      pe_coi_sum: matrix.pe_coi_sum,
      state: matrix.state,
      signal_type: signalType,
      confidence: Math.round(confidence * 1000) / 1000,
    };

    if (!this.coiPcrHistory[underlying]) this.coiPcrHistory[underlying] = [];
    this.coiPcrHistory[underlying].push(point);

    // Keep max 300 points
    if (this.coiPcrHistory[underlying].length > 300) {
      this.coiPcrHistory[underlying].shift();
    }

    this.lastSignalType[underlying] = signalType;
  }

  // ============ Volume Proxy Update ============

  updateVolumeProxy(underlying: string): void {
    const config = UNDERLYING_CONFIG[underlying];
    if (!config) return;

    const spot = this.getSpotPrice(underlying);
    const step = config.strikeStep;
    const atm = Math.round(spot / step) * step;

    // Simulate volume_percent
    let volumePercent = 0.5 + this.rng() * 3;
    // Occasional spikes (5% chance)
    if (this.rng() < 0.05) {
      volumePercent = 5 + this.rng() * 3;
    }

    const classification: VolumeProxyPoint['classification'] =
      volumePercent >= 5 ? 'EXTREME' :
      volumePercent >= 3 ? 'HIGH' :
      volumePercent >= 1.5 ? 'ELEVATED' : 'NORMAL';

    const point: VolumeProxyPoint = {
      timestamp: Date.now(),
      volume_percent: Math.round(volumePercent * 100) / 100,
      classification,
      spot: Math.round(spot * 100) / 100,
    };

    if (!this.volumeProxyHistory[underlying]) this.volumeProxyHistory[underlying] = [];
    this.volumeProxyHistory[underlying].push(point);

    // Keep max 300 points
    if (this.volumeProxyHistory[underlying].length > 300) {
      this.volumeProxyHistory[underlying].shift();
    }

    // Check for trap clusters when volume is HIGH or EXTREME
    if (volumePercent >= 3.0) {
      const lastSignal = this.lastSignalType[underlying] || 'NEUTRAL';
      const direction: TrapCluster['direction'] =
        lastSignal === 'LONG' ? 'BEARISH_TRAP' :
        lastSignal === 'SHORT' ? 'BULLISH_TRAP' :
        (this.rng() > 0.5 ? 'BULLISH_TRAP' : 'BEARISH_TRAP');

      const painIndex = direction === 'BULLISH_TRAP'
        ? atm + Math.floor(this.rng() * 4) * step
        : atm - Math.floor(this.rng() * 4) * step;

      const cluster: TrapCluster = {
        id: `trap_${underlying}_${Date.now()}`,
        price_high: atm + step,
        price_low: atm - step,
        timestamp_start: Date.now(),
        volume_trapped: Math.floor(volumePercent * 100_000),
        direction,
        pain_index: painIndex,
        active: true,
        triggered: false,
      };

      if (!this.trapClustersData[underlying]) this.trapClustersData[underlying] = [];
      this.trapClustersData[underlying].push(cluster);

      // Mark older clusters as triggered/inactive
      const clusters = this.trapClustersData[underlying];
      for (let i = 0; i < clusters.length - 1; i++) {
        if (Date.now() - clusters[i].timestamp_start > 600_000) { // 10 minutes
          clusters[i].active = false;
          clusters[i].triggered = true;
        }
      }

      // Keep max 50 clusters
      if (clusters.length > 50) {
        clusters.shift();
      }
    }
  }

  // ============ 7-Strike History Public API ============

  get7StrikeHistory(underlying: string, expiry: string): SevenStrikeHistory {
    // Generate fresh current data point and add to history
    this.updateCOIPCRHistory(underlying);
    this.updateVolumeProxy(underlying);

    return {
      underlying,
      expiry,
      coi_pcr_series: this.coiPcrHistory[underlying] || [],
      volume_proxy_series: this.volumeProxyHistory[underlying] || [],
      trap_clusters: (this.trapClustersData[underlying] || []).filter(c => c.active),
      signals: this.signalHistory[underlying] || [],
      trade_suggestions: this.tradeSuggestions[underlying] || [],
    };
  }

  // ============ 7-Strike Trade Suggestions ============

  get7StrikeTradeSuggestions(underlying: string, expiry: string): TradeSuggestion[] {
    const signals = this.get7StrikeSignals(underlying, expiry);
    const currentSignal = signals.current_signal;

    if (!currentSignal || currentSignal.confidence <= 0.6) {
      return this.tradeSuggestions[underlying] || [];
    }

    const config = UNDERLYING_CONFIG[underlying];
    if (!config) return this.tradeSuggestions[underlying] || [];

    const lotSize = underlying === 'BANKNIFTY' ? 15 : 25;
    const step = config.strikeStep;
    const spot = this.getSpotPrice(underlying);
    const atm = Math.round(spot / step) * step;
    const T = this.timeToExpiry(expiry || formatExpiryDate(nextThursdays(1)[0]));
    const iv = config.volatility;

    // Only generate new suggestion if signal type changed or last is old
    const existingSuggestions = this.tradeSuggestions[underlying] || [];
    const lastSuggestion = existingSuggestions.length > 0 ? existingSuggestions[existingSuggestions.length - 1] : null;
    const now = Date.now();

    if (lastSuggestion && lastSuggestion.signal_type === currentSignal.signal_type && now - lastSuggestion.timestamp < 60_000) {
      // Return existing suggestions — don't spam
      return existingSuggestions;
    }

    const signalType = currentSignal.signal_type as 'LONG' | 'SHORT';

    // Option buying: SL below entry, target above entry
    // Higher confidence → tighter SL, larger target
    const slPct = currentSignal.confidence > 0.8 ? 0.30 : 0.40; // 30-40% risk
    const targetPct = currentSignal.confidence > 0.8 ? 1.50 : 1.00; // 100-150% reward

    let entry_price: number, stop_loss: number, target: number, option_suggestion: string;

    if (signalType === 'LONG') {
      const ceGreeks = this.bsPrice(spot, atm, T, iv, 'CE');
      entry_price = Math.round(ceGreeks.price * 100) / 100;
      stop_loss = Math.max(0.05, Math.round(entry_price * (1 - slPct) * 100) / 100);
      target = Math.round(entry_price * (1 + targetPct) * 100) / 100;
      option_suggestion = `BUY ${underlying} ${atm} CE (Lot: ${lotSize}, Premium: ₹${entry_price})`;
    } else {
      const peGreeks = this.bsPrice(spot, atm, T, iv, 'PE');
      entry_price = Math.round(peGreeks.price * 100) / 100;
      stop_loss = Math.max(0.05, Math.round(entry_price * (1 - slPct) * 100) / 100);
      target = Math.round(entry_price * (1 + targetPct) * 100) / 100;
      option_suggestion = `BUY ${underlying} ${atm} PE (Lot: ${lotSize}, Premium: ₹${entry_price})`;
    }

    const risk = entry_price - stop_loss;
    const reward = target - entry_price;
    const rrRatio = risk > 0 ? (reward / risk).toFixed(1) : '0.0';

    const suggestion: TradeSuggestion = {
      id: `trade_${underlying}_${now}`,
      signal_type: signalType,
      entry_price,
      stop_loss,
      target,
      risk_reward: `1:${rrRatio}`,
      confidence: currentSignal.confidence,
      reason: currentSignal.reason,
      timestamp: now,
      spot_price: Math.round(spot * 100) / 100,
      coi_pcr: currentSignal.coi_pcr,
      status: 'ACTIVE',
      option_suggestion,
      exit_reason: null,
    };

    if (!this.tradeSuggestions[underlying]) this.tradeSuggestions[underlying] = [];
    this.tradeSuggestions[underlying].push(suggestion);

    // Keep max 50 suggestions
    if (this.tradeSuggestions[underlying].length > 50) {
      this.tradeSuggestions[underlying].shift();
    }

    return this.tradeSuggestions[underlying];
  }

  private timeToExpiry(expiry: string): number {
    try {
      const expiryDate = new Date(expiry + 'T15:30:00+05:30');
      const now = new Date();
      const diffMs = expiryDate.getTime() - now.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      return Math.max(diffDays / 365, 0.001); // in years, min 1 day
    } catch {
      return 7 / 365; // default ~1 week
    }
  }
}

// ============ Singleton Export ============

let instance: MarketSimulator | null = null;

export function getSimulator(): MarketSimulator {
  if (!instance) {
    instance = new MarketSimulator();
  }
  return instance;
}
