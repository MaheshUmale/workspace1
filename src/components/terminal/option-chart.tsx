'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { createChart, type IChartApi, type ISeriesApi, LineStyle } from 'lightweight-charts';
import { Plus, Minus, Maximize2 } from 'lucide-react';
import { useTradingStore, type Timeframe } from '@/store/trading-store';
import { TimeframeSelector } from './timeframe-selector';
import { DARK_THEME, CANDLE_COLORS, buildInstrumentKey, formatNumber, addCandlestickSeries, addHistogramSeries, fetchAPI } from '@/lib/chart-utils';
import { useMarketData, type CandleData } from '@/hooks/use-market-data';

interface OptionChartProps {
  optionType: 'CE' | 'PE';
}

export function OptionChart({ optionType }: OptionChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const lastKeyRef = useRef<string>('');
  const lastTimeframeRef = useRef<string>('');
  const [isAutoFit, setIsAutoFit] = useState(true);

  const { underlying, expiry, selectedStrike, timeframe, optionChain, spotData, atmStrike } = useTradingStore();
  const spot = spotData[underlying];
  const { fetchCandles } = useMarketData();

  const currentStrike = (() => {
    if (selectedStrike > 0) {
      const exactMatch = optionChain.find(r => r.strike === selectedStrike);
      if (exactMatch) return selectedStrike;
      if (optionChain.length > 0) {
        const closest = optionChain.reduce((prev, curr) =>
          Math.abs(curr.strike - selectedStrike) < Math.abs(prev.strike - selectedStrike) ? curr : prev
        );
        return closest.strike;
      }
    }
    if (atmStrike > 0) return atmStrike;
    if (optionChain.length > 0) {
      return optionChain[Math.floor(optionChain.length / 2)]?.strike ?? 0;
    }
    return 0;
  })();

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      ...DARK_THEME,
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    });

    const candleSeries = addCandlestickSeries(chart, { ...CANDLE_COLORS });
    const volumeSeries = addHistogramSeries(chart, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });

    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

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

  const loadData = useCallback(async () => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || !expiry) return;
    if (!currentStrike || currentStrike === 0) return;

    console.log(`[OptionChart] Loading ${currentStrike} ${optionType} for ${expiry} @ ${timeframe}`);

    const chainRow = optionChain.find((r) => r.strike === currentStrike);
    let instrumentKey = optionType === 'CE' ? chainRow?.ce_instrument_key : chainRow?.pe_instrument_key;

    if (!instrumentKey) {
      try {
        const query = `${underlying} ${currentStrike} ${optionType}`;
        const searchResults = await fetchAPI<{ results: any[] }>('/api/instruments/search', {
          q: query,
          expiry: 'current_week'
        });
        const match = searchResults.results.find(r =>
          r.strike === currentStrike && r.option_type === optionType && r.expiry === expiry
        );
        if (match) instrumentKey = match.instrument_key;
      } catch (err) { }
    }

    if (!instrumentKey) {
      instrumentKey = buildInstrumentKey(underlying, expiry, currentStrike, optionType);
    }

    const candles = await fetchCandles(instrumentKey, timeframe);
    if (!candles || candles.length === 0) {
      console.log(`[OptionChart] No candles returned for ${instrumentKey} @ ${timeframe}`);
      candleSeriesRef.current.setData([]);
      volumeSeriesRef.current.setData([]);
      return;
    }

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

    const isNewInstrument = instrumentKey !== lastKeyRef.current;
    const isNewTimeframe = timeframe !== lastTimeframeRef.current;
    if (isAutoFit || isNewInstrument || isNewTimeframe) {
      console.log(`[OptionChart] Fitting content (isAutoFit=${isAutoFit}, isNewInstrument=${isNewInstrument}, isNewTimeframe=${isNewTimeframe})`);
      chartRef.current?.timeScale().fitContent();
      lastKeyRef.current = instrumentKey;
      lastTimeframeRef.current = timeframe;
    }
  }, [underlying, expiry, currentStrike, optionType, timeframe, fetchCandles, optionChain, isAutoFit]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const chainRow = optionChain.find((r) => r.strike === currentStrike);
  const ltp = optionType === 'CE' ? chainRow?.ce_ltp : chainRow?.pe_ltp;
  const oi = optionType === 'CE' ? chainRow?.ce_oi : chainRow?.pe_oi;
  const changeOi = optionType === 'CE' ? chainRow?.ce_change_oi : chainRow?.pe_change_oi;
  const accentColor = optionType === 'CE' ? 'text-green-400' : 'text-red-400';

  return (
    <div className="flex flex-col h-full">
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

      <div className="flex-1 min-h-0 relative">
        <div ref={containerRef} className="w-full h-full" />

        <div className="absolute bottom-4 left-4 flex items-center gap-1 z-20">
          <button
            onClick={() => chartRef.current?.timeScale().zoomIn(0.1)}
            className="p-1 bg-[#1f2937]/90 hover:bg-[#374151] rounded text-gray-400 hover:text-white border border-[#374151] transition-colors shadow-lg"
            title="Zoom In"
          >
            <Plus size={14} />
          </button>
          <button
            onClick={() => chartRef.current?.timeScale().zoomOut(0.1)}
            className="p-1 bg-[#1f2937]/90 hover:bg-[#374151] rounded text-gray-400 hover:text-white border border-[#374151] transition-colors shadow-lg"
            title="Zoom Out"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={() => {
              setIsAutoFit(!isAutoFit);
              if (!isAutoFit) {
                chartRef.current?.timeScale().fitContent();
              }
            }}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[9px] font-bold border transition-all shadow-lg ${
              isAutoFit
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-[#1f2937]/90 border-[#374151] text-gray-400 hover:text-white'
            }`}
          >
            <Maximize2 size={10} />
            AUTO
          </button>
        </div>
      </div>
    </div>
  );
}
