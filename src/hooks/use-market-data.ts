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

// ============ Shared Cache (Module-level, survives re-renders) ============

const _candlesCache: Record<string, { data: CandleData[]; timestamp: number }> = {};
const _optionChainCache: Record<string, { data: any; timestamp: number }> = {};
const _pcrCache: Record<string, { data: any; timestamp: number }> = {};
const _expiriesCache: Record<string, { data: string[]; timestamp: number }> = {};

// TTL constants
const CANDLE_TTL_1M = 30000;
const CANDLE_TTL_OTHER = 120000;
const OPTION_CHAIN_TTL = 10000;
const PCR_TTL = 15000;
const EXPIRIES_TTL = 300000;

function getCandleTTL(tf: Timeframe) {
  return tf === '1m' ? CANDLE_TTL_1M : CANDLE_TTL_OTHER;
}

function cacheKey(...parts: string[]) {
  return parts.join(':');
}

// ============ Hook ============

export function useMarketData() {
  // Use selector-based subscriptions to avoid re-renders from unrelated state changes
  const underlying = useTradingStore((s) => s.underlying);
  const expiry = useTradingStore((s) => s.expiry);
  const timeframe = useTradingStore((s) => s.timeframe);

  // Get actions via getState to avoid subscription re-renders
  const storeActions = useRef({
    setOptionChain: useTradingStore.getState().setOptionChain,
    setAtmStrike: useTradingStore.getState().setAtmStrike,
    setExpiries: useTradingStore.getState().setExpiries,
    setExpiry: useTradingStore.getState().setExpiry,
    addPCRDataPoint: useTradingStore.getState().addPCRDataPoint,
    setCurrentPCR: useTradingStore.getState().setCurrentPCR,
    updateSpotData: useTradingStore.getState().updateSpotData,
  });

  // Keep actions ref fresh
  useEffect(() => {
    storeActions.current = {
      setOptionChain: useTradingStore.getState().setOptionChain,
      setAtmStrike: useTradingStore.getState().setAtmStrike,
      setExpiries: useTradingStore.getState().setExpiries,
      setExpiry: useTradingStore.getState().setExpiry,
      addPCRDataPoint: useTradingStore.getState().addPCRDataPoint,
      setCurrentPCR: useTradingStore.getState().setCurrentPCR,
      updateSpotData: useTradingStore.getState().updateSpotData,
    };
  }, []);

  // Fetch candles
  const fetchCandles = useCallback(async (
    instrumentKey: string,
    tf: Timeframe
  ): Promise<CandleData[]> => {
    const key = cacheKey(instrumentKey, tf);
    const cached = _candlesCache[key];
    const ttl = getCandleTTL(tf);

    if (cached && (Date.now() - cached.timestamp) < ttl) {
      return cached.data;
    }

    try {
      const data = await fetchAPI<CandleResponse>('/api/candles', {
        instrument_key: instrumentKey,
        timeframe: tf,
      });
      const candles = data.candles || [];

      if (candles.length > 0) {
        _candlesCache[key] = { data: candles, timestamp: Date.now() };

        const isIndex = instrumentKey === 'NIFTY' || instrumentKey === 'BANKNIFTY';
        const currentSpot = useTradingStore.getState().spotData[instrumentKey];
        if (isIndex && (!currentSpot || currentSpot.ltp === 0)) {
          const lastCandle = candles[candles.length - 1];
          if (lastCandle && lastCandle.close > 0) {
            storeActions.current.updateSpotData({
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
      if (cached) return cached.data;
      return [];
    }
  }, []);

  // Fetch option chain
  const fetchOptionChain = useCallback(async (
    symbol: string,
    exp: string
  ) => {
    if (!exp) return;

    const key = cacheKey(symbol, exp);
    const cached = _optionChainCache[key];
    if (cached && (Date.now() - cached.timestamp) < OPTION_CHAIN_TTL) {
      // Still update store from cache to keep UI fresh
      storeActions.current.setOptionChain(cached.data.rows);
      storeActions.current.setAtmStrike(cached.data.atm_strike);
      return;
    }

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

      storeActions.current.setOptionChain(rows);
      storeActions.current.setAtmStrike(data.atm_strike);

      _optionChainCache[key] = {
        data: { rows, atm_strike: data.atm_strike },
        timestamp: Date.now(),
      };

      if (data.spot_price > 0) {
        storeActions.current.updateSpotData({
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
  }, []);

  // Fetch PCR data
  const fetchPCR = useCallback(async (
    symbol: string,
    exp: string
  ) => {
    if (!exp) return;

    const key = cacheKey(symbol, exp);
    const cached = _pcrCache[key];
    if (cached && (Date.now() - cached.timestamp) < PCR_TTL) {
      storeActions.current.setCurrentPCR(cached.data.current_pcr, cached.data.current_change_pcr);
      return;
    }

    try {
      const data = await fetchAPI<PCRResponse>('/api/pcr', {
        underlying: symbol,
        expiry: exp,
      });

      if (data.data && data.data.length > 0) {
        const latest = data.data[data.data.length - 1];
        storeActions.current.addPCRDataPoint({
          timestamp: latest.timestamp,
          spot: latest.spot,
          pcr: latest.pcr,
          change_pcr: latest.change_pcr,
        });
      }

      storeActions.current.setCurrentPCR(data.current_pcr, data.current_change_pcr);

      _pcrCache[key] = {
        data: { current_pcr: data.current_pcr, current_change_pcr: data.current_change_pcr },
        timestamp: Date.now(),
      };
    } catch (err) {
      console.error('[MarketData] Failed to fetch PCR:', err);
    }
  }, []);

  // Fetch expiries
  const fetchExpiries = useCallback(async (symbol: string) => {
    const key = cacheKey(symbol);
    const cached = _expiriesCache[key];
    if (cached && (Date.now() - cached.timestamp) < EXPIRIES_TTL) {
      storeActions.current.setExpiries(cached.data);
      if (cached.data.length > 0 && !useTradingStore.getState().expiry) {
        storeActions.current.setExpiry(cached.data[0]);
      }
      return;
    }

    try {
      const data = await fetchAPI<ExpiryResponse>('/api/instruments/expiries', {
        underlying: symbol,
      });

      const expiries = (data.expiries || []).map((e) => e.expiry_date);
      storeActions.current.setExpiries(expiries);

      _expiriesCache[key] = { data: expiries, timestamp: Date.now() };

      if (expiries.length > 0 && !useTradingStore.getState().expiry) {
        storeActions.current.setExpiry(expiries[0]);
      }
    } catch (err) {
      console.error('[MarketData] Failed to fetch expiries:', err);
    }
  }, []);

  // Clear caches when timeframe or underlying changes
  useEffect(() => {
    Object.keys(_candlesCache).forEach((k) => delete _candlesCache[k]);
    Object.keys(_optionChainCache).forEach((k) => delete _optionChainCache[k]);
    Object.keys(_pcrCache).forEach((k) => delete _pcrCache[k]);
  }, [timeframe, underlying]);

  // Fetch expiries when underlying changes
  useEffect(() => {
    fetchExpiries(underlying);
  }, [underlying, fetchExpiries]);

  // Fetch option chain and PCR when underlying/expiry changes
  useEffect(() => {
    if (expiry) {
      fetchOptionChain(underlying, expiry);
      fetchPCR(underlying, expiry);
    }
  }, [underlying, expiry, fetchOptionChain, fetchPCR]);

  // Periodic refresh (15s for live OI data)
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
