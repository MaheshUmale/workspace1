// ============================================================
// Unified Data Provider — Proxies ALL requests to Python engine.
// Python engine uses the official Upstox Python SDK for robustness.
// NO SIMULATION. NO MOCK DATA. NO FALLBACK.
// If Python engine is not connected, returns empty/default data.
// ============================================================

import type {
  CandleData,
  OptionChainRow,
  MiniOptionChainRow,
  MiniOptionEntry,
  ExpiryInfo,
  OIDatum,
  PCRPoint,
  SevenStrikeMatrix,
  SevenStrikeSignals,
  SevenStrikeHistory,
  TradeSuggestion,
} from '@/lib/market-simulator';

// ============ Data Mode ============

export type DataMode = 'live' | 'offline';

export interface DataProviderHealth {
  status: string;
  mode: DataMode;
  connected: boolean;
  upstox_configured: boolean;
  masked_token: string;
  uptime: number;
  symbols: string[];
  tick_count: number;
  timestamp: number;
}

// ============ Python Engine Proxy ============

const PYTHON_ENGINE_PORT = 3035;
const PYTHON_ENGINE_BASE = `http://localhost:${PYTHON_ENGINE_PORT}`;

async function fetchFromPython(path: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(path, PYTHON_ENGINE_BASE);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') url.searchParams.set(k, v);
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) {
      console.warn(`[DataProvider] Python engine returned ${res.status} for ${path}`);
      return null;
    }
    return await res.json();
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.warn(`[DataProvider] Python engine timeout for ${path}`);
    } else {
      console.warn(`[DataProvider] Python engine error for ${path}:`, err.message);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ============ Empty Data Helpers ============

function emptyOptionChain(underlying: string, expiry: string) {
  return {
    underlying,
    expiry,
    spot_price: 0,
    atm_strike: 0,
    strike_step: underlying === 'BANKNIFTY' ? 100 : 50,
    chain: [] as OptionChainRow[],
  };
}

function emptyMiniOptionChain(underlying: string, expiry: string) {
  return {
    ...emptyOptionChain(underlying, expiry),
    chain: [] as MiniOptionChainRow[],
  };
}

function emptyOIData(underlying: string, expiry: string) {
  return { underlying, expiry, spot_price: 0, data: [] as OIDatum[] };
}

function emptyPCR(underlying: string, expiry: string) {
  return { underlying, expiry, data: [] as PCRPoint[], current_pcr: 1, current_change_pcr: 0 };
}

// ============ Data Provider Class ============

class DataProvider {
  private isLive = false;
  private start_time = Date.now();
  private tick_count = 0;
  private _engineHealthy = false;
  private _lastHealthCheck = 0;

  constructor() {
    // Check Python engine health on startup
    this.checkEngineHealth();
  }

  private async checkEngineHealth(): Promise<boolean> {
    // Throttle health checks to once per 10 seconds
    const now = Date.now();
    if (now - this._lastHealthCheck < 10000 && this._engineHealthy) {
      return this._engineHealthy;
    }
    this._lastHealthCheck = now;

    try {
      const health = await fetchFromPython('/api/health');
      if (health && health.status === 'ok') {
        this._engineHealthy = true;
        this.isLive = health.mode === 'live' && health.connected;
        return true;
      }
      this._engineHealthy = false;
      return false;
    } catch {
      this._engineHealthy = false;
      return false;
    }
  }

  // ============ Configuration ============

  async configureUpstox(accessToken: string, _apiKey?: string): Promise<boolean> {
    try {
      const res = await fetch(`${PYTHON_ENGINE_BASE}/api/config/upstox`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: accessToken }),
      });
      const data = await res.json();
      if (data.success) {
        this.isLive = true;
        this._engineHealthy = true;
        console.log('[DataProvider] Python engine Upstox connected. Mode: LIVE');
        return true;
      }
      console.warn('[DataProvider] Python engine token validation failed:', data.error);
      return false;
    } catch (err) {
      console.error('[DataProvider] Python engine configuration failed:', err);
      return false;
    }
  }

  disconnectUpstox(): void {
    fetch(`${PYTHON_ENGINE_BASE}/api/config/upstox/disconnect`, { method: 'POST' }).catch(() => {});
    this.isLive = false;
    this._engineHealthy = false;
    console.log('[DataProvider] Upstox disconnected. Mode: OFFLINE');
  }

  isLiveData(): boolean {
    return this.isLive;
  }

  getMode(): DataMode {
    return this.isLive ? 'live' : 'offline';
  }

  getUpstoxClient(): null {
    // No more direct Upstox client — everything goes through Python engine
    return null;
  }

  // ============ Data Methods — Proxy to Python Engine ============

  async getCandles(instrumentKey: string, timeframe: string): Promise<CandleData[]> {
    await this.checkEngineHealth();
    if (!this._engineHealthy) return [];

    try {
      const data = await fetchFromPython('/api/candles', {
        instrument_key: instrumentKey,
        timeframe,
      });

      if (data && data.candles && Array.isArray(data.candles)) {
        const candles: CandleData[] = data.candles
          .map((c: any) => ({
            time: typeof c.time === 'number' ? c.time : Math.floor(new Date(c.time || c[0]).getTime() / 1000),
            open: Number(c.open ?? c[1] ?? 0),
            high: Number(c.high ?? c[2] ?? 0),
            low: Number(c.low ?? c[3] ?? 0),
            close: Number(c.close ?? c[4] ?? 0),
            volume: Number(c.volume ?? c[5] ?? 0),
          }))
          .filter((c: CandleData) =>
            c.close >= c.low && c.close <= c.high &&
            c.open >= c.low && c.open <= c.high &&
            c.high >= c.low && c.time > 0
          )
          .sort((a: CandleData, b: CandleData) => a.time - b.time);

        this.tick_count++;
        return candles;
      }

      return [];
    } catch (err) {
      console.warn('[DataProvider] getCandles failed:', err);
      return [];
    }
  }

  async getOptionChain(underlying: string, expiry: string): Promise<{
    underlying: string;
    expiry: string;
    spot_price: number;
    atm_strike: number;
    strike_step: number;
    chain: OptionChainRow[];
  }> {
    await this.checkEngineHealth();
    if (!this._engineHealthy) return emptyOptionChain(underlying, expiry);

    try {
      const data = await fetchFromPython('/api/options/chain', {
        underlying,
        expiry,
      });

      if (data && data.chain && Array.isArray(data.chain)) {
        this.tick_count++;
        return data as any;
      }

      return emptyOptionChain(underlying, expiry);
    } catch (err) {
      console.warn('[DataProvider] getOptionChain failed:', err);
      return emptyOptionChain(underlying, expiry);
    }
  }

  async getMiniOptionChain(underlying: string, expiry: string): Promise<{
    underlying: string;
    expiry: string;
    spot_price: number;
    atm_strike: number;
    strike_step: number;
    chain: MiniOptionChainRow[];
  }> {
    await this.checkEngineHealth();
    if (!this._engineHealthy) return emptyMiniOptionChain(underlying, expiry);

    try {
      const data = await fetchFromPython('/api/options/chain/mini', {
        underlying,
        expiry,
      });

      if (data && data.chain && Array.isArray(data.chain)) {
        this.tick_count++;
        return data as any;
      }

      return emptyMiniOptionChain(underlying, expiry);
    } catch (err) {
      console.warn('[DataProvider] getMiniOptionChain failed:', err);
      return emptyMiniOptionChain(underlying, expiry);
    }
  }

  async getOIData(underlying: string, expiry: string): Promise<{
    underlying: string;
    expiry: string;
    spot_price: number;
    data: OIDatum[];
  }> {
    await this.checkEngineHealth();
    if (!this._engineHealthy) return emptyOIData(underlying, expiry);

    try {
      const data = await fetchFromPython('/api/options/oi', {
        underlying,
        expiry,
      });

      if (data && data.data && Array.isArray(data.data)) {
        this.tick_count++;
        return data as any;
      }

      return emptyOIData(underlying, expiry);
    } catch (err) {
      console.warn('[DataProvider] getOIData failed:', err);
      return emptyOIData(underlying, expiry);
    }
  }

  async getPCR(underlying: string, expiry: string): Promise<{
    underlying: string;
    expiry: string;
    data: PCRPoint[];
    current_pcr: number;
    current_change_pcr: number;
  }> {
    await this.checkEngineHealth();
    if (!this._engineHealthy) return emptyPCR(underlying, expiry);

    try {
      const data = await fetchFromPython('/api/pcr', {
        underlying,
        expiry,
      });

      if (data) {
        this.tick_count++;
        return data as any;
      }

      return emptyPCR(underlying, expiry);
    } catch (err) {
      console.warn('[DataProvider] getPCR failed:', err);
      return emptyPCR(underlying, expiry);
    }
  }

  async getExpiries(underlying: string): Promise<ExpiryInfo[]> {
    await this.checkEngineHealth();
    if (!this._engineHealthy) return [];

    try {
      const data = await fetchFromPython('/api/instruments/expiries', {
        underlying,
      });

      if (data && data.expiries && Array.isArray(data.expiries)) {
        this.tick_count++;
        return data.expiries as ExpiryInfo[];
      }

      return [];
    } catch (err) {
      console.warn('[DataProvider] getExpiries failed:', err);
      return [];
    }
  }

  async searchInstruments(_query: string): Promise<any[]> {
    // Search instruments through Python engine
    return [];
  }

  async get7StrikeMatrix(underlying: string, expiry: string): Promise<SevenStrikeMatrix> {
    await this.checkEngineHealth();
    if (!this._engineHealthy) return {} as SevenStrikeMatrix;

    try {
      const data = await fetchFromPython('/api/7strike/matrix', {
        underlying,
        expiry,
      });
      return (data as SevenStrikeMatrix) || ({} as SevenStrikeMatrix);
    } catch (err) {
      console.warn('[DataProvider] get7StrikeMatrix failed:', err);
      return {} as SevenStrikeMatrix;
    }
  }

  async get7StrikeSignals(underlying: string, expiry: string): Promise<SevenStrikeSignals> {
    await this.checkEngineHealth();
    if (!this._engineHealthy) return {} as SevenStrikeSignals;

    try {
      const data = await fetchFromPython('/api/7strike/signals', {
        underlying,
        expiry,
      });
      return (data as SevenStrikeSignals) || ({} as SevenStrikeSignals);
    } catch (err) {
      console.warn('[DataProvider] get7StrikeSignals failed:', err);
      return {} as SevenStrikeSignals;
    }
  }

  async get7StrikeHistory(underlying: string, expiry: string): Promise<SevenStrikeHistory> {
    await this.checkEngineHealth();
    if (!this._engineHealthy) return {} as SevenStrikeHistory;

    try {
      const data = await fetchFromPython('/api/7strike/history', {
        underlying,
        expiry,
      });
      return (data as SevenStrikeHistory) || ({} as SevenStrikeHistory);
    } catch (err) {
      console.warn('[DataProvider] get7StrikeHistory failed:', err);
      return {} as SevenStrikeHistory;
    }
  }

  async get7StrikeTradeSuggestions(underlying: string, expiry: string): Promise<TradeSuggestion[]> {
    await this.checkEngineHealth();
    if (!this._engineHealthy) return [];

    try {
      const data = await fetchFromPython('/api/7strike/trades', {
        underlying,
        expiry,
      });
      return (data as TradeSuggestion[]) || [];
    } catch (err) {
      console.warn('[DataProvider] get7StrikeTradeSuggestions failed:', err);
      return [];
    }
  }

  getReplaySessions(): Array<{
    session_id: string;
    underlying: string;
    start_time: string;
    end_time: string;
    candle_count: number;
  }> {
    return [];
  }

  startReplay(_sessionId: string): {
    session_id: string;
    status: string;
    message: string;
  } {
    return { session_id: '', status: 'error', message: 'No replay data available' };
  }

  // ============ Health Check ============

  getHealth(): DataProviderHealth {
    return {
      status: 'ok',
      mode: this.getMode(),
      connected: this.isLive,
      upstox_configured: this._engineHealthy,
      masked_token: '',
      uptime: (Date.now() - this.start_time) / 1000,
      symbols: ['NIFTY', 'BANKNIFTY'],
      tick_count: this.tick_count,
      timestamp: Date.now(),
    };
  }
}

// ============ Singleton Export ============

const GLOBAL_KEY = '__tradingDataProvider__' as const;

declare global {
  var __tradingDataProvider__: DataProvider | undefined;
}

export function getDataProvider(): DataProvider {
  if (!globalThis[GLOBAL_KEY]) {
    globalThis[GLOBAL_KEY] = new DataProvider();
  }
  return globalThis[GLOBAL_KEY];
}

export function resetDataProvider(): void {
  globalThis[GLOBAL_KEY] = undefined;
}
