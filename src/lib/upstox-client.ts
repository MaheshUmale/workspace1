// ============================================================
// Upstox API Client — Server-side only
// Handles authentication, rate limiting, caching, and
// instrument key mapping between Upstox and internal formats
// ============================================================

// ============ Types ============

export interface UpstoxProfile {
  user_id: string;
  user_name: string;
  email: string;
  broker: string;
}

export interface UpstoxOptionData {
  strike_price: number;
  expiry: string;
  pcr?: number;
  underlying_key?: string;
  underlying_spot_price?: number;
  option_type?: 'CE' | 'PE';
  instrument_key?: string;
  last_price?: number;
  volume?: number;
  open_interest?: number;
  change_in_open_interest?: number;
  bid_price?: number;
  ask_price?: number;
  greeks?: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    iv: number;
  };
  // Nested format from /v2/option/chain
  call_options?: {
    instrument_key: string;
    market_data: {
      ltp: number;
      volume: number;
      oi: number;
      change_in_oi: number;
      close_price: number;
      bid_price: number;
      ask_price: number;
      [key: string]: unknown;
    };
    option_greeks: {
      delta: number;
      gamma: number;
      theta: number;
      vega: number;
      iv: number;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  put_options?: {
    instrument_key: string;
    market_data: {
      ltp: number;
      volume: number;
      oi: number;
      change_in_oi: number;
      close_price: number;
      bid_price: number;
      ask_price: number;
      [key: string]: unknown;
    };
    option_greeks: {
      delta: number;
      gamma: number;
      theta: number;
      vega: number;
      iv: number;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
}

export interface UpstoxCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface UpstoxQuote {
  instrument_token: string;
  last_price: number;
  volume: number;
  ohlc: {
    open: number;
    high: number;
    low: number;
    close: number;
  };
  net_change: number;
  net_change_percent: number;
}

// ============ Instrument Key Mapping ============

const UNDERLYING_TO_UPSTOX: Record<string, string> = {
  NIFTY: 'NSE_INDEX|Nifty 50',
  BANKNIFTY: 'NSE_INDEX|Nifty Bank',
};

const UPSTOX_TO_UNDERLYING: Record<string, string> = {
  'NSE_INDEX|Nifty 50': 'NIFTY',
  'NSE_INDEX|Nifty Bank': 'BANKNIFTY',
};

const TIMEFRAME_TO_UPSTOX: Record<string, string> = {
  '1m': '1minute',
  '3m': '3minute',
  '5m': '5minute',
  '15m': '15minute',
  '1h': '1hour',
  '1d': '1day',
};

// ============ Upstox Client Class ============

export class UpstoxClient {
  private accessToken: string;
  private apiKey: string;
  private baseUrl = 'https://api.upstox.com';
  private cache: Map<string, { data: unknown; timestamp: number }>;
  private cacheTTL = 30000; // 30 seconds default cache
  private requestQueue: Array<() => void> = [];
  private requestsThisSecond = 0;
  private lastRequestReset = Date.now();
  private maxRequestsPerSecond = 8; // Conservative limit (Upstox ~10/sec)
  private tokenValid: boolean | null = null;
  private profile: UpstoxProfile | null = null;

  constructor(accessToken: string, apiKey?: string) {
    this.accessToken = accessToken;
    this.apiKey = apiKey || '';
    this.cache = new Map();
  }

  // ============ Rate Limiter ============

  private async rateLimitedFetch(url: string, options: RequestInit): Promise<Response> {
    await this.waitForRateLimit();

    // Add AbortController timeout to prevent hanging
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15 second timeout

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      // Handle 429 Too Many Requests
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '2', 10) * 1000;
        await new Promise((resolve) => setTimeout(resolve, retryAfter));
        return this.rateLimitedFetch(url, options);
      }

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();

    // Reset counter every second
    if (now - this.lastRequestReset >= 1000) {
      this.requestsThisSecond = 0;
      this.lastRequestReset = now;
    }

    if (this.requestsThisSecond < this.maxRequestsPerSecond) {
      this.requestsThisSecond++;
      return;
    }

    // Wait until the next second
    const waitTime = 1000 - (now - this.lastRequestReset);
    if (waitTime > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    this.requestsThisSecond = 1;
    this.lastRequestReset = Date.now();
  }

  // ============ Cache ============

  private getCacheKey(endpoint: string, params?: Record<string, string>): string {
    const paramStr = params ? Object.entries(params).sort().map(([k, v]) => `${k}=${v}`).join('&') : '';
    return `${endpoint}?${paramStr}`;
  }

  private getFromCache(key: string): unknown | null {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }
    if (cached) {
      this.cache.delete(key);
    }
    return null;
  }

  private setCache(key: string, data: unknown): void {
    this.cache.set(key, { data, timestamp: Date.now() });

    // Clean old entries periodically
    if (this.cache.size > 100) {
      const now = Date.now();
      for (const [k, v] of this.cache) {
        if (now - v.timestamp > this.cacheTTL * 2) {
          this.cache.delete(k);
        }
      }
    }
  }

  // ============ Core API Call ============

  private async apiCall(endpoint: string, params?: Record<string, string>): Promise<{
    success: boolean;
    data?: unknown;
    error?: string;
    status?: number;
  }> {
    const cacheKey = this.getCacheKey(endpoint, params);
    const cached = this.getFromCache(cacheKey);
    if (cached !== null) {
      return { success: true, data: cached };
    }

    try {
      const url = new URL(`${this.baseUrl}${endpoint}`);
      if (params) {
        for (const [key, value] of Object.entries(params)) {
          url.searchParams.set(key, value);
        }
      }

      const response = await this.rateLimitedFetch(url.toString(), {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.accessToken}`,
        },
      });

      if (response.status === 401) {
        this.tokenValid = false;
        return { success: false, error: 'Unauthorized — token may be expired', status: 401 };
      }

      if (response.status === 429) {
        return { success: false, error: 'Rate limit exceeded', status: 429 };
      }

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        return {
          success: false,
          error: `API error: ${response.status} ${response.statusText}${errorBody ? ` — ${errorBody}` : ''}`,
          status: response.status,
        };
      }

      const json = await response.json();

      if (json.status === 'success' || json.data !== undefined) {
        const result = json.data ?? json;
        this.setCache(cacheKey, result);
        return { success: true, data: result };
      }

      // Some endpoints return data directly
      this.setCache(cacheKey, json);
      return { success: true, data: json };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[UpstoxClient] API call failed: ${endpoint}`, message);
      return { success: false, error: message };
    }
  }

  // ============ Public Methods ============

  /**
   * Validate the access token by fetching user profile
   */
  async validateToken(): Promise<{ valid: boolean; user?: UpstoxProfile; error?: string }> {
    if (this.tokenValid === true && this.profile) {
      return { valid: true, user: this.profile };
    }

    const result = await this.apiCall('/v2/user/profile');

    if (!result.success) {
      this.tokenValid = false;
      return { valid: false, error: result.error };
    }

    const profile = result.data as UpstoxProfile;
    this.tokenValid = true;
    this.profile = profile;
    return { valid: true, user: profile };
  }

  /**
   * Get the Upstox instrument key for an underlying
   */
  getUpstoxInstrumentKey(underlying: string): string {
    return UNDERLYING_TO_UPSTOX[underlying] || underlying;
  }

  /**
   * Get the internal underlying name from an Upstox instrument key
   */
  getInternalUnderlying(upstoxKey: string): string {
    return UPSTOX_TO_UNDERLYING[upstoxKey] || upstoxKey;
  }

  /**
   * Map internal timeframe to Upstox interval format
   */
  getUpstoxInterval(timeframe: string): string {
    return TIMEFRAME_TO_UPSTOX[timeframe] || '1minute';
  }

  /**
   * Get option chain from Upstox
   */
  async getOptionChain(underlying: string, expiry: string): Promise<{
    success: boolean;
    data?: UpstoxOptionData[];
    spot_price?: number;
    error?: string;
  }> {
    const instrumentKey = this.getUpstoxInstrumentKey(underlying);
    const result = await this.apiCall('/v2/option/chain', {
      instrument_key: instrumentKey,
      expiry_date: expiry,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    // Upstox /v2/option/chain returns:
    // { status: "success", data: [ { strike_price, pcr, call_options: {...}, put_options: {...} } ] }
    // The apiCall method already unwraps the top-level `data` field,
    // so result.data is the array of option data directly.
    const rawData = result.data;
    let optionData: UpstoxOptionData[] = [];

    if (Array.isArray(rawData)) {
      // Most common case: result.data is already the array
      optionData = rawData as UpstoxOptionData[];
    } else if (rawData && typeof rawData === 'object') {
      // Fallback: result.data might be wrapped in another data property
      const rawObj = rawData as Record<string, unknown>;
      if (rawObj.data && Array.isArray(rawObj.data)) {
        optionData = rawObj.data as UpstoxOptionData[];
      }
    }

    // Extract spot price from first entry
    const spotPrice = optionData.length > 0 ? (optionData[0].underlying_spot_price || 0) : 0;

    return { success: true, data: optionData, spot_price: spotPrice };
  }

  /**
   * Get historical candles from Upstox
   */
  async getCandles(
    instrumentKey: string,
    interval: string,
    fromDate?: string,
    toDate?: string
  ): Promise<{
    success: boolean;
    data?: UpstoxCandle[];
    error?: string;
  }> {
    const upstoxInterval = this.getUpstoxInterval(interval);
    const to = toDate || new Date().toISOString().split('T')[0];
    // Bug 6 fix: Default to 5 days instead of 7 for startup data
    const from = fromDate || new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // URL path format: /v2/historical-candle/{instrument_key}/{interval}/{to_date}/{from_date}
    // Instrument key contains | which needs to be encoded
    const encodedKey = encodeURIComponent(instrumentKey);
    const endpoint = `/v2/historical-candle/${encodedKey}/${upstoxInterval}/${to}/${from}`;

    const result = await this.apiCall(endpoint);

    if (!result.success) {
      return { success: false, error: result.error };
    }

    // Bug 2 fix: Upstox v2 historical candle API returns candles as ARRAYS:
    // { status: "success", data: { candles: [[ts, O, H, L, C, V], ...] } }
    // NOT as objects with .timestamp, .open, etc.
    const rawData = result.data;
    let candleArrays: unknown[] = [];

    if (rawData && typeof rawData === 'object' && !Array.isArray(rawData)) {
      // Response is { candles: [...] } or { data: { candles: [...] } }
      const rawObj = rawData as Record<string, unknown>;
      if (rawObj.candles && Array.isArray(rawObj.candles)) {
        candleArrays = rawObj.candles as unknown[];
      } else if (rawObj.data && typeof rawObj.data === 'object') {
        const innerData = rawObj.data as Record<string, unknown>;
        if (innerData.candles && Array.isArray(innerData.candles)) {
          candleArrays = innerData.candles as unknown[];
        } else if (Array.isArray(innerData)) {
          candleArrays = innerData as unknown[];
        }
      }
    } else if (Array.isArray(rawData)) {
      candleArrays = rawData as unknown[];
    }

    // Transform arrays to objects if needed
    const candles: UpstoxCandle[] = candleArrays.map((c: unknown) => {
      if (Array.isArray(c)) {
        // Upstox format: [timestamp, open, high, low, close, volume]
        return {
          timestamp: c[0] as string,
          open: parseFloat(String(c[1])) || 0,
          high: parseFloat(String(c[2])) || 0,
          low: parseFloat(String(c[3])) || 0,
          close: parseFloat(String(c[4])) || 0,
          volume: parseInt(String(c[5])) || 0,
        };
      }
      return c as UpstoxCandle; // Already object format
    });

    return { success: true, data: candles };
  }

  /**
   * Get market quotes from Upstox
   */
  async getQuotes(instrumentKeys: string[]): Promise<{
    success: boolean;
    data?: Record<string, UpstoxQuote>;
    error?: string;
  }> {
    if (instrumentKeys.length === 0) {
      return { success: true, data: {} };
    }

    const keysParam = instrumentKeys.join(',');
    const result = await this.apiCall('/v2/market-quote/quotes', {
      instrument_key: keysParam,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return { success: true, data: result.data as Record<string, UpstoxQuote> };
  }

  /**
   * Search instruments from Upstox
   */
  async searchInstruments(query: string): Promise<{
    success: boolean;
    data?: unknown[];
    error?: string;
  }> {
    // Try NSE_FO instruments search
    const result = await this.apiCall('/v2/option/instruments', {
      underlying: query,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const rawData = result.data as { data?: unknown[] } | unknown[];
    const instruments = Array.isArray(rawData) ? rawData : (rawData as { data?: unknown[] }).data || [];

    return { success: true, data: instruments };
  }

  /**
   * Get available expiries for an underlying using Upstox instruments search API.
   * This returns both weekly and monthly expiries with proper metadata.
   * API: /v2/instruments/search?query=Nifty&expiry=current_month
   */
  async getExpiries(underlying: string): Promise<{
    success: boolean;
    data?: string[];
    error?: string;
  }> {
    // Map underlying to the query string the search API expects
    const queryMap: Record<string, string> = {
      NIFTY: 'Nifty',
      BANKNIFTY: 'Bank Nifty',
    };
    const query = queryMap[underlying] || underlying;

    const allExpiries: string[] = [];

    // Fetch current month and next month expiries
    for (const expiryFilter of ['current_month', 'next_month']) {
      const result = await this.apiCall('/v2/instruments/search', {
        query,
        expiry: expiryFilter,
        atm_offset: '0',
        page_number: '1',
        records: '15',
      });

      if (result.success) {
        // Parse the response to extract unique expiry dates
        const rawData = result.data;
        let instruments: Array<{ expiry?: string }> = [];

        if (Array.isArray(rawData)) {
          instruments = rawData as Array<{ expiry?: string }>;
        } else if (rawData && typeof rawData === 'object') {
          const rawObj = rawData as Record<string, unknown>;
          if (rawObj.data && Array.isArray(rawObj.data)) {
            instruments = rawObj.data as Array<{ expiry?: string }>;
          }
        }

        for (const inst of instruments) {
          if (inst.expiry && !allExpiries.includes(inst.expiry)) {
            allExpiries.push(inst.expiry);
          }
        }
      }
    }

    // Sort expiries
    allExpiries.sort();

    return { success: true, data: allExpiries };
  }

  /**
   * Check if the client is properly configured
   */
  isConfigured(): boolean {
    return !!this.accessToken;
  }

  /**
   * Get a masked version of the access token for display
   */
  getMaskedToken(): string {
    if (!this.accessToken) return '';
    if (this.accessToken.length <= 8) return '****';
    return this.accessToken.slice(0, 4) + '****' + this.accessToken.slice(-4);
  }

  /**
   * Update the access token
   */
  setAccessToken(token: string): void {
    this.accessToken = token;
    this.tokenValid = null;
    this.profile = null;
    this.cache.clear();
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    this.cache.clear();
  }
}
