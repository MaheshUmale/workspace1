'use client';

import { useEffect, useRef, useCallback } from 'react';
import { createChart, type IChartApi, type ISeriesApi, LineStyle } from 'lightweight-charts';
import { useTradingStore, type Timeframe } from '@/store/trading-store';
import { TimeframeSelector } from './timeframe-selector';
import { DARK_THEME, CANDLE_COLORS, buildInstrumentKey, formatNumber, addCandlestickSeries, addHistogramSeries } from '@/lib/chart-utils';
import { useMarketData, type CandleData } from '@/hooks/use-market-data';

interface OptionChartProps {
  optionType: 'CE' | 'PE';
}

export function OptionChart({ optionType }: OptionChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  const { underlying, expiry, selectedStrike, timeframe, optionChain, spotData, atmStrike } = useTradingStore();
  const spot = spotData[underlying];
  const { fetchCandles } = useMarketData();

  // Bug 5 fix: Use selectedStrike (which is set to ATM by the main page)
  // Fall back to closest strike in option chain if exact match not found
  const currentStrike = (() => {
    if (selectedStrike > 0) {
      // Check if selectedStrike exists in chain
      const exactMatch = optionChain.find(r => r.strike === selectedStrike);
      if (exactMatch) return selectedStrike;
      // Find closest strike
      if (optionChain.length > 0) {
        const closest = optionChain.reduce((prev, curr) =>
          Math.abs(curr.strike - selectedStrike) < Math.abs(prev.strike - selectedStrike) ? curr : prev
        );
        return closest.strike;
      }
    }
    // Fallback: use ATM strike from store
    if (atmStrike > 0) return atmStrike;
    // Last resort: middle of chain
    if (optionChain.length > 0) {
      return optionChain[Math.floor(optionChain.length / 2)]?.strike ?? 0;
    }
    return 0;
  })();

  // Initialize chart
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      ...DARK_THEME,
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    });

    const candleSeries = addCandlestickSeries(chart, {
      ...CANDLE_COLORS,
    });

    const volumeSeries = addHistogramSeries(chart, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });

    // Handle resize
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        chart.applyOptions({ width, height });
      }
    });
    resizeObserver.observe(containerRef.current);

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [optionType]);

  // Load data — use instrument_key from option chain if available (Bug 5 fix)
  const loadData = useCallback(async () => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || !expiry) return;
    // Don't try to fetch if we don't have a valid strike yet
    if (!currentStrike || currentStrike === 0) return;

    // Bug 5: Use instrument key from option chain data instead of buildInstrumentKey
    const chainRow = optionChain.find((r) => r.strike === currentStrike);
    let instrumentKey: string;
    if (optionType === 'CE') {
      instrumentKey = chainRow?.ce_instrument_key || buildInstrumentKey(underlying, expiry, currentStrike, optionType);
    } else {
      instrumentKey = chainRow?.pe_instrument_key || buildInstrumentKey(underlying, expiry, currentStrike, optionType);
    }

    // Skip if no valid instrument key
    if (!instrumentKey) return;

    const candles = await fetchCandles(instrumentKey, timeframe);
    if (candles.length === 0) return;

    const sorted = [...candles].sort((a, b) => a.time - b.time);

    candleSeriesRef.current.setData(
      sorted.map((c) => ({
        time: c.time as any,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );

    volumeSeriesRef.current.setData(
      sorted.map((c) => ({
        time: c.time as any,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)',
      }))
    );

    // Bug 3 fix: REMOVED fake sine wave OI line series data generation.
    // Option charts should ONLY show candlesticks + volume.

    chartRef.current?.timeScale().fitContent();
  }, [underlying, expiry, currentStrike, optionType, timeframe, fetchCandles, optionChain]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Get LTP from option chain
  const chainRow = optionChain.find((r) => r.strike === currentStrike);
  const ltp = optionType === 'CE' ? chainRow?.ce_ltp : chainRow?.pe_ltp;
  const oi = optionType === 'CE' ? chainRow?.ce_oi : chainRow?.pe_oi;
  const changeOi = optionType === 'CE' ? chainRow?.ce_change_oi : chainRow?.pe_change_oi;

  const accentColor = optionType === 'CE' ? 'text-green-400' : 'text-red-400';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1f2937] shrink-0">
        <div className="flex items-center gap-3">
          <span className={`text-xs font-semibold uppercase tracking-wide ${accentColor}`}>
            {currentStrike} {optionType}
          </span>
          {ltp !== undefined && ltp > 0 && (
            <>
              <span className="text-sm font-bold text-white">{ltp.toFixed(2)}</span>
              <span className={`text-[10px] ${accentColor}`}>
                OI: {formatNumber(oi ?? 0)}
              </span>
              <span className={`text-[10px] ${(changeOi ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                Chg: {formatNumber(changeOi ?? 0)}
              </span>
            </>
          )}
        </div>
        <TimeframeSelector compact />
      </div>

      {/* Chart */}
      <div ref={containerRef} className="flex-1 min-h-0" />
    </div>
  );
}
