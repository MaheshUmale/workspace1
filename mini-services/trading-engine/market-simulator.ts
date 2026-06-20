/**
 * Realistic market data simulator for Indian index options.
 * Generates simulated NIFTY/BANKNIFTY spot prices, option chains,
 * OI data, and candlestick data for demo mode.
 *
 * Ported from the Python data_simulator.py to TypeScript.
 * Uses in-memory data structures only — no DuckDB.
 */

import type {
  UnderlyingConfig,
  Instrument,
  ExpiryInfo,
  Candle,
  OptionStrike,
  OptionChainRow,
  OptionChainResponse,
  OIDataPoint,
  OIDataResponse,
  PCRDataPoint,
  PCRResponse,
  SevenStrikeRow,
  SevenStrikeMatrix,
  Signal,
  SevenStrikeSignalsResponse,
  SpotTick,
  OptionTick,
  OIStateEntry,
  CandleState,
} from './types';

import { UNDERLYINGS, SEVEN_STRIKE_WINDOW, STABILIZATION_MINUTES } from './types';

// ============ Helper Functions ============

/** Standard normal CDF approximation (Abramowitz & Stegun) */
function normalCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);
  return 0.5 * (1.0 + sign * y);
}

/** Calculate ATM strike from spot price */
function atmStrike(spot: number, step: number): number {
  return Math.round(spot / step) * step;
}

/** Black-Scholes option price */
function bsPrice(spot: number, strike: number, tte: number, iv: number, optionType: string): number {
  if (tte <= 0 || iv <= 0) {
    const intrinsic = optionType === 'CE' ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
    return intrinsic;
  }
  const d1 = (Math.log(spot / strike) + (0.05 + 0.5 * iv * iv) * tte) / (iv * Math.sqrt(tte));
  const d2 = d1 - iv * Math.sqrt(tte);

  let price: number;
  if (optionType === 'CE') {
    price = spot * normalCdf(d1) - strike * Math.exp(-0.05 * tte) * normalCdf(d2);
  } else {
    price = strike * Math.exp(-0.05 * tte) * normalCdf(-d2) - spot * normalCdf(-d1);
  }
  return Math.max(0.05, Math.round(price * 100) / 100);
}

/** Black-Scholes Greeks */
function bsGreeks(spot: number, strike: number, tte: number, iv: number, optionType: string): {
  delta: number; gamma: number; theta: number; vega: number;
} {
  if (tte <= 0 || iv <= 0) {
    tte = 1.0 / 365.0;
    iv = 0.15;
  }

  const d1 = (Math.log(spot / strike) + (0.05 + 0.5 * iv * iv) * tte) / (iv * Math.sqrt(tte));
  const d2 = d1 - iv * Math.sqrt(tte);

  // Delta
  const delta = optionType === 'CE' ? normalCdf(d1) : normalCdf(d1) - 1.0;

  // Gamma
  const gamma = Math.exp(-0.5 * d1 * d1) / (spot * iv * Math.sqrt(tte) * Math.sqrt(2 * Math.PI));

  // Theta (per day)
  const thetaTerm1 = -(spot * iv * Math.exp(-0.5 * d1 * d1)) / (2 * Math.sqrt(2 * Math.PI * tte));
  let theta: number;
  if (optionType === 'CE') {
    theta = (thetaTerm1 - 0.05 * strike * Math.exp(-0.05 * tte) * normalCdf(d2)) / 365.0;
  } else {
    theta = (thetaTerm1 + 0.05 * strike * Math.exp(-0.05 * tte) * normalCdf(-d2)) / 365.0;
  }

  // Vega (per 1% change in vol)
  const vega = (spot * Math.sqrt(tte) * Math.exp(-0.5 * d1 * d1)) / Math.sqrt(2 * Math.PI) / 100.0;

  return {
    delta: Math.round(delta * 10000) / 10000,
    gamma: Math.round(gamma * 10000) / 10000,
    theta: Math.round(theta * 100) / 100,
    vega: Math.round(vega * 100) / 100,
  };
}

/** Get next Thursday from a given date (for weekly expiry) */
function nextThursday(fromDate?: Date): Date {
  const d = fromDate ? new Date(fromDate) : new Date();
  // In JS: Thursday = day 4 (0=Sun, 1=Mon, ..., 4=Thu)
  let daysUntilThursday = (4 - d.getDay() + 7) % 7;
  if (daysUntilThursday === 0 && d.getHours() >= 16) {
    daysUntilThursday = 7;
  }
  if (daysUntilThursday === 0) {
    daysUntilThursday = 7; // Always use future Thursday
  }
  const expiry = new Date(d);
  expiry.setDate(expiry.getDate() + daysUntilThursday);
  expiry.setHours(0, 0, 0, 0);
  return expiry;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Format expiry date: '26 Jun 2026' */
function formatExpiryLabel(dt: Date): string {
  return `${String(dt.getDate()).padStart(2, '0')} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}

/** Get upcoming weekly expiry dates */
function getExpiryDates(count: number = 5): Date[] {
  const expiries: Date[] = [];
  const base = new Date();
  for (let i = 0; i < count; i++) {
    const ref = new Date(base);
    ref.setDate(ref.getDate() + 7 * i);
    const expiry = nextThursday(ref);
    expiries.push(expiry);
  }
  return expiries;
}

/** Random integer in range [min, max] */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Random float from Gaussian distribution (Box-Muller) */
function gaussRandom(mean: number = 0, stdDev: number = 1): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z0 * stdDev + mean;
}

/** Time to expiry in years from an expiry date string */
function timeToExpiry(expiry: string): number {
  const expiryDt = new Date(expiry + 'T23:59:59Z');
  const now = new Date();
  const diffSeconds = (expiryDt.getTime() - now.getTime()) / 1000;
  return Math.max(diffSeconds / (365.25 * 24 * 3600), 1.0 / 365.0);
}

// ============ MarketDataSimulator Class ============

export class MarketDataSimulator {
  // Spot prices for each underlying
  private spot: Record<string, number> = {};
  private prevSpot: Record<string, number> = {};
  private openSpot: Record<string, number> = {};
  private highSpot: Record<string, number> = {};
  private lowSpot: Record<string, number> = {};
  private volumeCount: Record<string, number> = {};

  // Tick counter per underlying
  private tickCount: Record<string, number> = {};
  private globalTickCount: number = 0;

  // OI tracking: instrument_key -> { openOi, currentOi }
  private oiState: Record<string, OIStateEntry> = {};

  // Candle state: instrument_key+timeframe -> CandleState
  private candleState: Record<string, CandleState> = {};

  // Expiry dates (shared across underlyings)
  private expiryDates: Date[] = [];

  // 7-Strike state tracking
  private sevenStrikeState: Record<string, {
    currentAtm: number | null;
    prevAtm: number | null;
    lastShiftTime: number | null;
    stabilizationEndTime: number | null;
    state: string;
  }> = {};

  constructor() {
    // Initialize spot prices
    for (const [symbol, config] of Object.entries(UNDERLYINGS)) {
      this.spot[symbol] = config.basePrice + (Math.random() - 0.5) * 200;
      this.prevSpot[symbol] = this.spot[symbol];
      this.openSpot[symbol] = this.spot[symbol];
      this.highSpot[symbol] = this.spot[symbol];
      this.lowSpot[symbol] = this.spot[symbol];
      this.volumeCount[symbol] = 0;
      this.tickCount[symbol] = 0;

      this.sevenStrikeState[symbol] = {
        currentAtm: null,
        prevAtm: null,
        lastShiftTime: null,
        stabilizationEndTime: null,
        state: 'STABLE',
      };
    }

    this.expiryDates = getExpiryDates(5);
    console.log('[Simulator] Initialized with realistic market data');
  }

  // ---------- Public API ----------

  getSpot(underlying: string): number {
    return this.spot[underlying] ?? UNDERLYINGS.NIFTY.basePrice;
  }

  getPrevSpot(underlying: string): number {
    return this.prevSpot[underlying] ?? this.getSpot(underlying);
  }

  getOpenSpot(underlying: string): number {
    return this.openSpot[underlying] ?? this.getSpot(underlying);
  }

  getAtmStrike(underlying: string): number {
    const config = UNDERLYINGS[underlying] ?? UNDERLYINGS.NIFTY;
    return atmStrike(this.getSpot(underlying), config.strikeStep);
  }

  getGlobalTickCount(): number {
    return this.globalTickCount;
  }

  getExpiries(underlying: string): ExpiryInfo[] {
    const now = new Date();
    return this.expiryDates.map(d => {
      const dte = Math.max(0, Math.ceil((d.getTime() - now.getTime()) / (24 * 3600 * 1000)));
      return {
        underlying,
        expiry_date: d.toISOString().split('T')[0],
        expiry_label: formatExpiryLabel(d),
        is_weekly: true,
        days_to_expiry: dte,
      };
    });
  }

  getInstruments(underlying: string, expiry: string): Instrument[] {
    const config = UNDERLYINGS[underlying] ?? UNDERLYINGS.NIFTY;
    const spot = this.getSpot(underlying);
    const atm = atmStrike(spot, config.strikeStep);
    const step = config.strikeStep;

    const instruments: Instrument[] = [];
    for (let i = -config.atmStrikesRange; i <= config.atmStrikesRange; i++) {
      const strike = atm + i * step;
      for (const optType of ['CE', 'PE'] as const) {
        instruments.push({
          instrument_key: this.makeInstrumentKey(underlying, expiry, strike, optType),
          trading_symbol: this.makeTradingSymbol(underlying, expiry, strike, optType),
          name: `${underlying} ${strike} ${optType}`,
          expiry,
          strike,
          option_type: optType,
          lot_size: config.lotSize,
          underlying,
          exchange: 'NSE_FO',
          tick_size: 0.05,
        });
      }
    }
    return instruments;
  }

  searchInstruments(query: string): Instrument[] {
    const queryUpper = query.toUpperCase().trim();
    const results: Instrument[] = [];

    for (const symbol of Object.keys(UNDERLYINGS)) {
      const expiries = this.getExpiries(symbol);
      if (expiries.length === 0) continue;
      const expiry = expiries[0].expiry_date;
      const instruments = this.getInstruments(symbol, expiry);

      for (const inst of instruments) {
        const searchable = `${inst.name} ${inst.trading_symbol} ${inst.instrument_key}`.toUpperCase();
        if (searchable.includes(queryUpper)) {
          results.push(inst);
        }
      }
    }
    return results;
  }

  // ---------- Tick Generation ----------

  generateTick(underlying: string): SpotTick {
    const config = UNDERLYINGS[underlying] ?? UNDERLYINGS.NIFTY;
    this.tickCount[underlying] = (this.tickCount[underlying] ?? 0) + 1;
    this.globalTickCount++;

    // Save previous spot
    this.prevSpot[underlying] = this.spot[underlying];

    // Volatility with intraday patterns
    const vol = config.volatilityDaily / Math.sqrt(375 * 60); // ~375 min * 60 sec

    // Mean reversion to base price
    const base = config.basePrice;
    const current = this.spot[underlying];
    const meanReversion = (base - current) * 0.0001;

    // Momentum (trend continuation)
    const momentum = (current - this.prevSpot[underlying]) * 0.05;

    // Random noise
    let noise = gaussRandom(0, vol * current);

    // Occasional larger moves (simulates institutional activity)
    if (Math.random() < 0.02) {
      noise += gaussRandom(0, vol * current * 5);
    }

    let newSpot = current + meanReversion + momentum + noise;
    newSpot = Math.round(newSpot * 100) / 100;
    this.spot[underlying] = newSpot;

    // Track high/low/volume
    if (newSpot > this.highSpot[underlying]) this.highSpot[underlying] = newSpot;
    if (newSpot < this.lowSpot[underlying]) this.lowSpot[underlying] = newSpot;
    this.volumeCount[underlying] = (this.volumeCount[underlying] ?? 0) + randInt(100, 5000);

    const spot = this.spot[underlying];
    const openPrice = this.openSpot[underlying];
    const change = Math.round((spot - openPrice) * 100) / 100;
    const changePct = openPrice !== 0 ? Math.round((change / openPrice) * 10000) / 100 : 0.0;

    // Update candle state for spot
    this.updateSpotCandle(underlying);

    return {
      symbol: underlying,
      ltp: spot,
      change,
      change_pct: changePct,
      open: openPrice,
      high: this.highSpot[underlying],
      low: this.lowSpot[underlying],
      close: spot, // current LTP = close
      volume: this.volumeCount[underlying],
      timestamp: Date.now(),
    };
  }

  // ---------- Option Chain ----------

  generateOptionChain(underlying: string, expiry: string, range?: number): OptionChainResponse {
    const config = UNDERLYINGS[underlying] ?? UNDERLYINGS.NIFTY;
    const spot = this.getSpot(underlying);
    const atm = atmStrike(spot, config.strikeStep);
    const step = config.strikeStep;
    const tte = timeToExpiry(expiry);
    const strikeRange = range ?? config.atmStrikesRange;

    const chain: OptionChainRow[] = [];

    for (let i = -strikeRange; i <= strikeRange; i++) {
      const strike = atm + i * step;
      const row: OptionChainRow = { strike, ce: null, pe: null };

      for (const optType of ['CE', 'PE'] as const) {
        const key = this.makeInstrumentKey(underlying, expiry, strike, optType);

        // IV with volatility smile
        const moneyness = Math.abs(spot - strike) / spot;
        const baseIv = 0.13;
        const iv = baseIv + moneyness * 0.8 + (Math.random() - 0.5) * 0.01;

        // Premium using BS
        let ltp = bsPrice(spot, strike, tte, iv, optType);
        ltp = Math.max(0.05, Math.round((ltp + gaussRandom(0, ltp * 0.01)) * 100) / 100);

        // Greeks
        const greeks = bsGreeks(spot, strike, tte, iv, optType);

        // OI and Change OI
        const { oi, changeOi } = this.simulateOi(underlying, key, strike, atm, optType, step);

        // Volume
        const distFromAtm = Math.abs(strike - atm);
        const baseVolume = Math.max(100, Math.floor(50000 * Math.exp(-distFromAtm / (step * 3))));
        const volume = Math.max(0, baseVolume + randInt(-Math.floor(baseVolume / 5), Math.floor(baseVolume / 5)));

        // Bid/Ask spread
        const spread = Math.max(0.05, Math.round(ltp * 0.005 * 100) / 100);
        const bidPrice = Math.round(Math.max(0.05, ltp - spread / 2) * 100) / 100;
        const askPrice = Math.round((ltp + spread / 2) * 100) / 100;

        const strikeData: OptionStrike = {
          strike,
          option_type: optType,
          instrument_key: key,
          trading_symbol: this.makeTradingSymbol(underlying, expiry, strike, optType),
          ltp,
          volume,
          oi,
          change_oi: changeOi,
          iv: Math.round(iv * 10000) / 10000,
          delta: greeks.delta,
          gamma: greeks.gamma,
          theta: greeks.theta,
          vega: greeks.vega,
          bid_price: bidPrice,
          ask_price: askPrice,
          bid_qty: randInt(10, 500),
          ask_qty: randInt(10, 500),
        };

        if (optType === 'CE') {
          row.ce = strikeData;
        } else {
          row.pe = strikeData;
        }
      }
      chain.push(row);
    }

    return {
      underlying,
      expiry,
      spot_price: spot,
      atm_strike: atm,
      strike_step: step,
      chain,
    };
  }

  generateMiniOptionChain(underlying: string, expiry: string): OptionChainResponse {
    return this.generateOptionChain(underlying, expiry, 5);
  }

  generateOptionTick(underlying: string, expiry: string, strike: number, optType: string): OptionTick {
    const config = UNDERLYINGS[underlying] ?? UNDERLYINGS.NIFTY;
    const spot = this.getSpot(underlying);
    const key = this.makeInstrumentKey(underlying, expiry, strike, optType);
    const tte = timeToExpiry(expiry);

    const moneyness = spot > 0 ? Math.abs(spot - strike) / spot : 0;
    const iv = 0.13 + moneyness * 0.8 + (Math.random() - 0.5) * 0.01;
    let ltp = bsPrice(spot, strike, tte, iv, optType);
    ltp = Math.max(0.05, Math.round((ltp + gaussRandom(0, ltp * 0.01)) * 100) / 100);

    const currentAtm = atmStrike(spot, config.strikeStep);
    const { oi, changeOi } = this.simulateOi(underlying, key, strike, currentAtm, optType, config.strikeStep);

    const distFromAtm = Math.abs(strike - currentAtm);
    const baseVolume = Math.max(100, Math.floor(50000 * Math.exp(-distFromAtm / (config.strikeStep * 3))));
    const volume = Math.max(0, baseVolume + randInt(-Math.floor(baseVolume / 5), Math.floor(baseVolume / 5)));

    const spread = Math.max(0.05, Math.round(ltp * 0.005 * 100) / 100);

    return {
      instrument_key: key,
      strike,
      option_type: optType,
      ltp,
      volume,
      oi,
      change_oi: changeOi,
      bid_price: Math.round(Math.max(0.05, ltp - spread / 2) * 100) / 100,
      ask_price: Math.round((ltp + spread / 2) * 100) / 100,
      timestamp: Date.now(),
    };
  }

  // ---------- OI Data ----------

  generateOiData(instrumentKey: string, count: number = 100): OIDataResponse {
    const nowMs = Date.now();
    const data: OIDataPoint[] = [];

    let baseOi = randInt(50000, 500000);
    let currentOi = baseOi;

    for (let i = 0; i < count; i++) {
      const ts = nowMs - (count - i) * 60000;

      let oiChange = randInt(-5000, 8000);
      // Bias towards buildup in morning
      const hour = new Date(ts).getHours();
      if (hour >= 9 && hour <= 11) {
        oiChange = Math.floor(oiChange * 1.5);
      }

      currentOi = Math.max(1000, currentOi + oiChange);
      const changeOi = currentOi - baseOi;

      data.push({ timestamp: ts, oi: currentOi, change_oi: changeOi });
    }

    return { instrument_key: instrumentKey, data };
  }

  // ---------- PCR Data ----------

  generatePcrData(underlying: string, expiry: string, count: number = 100): PCRResponse {
    const config = UNDERLYINGS[underlying] ?? UNDERLYINGS.NIFTY;
    const spot = this.getSpot(underlying);
    const nowMs = Date.now();

    const data: PCRDataPoint[] = [];
    let currentSpot = this.openSpot[underlying] ?? spot;
    let prevPcr = 0.8 + Math.random() * 0.7;

    for (let i = 0; i < count; i++) {
      const ts = nowMs - (count - i) * 60000;

      currentSpot += gaussRandom(0, config.volatilityDaily * currentSpot / Math.sqrt(375));

      let pcr = prevPcr + gaussRandom(0, 0.02);
      pcr = Math.max(0.3, Math.min(3.0, pcr));
      const changePcr = Math.round((pcr - prevPcr) * 10000) / 10000;

      data.push({
        timestamp: ts,
        spot: Math.round(currentSpot * 100) / 100,
        pcr: Math.round(pcr * 10000) / 10000,
        change_pcr: changePcr,
      });
      prevPcr = pcr;
    }

    const currentPcr = data.length > 0 ? data[data.length - 1].pcr : 1.0;
    const currentChangePcr = data.length > 0 ? data[data.length - 1].change_pcr : 0.0;

    return {
      underlying,
      expiry,
      data,
      current_pcr: currentPcr,
      current_change_pcr: currentChangePcr,
    };
  }

  // ---------- Candlestick Data ----------

  generateCandles(instrumentKey: string, timeframe: string, count: number = 200): Candle[] {
    const tfSeconds: Record<string, number> = {
      '1m': 60, '3m': 180, '5m': 300, '15m': 900, '1h': 3600,
    };
    const tfSec = tfSeconds[timeframe] ?? 60;
    const nowSec = Math.floor(Date.now() / 1000);

    const basePrice = this.priceFromInstrumentKey(instrumentKey);
    let currentPrice = basePrice;

    const volPerCandle = 0.001 * Math.sqrt(tfSec / 60);
    const candles: Candle[] = [];

    for (let i = 0; i < count; i++) {
      const ts = nowSec - (count - i) * tfSec;

      const openPrice = currentPrice;
      const change = gaussRandom(0, volPerCandle * currentPrice);
      const closePrice = Math.round((openPrice + change) * 100) / 100;

      const high = Math.round(
        (Math.max(openPrice, closePrice) + Math.abs(gaussRandom(0, volPerCandle * currentPrice * 0.5))) * 100
      ) / 100;
      const low = Math.round(
        (Math.min(openPrice, closePrice) - Math.abs(gaussRandom(0, volPerCandle * currentPrice * 0.5))) * 100
      ) / 100;

      const volume = randInt(100, 50000);

      candles.push({
        time: ts,
        open: Math.round(openPrice * 100) / 100,
        high,
        low: Math.max(0.05, low),
        close: closePrice,
        volume,
      });

      currentPrice = closePrice;
    }

    return candles;
  }

  // ---------- 7-Strike System ----------

  get7StrikeMatrix(underlying: string, expiry: string): SevenStrikeMatrix {
    const config = UNDERLYINGS[underlying] ?? UNDERLYINGS.NIFTY;
    const spot = this.getSpot(underlying);
    const atm = atmStrike(spot, config.strikeStep);
    const step = config.strikeStep;

    // 7-strike window: ATM-3, ATM-2, ATM-1, ATM, ATM+1, ATM+2, ATM+3
    const windowStrikes: number[] = [];
    for (let i = -3; i <= 3; i++) {
      windowStrikes.push(atm + i * step);
    }

    const rows: SevenStrikeRow[] = [];
    let ceCoiSum = 0;
    let peCoiSum = 0;

    for (const strike of windowStrikes) {
      const ceKey = this.makeInstrumentKey(underlying, expiry, strike, 'CE');
      const peKey = this.makeInstrumentKey(underlying, expiry, strike, 'PE');

      const ceOi = this.simulateOi(underlying, ceKey, strike, atm, 'CE', step);
      const peOi = this.simulateOi(underlying, peKey, strike, atm, 'PE', step);

      ceCoiSum += ceOi.changeOi;
      peCoiSum += peOi.changeOi;

      rows.push({
        strike,
        ce_coi: ceOi.changeOi,
        pe_coi: peOi.changeOi,
        ce_oi: ceOi.oi,
        pe_oi: peOi.oi,
      });
    }

    // COI PCR = Sum(PE COI) / Sum(CE COI)
    const coiPcr = ceCoiSum !== 0 ? Math.round((peCoiSum / ceCoiSum) * 10000) / 10000 : 0.0;

    // Update 7-strike state
    this.update7StrikeState(underlying, atm);

    const state = this.sevenStrikeState[underlying];

    return {
      underlying,
      expiry,
      spot_price: spot,
      atm_strike: atm,
      strike_step: step,
      window_strikes: windowStrikes,
      rows,
      ce_coi_sum: ceCoiSum,
      pe_coi_sum: peCoiSum,
      coi_pcr: coiPcr,
      state: state.state,
      last_shift_time: state.lastShiftTime,
      stabilization_end_time: state.stabilizationEndTime,
    };
  }

  get7StrikeSignals(underlying: string, expiry: string): SevenStrikeSignalsResponse {
    const matrix = this.get7StrikeMatrix(underlying, expiry);
    const coiPcr = matrix.coi_pcr;
    const spot = matrix.spot_price;
    const nowMs = Date.now();

    const signals: Signal[] = [];
    let gateCondition: string = 'NONE';
    let currentSignal: Signal | null = null;

    if (coiPcr > 1.5) {
      gateCondition = 'LONG';
      const confidence = Math.min(1.0, (coiPcr - 1.0) / 1.0);
      currentSignal = {
        signal_type: 'LONG',
        confidence: Math.round(confidence * 100) / 100,
        reason: `Strong bullish: COI PCR at ${coiPcr.toFixed(2)} indicates heavy Put writing support. Institutional buyers defending ${Math.trunc(matrix.atm_strike)} level.`,
        timestamp: nowMs,
        spot_price: spot,
        coi_pcr: coiPcr,
        volume_percent: Math.round((1.0 + Math.random() * 2.5) * 100) / 100,
        gate_condition: 'LONG',
        pain_index: Math.round((0.5 + Math.random() * 1.5) * 100) / 100,
      };
    } else if (coiPcr < 0.6) {
      gateCondition = 'SHORT';
      const confidence = Math.min(1.0, (1.0 - coiPcr) / 0.5);
      currentSignal = {
        signal_type: 'SHORT',
        confidence: Math.round(confidence * 100) / 100,
        reason: `Strong bearish: COI PCR at ${coiPcr.toFixed(2)} indicates heavy Call writing resistance. Institutional sellers defending ${Math.trunc(matrix.atm_strike)} level.`,
        timestamp: nowMs,
        spot_price: spot,
        coi_pcr: coiPcr,
        volume_percent: Math.round((1.0 + Math.random() * 2.5) * 100) / 100,
        gate_condition: 'SHORT',
        pain_index: Math.round((0.5 + Math.random() * 1.5) * 100) / 100,
      };
    } else if (coiPcr > 1.2) {
      gateCondition = 'LONG';
      signals.push({
        signal_type: 'LONG',
        confidence: Math.round(Math.min(1.0, (coiPcr - 1.0) / 1.0) * 100) / 100,
        reason: `Moderate bullish bias: COI PCR at ${coiPcr.toFixed(2)}. Put writers active, watching for trigger.`,
        timestamp: nowMs - 60000,
        spot_price: spot,
        coi_pcr: coiPcr,
        volume_percent: null,
        gate_condition: 'LONG',
        pain_index: null,
      });
    } else if (coiPcr < 0.8) {
      gateCondition = 'SHORT';
      signals.push({
        signal_type: 'SHORT',
        confidence: Math.round(Math.min(1.0, (1.0 - coiPcr) / 0.5) * 100) / 100,
        reason: `Moderate bearish bias: COI PCR at ${coiPcr.toFixed(2)}. Call writers active, watching for trigger.`,
        timestamp: nowMs - 60000,
        spot_price: spot,
        coi_pcr: coiPcr,
        volume_percent: null,
        gate_condition: 'SHORT',
        pain_index: null,
      });
    }

    // Historical signals for context
    for (let i = 0; i < 3; i++) {
      const sigTs = nowMs - (i + 1) * 300000;
      const sigPcr = coiPcr + gaussRandom(0, 0.1);
      const sigSpot = spot + gaussRandom(0, 10);

      if (sigPcr > 1.2) {
        signals.push({
          signal_type: 'LONG',
          confidence: Math.round(Math.min(1.0, (sigPcr - 1.0) / 1.0) * 100) / 100,
          reason: `COI PCR at ${sigPcr.toFixed(2)} - Put writing support detected`,
          timestamp: sigTs,
          spot_price: Math.round(sigSpot * 100) / 100,
          coi_pcr: Math.round(sigPcr * 10000) / 10000,
          volume_percent: Math.round((0.5 + Math.random() * 1.5) * 100) / 100,
          gate_condition: 'LONG',
          pain_index: Math.round(Math.random() * 1.5 * 100) / 100,
        });
      } else if (sigPcr < 0.8) {
        signals.push({
          signal_type: 'SHORT',
          confidence: Math.round(Math.min(1.0, (1.0 - sigPcr) / 0.5) * 100) / 100,
          reason: `COI PCR at ${sigPcr.toFixed(2)} - Call writing resistance detected`,
          timestamp: sigTs,
          spot_price: Math.round(sigSpot * 100) / 100,
          coi_pcr: Math.round(sigPcr * 10000) / 10000,
          volume_percent: Math.round((0.5 + Math.random() * 1.5) * 100) / 100,
          gate_condition: 'SHORT',
          pain_index: Math.round(Math.random() * 1.5 * 100) / 100,
        });
      } else {
        signals.push({
          signal_type: 'NEUTRAL',
          confidence: 0.0,
          reason: `COI PCR at ${sigPcr.toFixed(2)} - No directional bias`,
          timestamp: sigTs,
          spot_price: Math.round(sigSpot * 100) / 100,
          coi_pcr: Math.round(sigPcr * 10000) / 10000,
          volume_percent: Math.round((0.5 + Math.random()) * 100) / 100,
          gate_condition: 'NONE',
          pain_index: null,
        });
      }
    }

    // Sort signals by timestamp (most recent first)
    signals.sort((a, b) => b.timestamp - a.timestamp);

    // Determine state
    let state: string;
    if (currentSignal) {
      state = 'ACTIVE';
    } else if (gateCondition !== 'NONE') {
      state = 'ZONE_WATCH';
    } else {
      state = 'IDLE';
    }

    return {
      underlying,
      expiry,
      signals,
      current_signal: currentSignal,
      gate_condition: gateCondition,
      state,
    };
  }

  // ---------- Private Helpers ----------

  private simulateOi(
    underlying: string,
    instrumentKey: string,
    strike: number,
    atm: number,
    optionType: string,
    step: number,
  ): { oi: number; changeOi: number } {
    if (!this.oiState[instrumentKey]) {
      const distFromAtm = Math.abs(strike - atm) / step;

      let baseOi: number;
      if (optionType === 'PE') {
        baseOi = Math.max(10000, Math.floor(300000 * Math.exp(-distFromAtm * 0.3)));
      } else {
        baseOi = Math.max(10000, Math.floor(250000 * Math.exp(-distFromAtm * 0.3)));
      }

      const openOi = Math.max(5000, baseOi + randInt(-Math.floor(baseOi / 4), Math.floor(baseOi / 4)));

      this.oiState[instrumentKey] = {
        openOi,
        currentOi: openOi,
      };
    }

    const state = this.oiState[instrumentKey];

    // Small OI changes
    let oiChange = randInt(-2000, 3000);

    // Bias: PE OI tends to build up (support), CE OI also builds (resistance)
    if (optionType === 'PE') {
      oiChange = Math.floor(oiChange * 1.2); // Slight bullish bias
    }

    state.currentOi = Math.max(1000, state.currentOi + oiChange);
    const changeOi = state.currentOi - state.openOi;

    return { oi: state.currentOi, changeOi };
  }

  private makeInstrumentKey(underlying: string, expiry: string, strike: number, optType: string): string {
    const expiryDt = new Date(expiry + 'T00:00:00Z');
    const day = String(expiryDt.getUTCDate()).padStart(2, '0');
    const month = MONTHS[expiryDt.getUTCMonth()].toUpperCase();
    return `NSE_FO|${underlying}${day}${month}${Math.trunc(strike)}${optType}`;
  }

  private makeTradingSymbol(underlying: string, expiry: string, strike: number, optType: string): string {
    const expiryDt = new Date(expiry + 'T00:00:00Z');
    const day = String(expiryDt.getUTCDate()).padStart(2, '0');
    const month = MONTHS[expiryDt.getUTCMonth()].toUpperCase();
    return `${underlying}${day}${month}${Math.trunc(strike)}${optType}`;
  }

  private priceFromInstrumentKey(instrumentKey: string): number {
    const spot = this.getSpot('NIFTY');

    try {
      const parts = instrumentKey.split('|');
      const symbol = parts.length > 1 ? parts[1] : parts[0];

      const optType = symbol.endsWith('CE') ? 'CE' : 'PE';
      let numericPart = symbol;
      for (const prefix of ['NIFTY', 'BANKNIFTY']) {
        if (numericPart.startsWith(prefix)) {
          numericPart = numericPart.slice(prefix.length);
          break;
        }
      }
      // Remove option type suffix
      numericPart = numericPart.replace(/CE$|PE$/, '');
      // Remove date part (first 5 chars like 25JUN)
      if (numericPart.length > 5) {
        const strike = parseFloat(numericPart.slice(5));
        const diff = spot - strike;
        if (optType === 'CE') {
          return Math.max(0.05, diff > 0 ? diff : 50 * Math.exp(-Math.abs(diff) / 200));
        } else {
          return Math.max(0.05, diff < 0 ? -diff : 50 * Math.exp(-Math.abs(diff) / 200));
        }
      }
    } catch {
      // Fall through to default
    }
    return Math.round(spot * 0.02 * 100) / 100;
  }

  private update7StrikeState(underlying: string, currentAtm: number): void {
    const state = this.sevenStrikeState[underlying];
    const nowMs = Date.now();

    if (state.currentAtm === null) {
      state.currentAtm = currentAtm;
      state.prevAtm = currentAtm;
      return;
    }

    if (currentAtm !== state.currentAtm) {
      state.prevAtm = state.currentAtm;
      state.currentAtm = currentAtm;
      state.lastShiftTime = nowMs;
      state.stabilizationEndTime = nowMs + STABILIZATION_MINUTES * 60 * 1000;
      state.state = 'WINDOW_SHIFTING_STABILIZING';
      console.log(`[7Strike] Window shift for ${underlying}: ${state.prevAtm} -> ${currentAtm}. Stabilizing.`);
    }

    if (state.state === 'WINDOW_SHIFTING_STABILIZING') {
      if (state.stabilizationEndTime !== null && nowMs >= state.stabilizationEndTime) {
        state.state = 'STABLE';
        console.log(`[7Strike] Stabilization complete for ${underlying}`);
      }
    }
  }

  /** Update spot candle state for real-time candle building */
  private updateSpotCandle(underlying: string): void {
    const config = UNDERLYINGS[underlying] ?? UNDERLYINGS.NIFTY;
    const spot = this.spot[underlying];
    const nowSec = Math.floor(Date.now() / 1000);
    const candleStartSec = Math.floor(nowSec / 60) * 60; // Current 1m candle start

    const key = `${underlying}_1m`;
    if (!this.candleState[key]) {
      this.candleState[key] = { candles: [], current: null };
    }

    const cs = this.candleState[key];
    if (!cs.current || cs.current.startTime !== candleStartSec) {
      // Finalize previous candle
      if (cs.current) {
        cs.candles.push({
          time: cs.current.startTime,
          open: cs.current.open,
          high: cs.current.high,
          low: cs.current.low,
          close: cs.current.close,
          volume: cs.current.volume,
        });
        // Keep max 500 candles
        if (cs.candles.length > 500) {
          cs.candles = cs.candles.slice(-500);
        }
      }
      // Start new candle
      cs.current = {
        startTime: candleStartSec,
        open: spot,
        high: spot,
        low: spot,
        close: spot,
        volume: 0,
      };
    } else {
      // Update current candle
      cs.current.high = Math.max(cs.current.high, spot);
      cs.current.low = Math.min(cs.current.low, spot);
      cs.current.close = spot;
      cs.current.volume += randInt(10, 100);
    }
  }

  /** Get current spot candles (for the spot chart) */
  getSpotCandles(underlying: string, timeframe: string, count: number = 200): Candle[] {
    const key = `${underlying}_1m`;
    const cs = this.candleState[key];

    if (cs && cs.candles.length > 0) {
      // We have some real candles
      const realCandles = cs.candles.slice(-count);
      // Generate additional candles if needed
      const needed = count - realCandles.length;
      if (needed > 0) {
        const synthetic = this.generateCandles(`${underlying}_SPOT`, timeframe, needed);
        return [...synthetic, ...realCandles];
      }
      return realCandles;
    }

    // No real candles yet, generate synthetic
    return this.generateCandles(`${underlying}_SPOT`, timeframe, count);
  }
}

// ============ Singleton ============

let _simulator: MarketDataSimulator | null = null;

export function getSimulator(): MarketDataSimulator {
  if (!_simulator) {
    _simulator = new MarketDataSimulator();
  }
  return _simulator;
}
