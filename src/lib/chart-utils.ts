'use client';

import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  LineStyle,
} from 'lightweight-charts';

// ============ Dark Theme Config ============

export const DARK_THEME = {
  layout: {
    background: { color: '#0a0e17' as const },
    textColor: '#9ca3af',
    fontSize: 11,
  },
  grid: {
    vertLines: { color: '#1e222d' },
    horzLines: { color: '#1e222d' },
  },
  crosshair: {
    mode: 0 as const,
    vertLine: {
      color: '#4b5563',
      width: 1 as const,
      style: LineStyle.Dashed,
      labelBackgroundColor: '#374151',
    },
    horzLine: {
      color: '#4b5563',
      width: 1 as const,
      style: LineStyle.Dashed,
      labelBackgroundColor: '#374151',
    },
  },
  rightPriceScale: {
    borderColor: '#1e222d',
    textColor: '#9ca3af',
  },
  timeScale: {
    borderColor: '#1e222d',
    timeVisible: true,
    secondsVisible: false,
    textColor: '#9ca3af',
  },
};

// ============ Candlestick Colors ============

export const CANDLE_COLORS = {
  upColor: '#22c55e',
  downColor: '#ef4444',
  borderUpColor: '#22c55e',
  borderDownColor: '#ef4444',
  wickUpColor: '#22c55e',
  wickDownColor: '#ef4444',
};

// ============ Chart Creation Helper ============

export function createThemedChart(
  container: HTMLElement,
  options?: Record<string, unknown>
): IChartApi {
  return createChart(container, {
    ...DARK_THEME,
    ...options,
  });
}

// ============ Series Helpers ============

export function addCandlestickSeries(
  chart: IChartApi,
  options?: Record<string, unknown>
): ISeriesApi<'Candlestick'> {
  return chart.addSeries(CandlestickSeries, options);
}

export function addLineSeries(
  chart: IChartApi,
  options?: Record<string, unknown>
): ISeriesApi<'Line'> {
  return chart.addSeries(LineSeries, options);
}

export function addHistogramSeries(
  chart: IChartApi,
  options?: Record<string, unknown>
): ISeriesApi<'Histogram'> {
  return chart.addSeries(HistogramSeries, options);
}

// ============ Format Helpers ============

export function formatNumber(num: number, decimals: number = 2): string {
  if (Math.abs(num) >= 1e7) {
    return (num / 1e7).toFixed(2) + 'Cr';
  }
  if (Math.abs(num) >= 1e5) {
    return (num / 1e5).toFixed(2) + 'L';
  }
  if (Math.abs(num) >= 1e3) {
    return (num / 1e3).toFixed(1) + 'K';
  }
  return num.toFixed(decimals);
}

export function formatPrice(price: number): string {
  return price.toFixed(2);
}

export function formatChange(change: number, changePct: number): string {
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(2)} (${sign}${changePct.toFixed(2)}%)`;
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatExpiry(expiryStr: string): string {
  if (!expiryStr) return '';
  const date = new Date(expiryStr);
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// ============ Instrument Key Builder ============

export function buildInstrumentKey(
  underlying: string,
  expiry: string,
  strike: number,
  optionType: string
): string {
  // Upstox instrument key format: NSE_FO|NIFTY2462723900CE
  // expiry: YYYY-MM-DD -> YYM (where M is 1-9, O, N, D for monthly) or YYMDD
  // However, the simplest format often accepted is SYMBOLYYMMDDSTRIKETYPE
  const d = new Date(expiry);
  const yy = d.getFullYear().toString().slice(2);
  const mm = (d.getMonth() + 1).toString().padStart(2, '0');
  const dd = d.getDate().toString().padStart(2, '0');

  return `NSE_FO|${underlying}${yy}${mm}${dd}${strike}${optionType}`;
}

export function parseInstrumentKey(key: string): {
  underlying: string;
  expiry: string;
  strike: number;
  optionType: string;
} | null {
  try {
    const parts = key.split('|');
    if (parts.length < 2) return null;
    const body = parts[1];

    let underlying = '';
    let rest = body;
    if (body.startsWith('NIFTY')) {
      underlying = 'NIFTY';
      rest = body.slice(5);
    } else if (body.startsWith('BANKNIFTY')) {
      underlying = 'BANKNIFTY';
      rest = body.slice(9);
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

// ============ API Helpers ============

export async function fetchAPI<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
  const searchParams = new URLSearchParams(params);
  const url = `${endpoint}?${searchParams.toString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}
