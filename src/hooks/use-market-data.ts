'use client';

import { useEffect, useCallback, useRef } from 'react';
import { useTradingStore } from '@/store/trading-store';
import { fetchAPI } from '@/lib/chart-utils';
import type { Timeframe } from '@/store/trading-store';

// ============ Candle Data Types ============

export interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface CandleResponse {
  instrument_key: string;
  timeframe: string;
  candles: CandleData[];
}

interface OptionChainResponse {
  underlying: string;
  expiry: string;
  spot_price: number;
  atm_strike: number;
  strike_step: number;
  chain: Array<{
    strike: number;
    ce: {
      instrument_key: string;
      ltp: number;
      oi: number;
      change_oi: number;
    } | null;
    pe: {
      instrument_key: string;
      ltp: number;
      oi: number;
      change_oi: number;
    } | null;
  }>;
}

interface PCRResponse {
  underlying: string;
  expiry: string;
  data: Array<{
    timestamp: number;
    spot: number;
    pcr: number;
    change_pcr: number;
  }>;
  current_pcr: number;
  current_change_pcr: number;
}

interface ExpiryResponse {
  underlying: string;
  expiries: Array<{
    expiry_date: string;
    expiry_label: string;
    is_weekly: boolean;
    days_to_expiry: number;
  }>;
}

export function useMarketData() {
  const {
    underlying,
    expiry,
    timeframe,
    setOptionChain,
    setAtmStrike,
    setExpiries,
    setExpiry,
    addPCRDataPoint,
    setCurrentPCR,
    updateSpotData,
  } = useTradingStore();

  const candlesCacheRef = useRef<Record<string, { data: CandleData[]; timestamp: number }>>({});

  // Cache TTL: 30 seconds for 1m candles, 2 minutes for higher timeframes
  const getCacheTTL = useCallback((tf: Timeframe) => {
    return tf === '1m' ? 30000 : 120000;
  }, []);

  // Fetch candles
  const fetchCandles = useCallback(async (
    instrumentKey: string,
    tf: Timeframe
  ): Promise<CandleData[]> => {
    const cacheKey = `${instrumentKey}_${tf}`;
    const cached = candlesCacheRef.current[cacheKey];
    const ttl = getCacheTTL(tf);

    // Return cached data if still fresh
    if (cached && (Date.now() - cached.timestamp) < ttl) {
      return cached.data;
    }

    try {
      const data = await fetchAPI<CandleResponse>('/api/candles', {
        instrument_key: instrumentKey,
        timeframe: tf,
      });
      const candles = data.candles || [];

      // Bug 2 fix: Only cache if we got data
      if (candles.length > 0) {
        candlesCacheRef.current[cacheKey] = { data: candles, timestamp: Date.now() };

        // Bug 2 fix: Update spot data from last candle if no spot data exists
        // This ensures we always have a spot price even when option chain is empty
        const isIndex = instrumentKey === 'NIFTY' || instrumentKey === 'BANKNIFTY';
        const currentSpot = useTradingStore.getState().spotData[instrumentKey];
        if (isIndex && (!currentSpot || currentSpot.ltp === 0)) {
          const lastCandle = candles[candles.length - 1];
          if (lastCandle && lastCandle.close > 0) {
            updateSpotData({
              symbol: instrumentKey,
              ltp: lastCandle.close,
              change: lastCandle.close - lastCandle.open,
              change_pct: ((lastCandle.close - lastCandle.open) / lastCandle.open) * 100,
              open: lastCandle.open,
              high: lastCandle.high,
              low: lastCandle.low,
              close: lastCandle.close,
              volume: lastCandle.volume,
              timestamp: lastCandle.time * 1000,
            });
          }
        }
      }

      return candles;
    } catch (err) {
      console.error('[MarketData] Failed to fetch candles:', err);
      // Return stale cache if available
      if (cached) return cached.data;
      return [];
    }
  }, [getCacheTTL, updateSpotData]);

  // Fetch option chain
  const fetchOptionChain = useCallback(async (
    symbol: string,
    exp: string
  ) => {
    if (!exp) return;

    try {
      const data = await fetchAPI<OptionChainResponse>('/api/option-chain/mini', {
        underlying: symbol,
        expiry: exp,
      });

      const chain: Array<OptionChainResponse['chain'][0]> = data.chain || [];
      const rows = chain.map((row) => ({
        strike: row.strike,
        ce_ltp: row.ce?.ltp ?? 0,
        ce_oi: row.ce?.oi ?? 0,
        ce_change_oi: row.ce?.change_oi ?? 0,
        pe_change_oi: row.pe?.change_oi ?? 0,
        pe_oi: row.pe?.oi ?? 0,
        pe_ltp: row.pe?.ltp ?? 0,
        ce_instrument_key: row.ce?.instrument_key ?? '',
        pe_instrument_key: row.pe?.instrument_key ?? '',
      }));

      setOptionChain(rows);
      setAtmStrike(data.atm_strike);

      // Bug 2 fix: Also update spot data from option chain response
      if (data.spot_price > 0) {
        updateSpotData({
          symbol,
          ltp: data.spot_price,
          change: 0,
          change_pct: 0,
          open: data.spot_price,
          high: data.spot_price,
          low: data.spot_price,
          close: data.spot_price,
          volume: 0,
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      console.error('[MarketData] Failed to fetch option chain:', err);
    }
  }, [setOptionChain, setAtmStrike, updateSpotData]);

  // Fetch PCR data
  const fetchPCR = useCallback(async (
    symbol: string,
    exp: string
  ) => {
    if (!exp) return;

    try {
      const data = await fetchAPI<PCRResponse>('/api/pcr', {
        underlying: symbol,
        expiry: exp,
      });

      // Add all PCR data points
      if (data.data && data.data.length > 0) {
        for (const point of data.data.slice(-50)) {
          addPCRDataPoint({
            timestamp: point.timestamp,
            spot: point.spot,
            pcr: point.pcr,
            change_pcr: point.change_pcr,
          });
        }
      }

      setCurrentPCR(data.current_pcr, data.current_change_pcr);
    } catch (err) {
      console.error('[MarketData] Failed to fetch PCR:', err);
    }
  }, [addPCRDataPoint, setCurrentPCR]);

  // Fetch expiries
  const fetchExpiries = useCallback(async (symbol: string) => {
    try {
      const data = await fetchAPI<ExpiryResponse>('/api/instruments/expiries', {
        underlying: symbol,
      });

      const expiries = (data.expiries || []).map((e) => e.expiry_date);
      setExpiries(expiries);

      // Auto-select first expiry if none selected
      if (expiries.length > 0 && !useTradingStore.getState().expiry) {
        setExpiry(expiries[0]);
      }
    } catch (err) {
      console.error('[MarketData] Failed to fetch expiries:', err);
    }
  }, [setExpiries, setExpiry]);

  // Bug 2 fix: Clear candle cache when timeframe changes (not just on mount)
  // Also clear cache when underlying changes to avoid stale data
  useEffect(() => {
    candlesCacheRef.current = {};
  }, [timeframe, underlying]);

  // Fetch expiries when underlying changes
  useEffect(() => {
    fetchExpiries(underlying);
  }, [underlying, fetchExpiries]);

  // Fetch option chain and PCR when underlying/expiry changes
  // Bug 4 fix: Also refetch on timeframe change to keep OI data fresh
  useEffect(() => {
    if (expiry) {
      fetchOptionChain(underlying, expiry);
      fetchPCR(underlying, expiry);
    }
  }, [underlying, expiry, fetchOptionChain, fetchPCR]);

  // Periodic refresh of option chain (every 15 seconds for live OI data)
  useEffect(() => {
    if (!expiry) return;
    const interval = setInterval(() => {
      fetchOptionChain(underlying, expiry);
      fetchPCR(underlying, expiry);
    }, 15000);
    return () => clearInterval(interval);
  }, [underlying, expiry, fetchOptionChain, fetchPCR]);

  return {
    fetchCandles,
    fetchOptionChain,
    fetchPCR,
    fetchExpiries,
  };
}
