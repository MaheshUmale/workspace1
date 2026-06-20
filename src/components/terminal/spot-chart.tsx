'use client';

import { useEffect, useRef, useCallback, memo } from 'react';
import { createChart, type IChartApi, type ISeriesApi, LineStyle } from 'lightweight-charts';
import { useTradingStore, type OIProfile, type OptionChainRow } from '@/store/trading-store';
import { TimeframeSelector } from './timeframe-selector';
import { DARK_THEME, CANDLE_COLORS, formatNumber, addCandlestickSeries, addHistogramSeries } from '@/lib/chart-utils';
import { useMarketData } from '@/hooks/use-market-data';

// ============ OI Bar Drawing (Memoized) ============

interface OIDrawParams {
  ctx: CanvasRenderingContext2D;
  series: ISeriesApi<'Candlestick'>;
  optionChain: OptionChainRow[];
  atmStrike: number;
  oiProfile: OIProfile;
  canvasWidth: number;
  canvasHeight: number;
}

// Pre-computed constants for drawing
const CENTER_DIVIDER_COLOR = 'rgba(107, 114, 128, 0.4)';
const CE_BAR_COLOR = 'rgba(239, 68, 68, 0.45)';
const CE_BAR_NEG_COLOR = 'rgba(249, 115, 22, 0.35)';
const PE_BAR_COLOR = 'rgba(34, 197, 94, 0.45)';
const PE_BAR_NEG_COLOR = 'rgba(34, 197, 94, 0.25)';
const LABEL_COLOR = 'rgba(255, 255, 255, 0.85)';
const LEGEND_TEXT_COLOR = 'rgba(156, 163, 175, 0.7)';
const ATM_STROKE_COLOR = 'rgba(234, 179, 8, 0.6)';
const BAR_HEIGHT = 14;

function drawOIBars({ ctx, series, optionChain, atmStrike, oiProfile, canvasWidth, canvasHeight }: OIDrawParams) {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  if (!optionChain.length || canvasWidth === 0 || canvasHeight === 0) return;

  const step = atmStrike % 100 === 0 ? 100 : 50;
  const minStrike = atmStrike - step * 15;
  const maxStrike = atmStrike + step * 15;

  // Pre-filter and map in one pass
  const visibleValues: Array<{
    strike: number;
    ceVal: number;
    peVal: number;
    ceChangeOi: number;
    peChangeOi: number;
    y: number | null;
  }> = [];

  let maxVal = 1;
  for (const r of optionChain) {
    if (r.strike < minStrike || r.strike > maxStrike) continue;
    const ceVal = oiProfile === 'OI' ? r.ce_oi : Math.abs(r.ce_change_oi);
    const peVal = oiProfile === 'OI' ? r.pe_oi : Math.abs(r.pe_change_oi);
    const y = series.priceToCoordinate(r.strike);
    if (y === null) continue;
    visibleValues.push({ strike: r.strike, ceVal, peVal, ceChangeOi: r.ce_change_oi, peChangeOi: r.pe_change_oi, y });
    if (ceVal > maxVal) maxVal = ceVal;
    if (peVal > maxVal) maxVal = peVal;
  }

  if (!visibleValues.length) return;

  const maxBarPixels = canvasWidth * 0.35;
  const centerX = canvasWidth * 0.55;

  // Draw center divider
  ctx.strokeStyle = CENTER_DIVIDER_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(centerX, 0);
  ctx.lineTo(centerX, canvasHeight);
  ctx.stroke();

  // Batch draw bars
  for (const v of visibleValues) {
    const y = v.y!;

    // CE bar
    const ceBarWidth = (v.ceVal / maxVal) * maxBarPixels;
    if (ceBarWidth > 0) {
      const isCeNegative = oiProfile === 'COI' && v.ceChangeOi < 0;
      ctx.fillStyle = isCeNegative ? CE_BAR_NEG_COLOR : CE_BAR_COLOR;
      ctx.fillRect(centerX - ceBarWidth, y - BAR_HEIGHT / 2, ceBarWidth, BAR_HEIGHT);

      if (ceBarWidth > 30) {
        ctx.fillStyle = LABEL_COLOR;
        ctx.font = '9px monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(formatNumber(oiProfile === 'OI' ? v.ceVal : v.ceChangeOi), centerX - 4, y);
      }
    }

    // PE bar
    const peBarWidth = (v.peVal / maxVal) * maxBarPixels;
    if (peBarWidth > 0) {
      const isPeNegative = oiProfile === 'COI' && v.peChangeOi < 0;
      ctx.fillStyle = isPeNegative ? PE_BAR_NEG_COLOR : PE_BAR_COLOR;
      ctx.fillRect(centerX, y - BAR_HEIGHT / 2, peBarWidth, BAR_HEIGHT);

      if (peBarWidth > 30) {
        ctx.fillStyle = LABEL_COLOR;
        ctx.font = '9px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(formatNumber(oiProfile === 'OI' ? v.peVal : v.peChangeOi), centerX + 4, y);
      }
    }

    // ATM highlight
    if (v.strike === atmStrike) {
      ctx.strokeStyle = ATM_STROKE_COLOR;
      ctx.lineWidth = 1;
      ctx.strokeRect(centerX - ceBarWidth - 1, y - BAR_HEIGHT / 2 - 1, ceBarWidth + peBarWidth + 2, BAR_HEIGHT + 2);
    }
  }

  // Legend
  ctx.fillStyle = LEGEND_TEXT_COLOR;
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(oiProfile === 'OI' ? 'Open Interest' : 'Change OI', centerX - maxBarPixels, 8);

  const legendY = 22;
  const legendX = centerX - maxBarPixels;
  ctx.fillStyle = 'rgba(239, 68, 68, 0.7)';
  ctx.fillRect(legendX, legendY, 10, 10);
  ctx.fillStyle = LEGEND_TEXT_COLOR;
  ctx.font = '9px sans-serif';
  ctx.fillText('CE', legendX + 14, legendY + 8);
  ctx.fillStyle = 'rgba(34, 197, 94, 0.7)';
  ctx.fillRect(legendX + 38, legendY, 10, 10);
  ctx.fillStyle = LEGEND_TEXT_COLOR;
  ctx.fillText('PE', legendX + 52, legendY + 8);
}

// ============ Memoized Header Component ============

const ChartHeader = memo(function ChartHeader({
  underlying,
  spot,
  oiProfile,
  onToggle,
}: {
  underlying: string;
  spot: ReturnType<typeof useTradingStore.getState>['spotData'][string] | undefined;
  oiProfile: OIProfile;
  onToggle: (p: OIProfile) => void;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-[#1f2937] shrink-0">
      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
          {underlying} Spot
        </span>
        {spot && (
          <>
            <span className="text-sm font-bold text-white">{spot.ltp.toFixed(2)}</span>
            <span className={`text-xs font-medium ${spot.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {spot.change >= 0 ? '+' : ''}{spot.change.toFixed(2)} ({spot.change_pct.toFixed(2)}%)
            </span>
            <span className="text-[10px] text-gray-500">
              H: {spot.high.toFixed(2)} L: {spot.low.toFixed(2)}
            </span>
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center bg-[#111827] rounded border border-[#1f2937] overflow-hidden">
          <button
            onClick={() => onToggle('COI')}
            className={`px-2 py-0.5 text-[10px] font-semibold transition-colors ${
              oiProfile === 'COI' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            COI
          </button>
          <button
            onClick={() => onToggle('OI')}
            className={`px-2 py-0.5 text-[10px] font-semibold transition-colors ${
              oiProfile === 'OI' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            OI
          </button>
        </div>
        <TimeframeSelector compact />
      </div>
    </div>
  );
});

// ============ Spot Chart Component ============

export function SpotChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const priceLineRef = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']> | null>(null);
  const rafRef = useRef<number>(0);
  const redrawIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastDrawRef = useRef<string>('');

  const { underlying, spotData, timeframe, atmStrike, optionChain, oiProfile, setOiProfile } = useTradingStore();
  const spot = spotData[underlying];
  const { fetchCandles } = useMarketData();

  // Redraw OI bars overlay - throttled and deduplicated
  const redrawOI = useCallback(() => {
    if (!chartRef.current || !candleSeriesRef.current || !overlayCanvasRef.current) return;
    const canvas = overlayCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.parentElement?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const targetWidth = Math.round(rect.width * dpr);
    const targetHeight = Math.round(rect.height * dpr);

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Deduplicate: skip if data hash hasn't changed
    const dataHash = `${optionChain.length}-${atmStrike}-${oiProfile}-${rect.width}-${rect.height}`;
    if (dataHash === lastDrawRef.current) return;
    lastDrawRef.current = dataHash;

    drawOIBars({
      ctx,
      series: candleSeriesRef.current,
      optionChain,
      atmStrike,
      oiProfile,
      canvasWidth: rect.width,
      canvasHeight: rect.height,
    });
  }, [optionChain, atmStrike, oiProfile]);

  // Initialize chart
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

    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(redrawOI);
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    // Throttled redraw: 5fps instead of 10fps, with deduplication
    redrawIntervalRef.current = setInterval(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(redrawOI);
    }, 200);

    return () => {
      if (redrawIntervalRef.current) {
        clearInterval(redrawIntervalRef.current);
        redrawIntervalRef.current = null;
      }
      resizeObserver.disconnect();
      cancelAnimationFrame(rafRef.current);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(() => {});
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  // Load historical data
  const loadCandles = useCallback(async () => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;

    const candles = await fetchCandles(underlying, timeframe);
    if (candles.length === 0) return;

    const sorted = candles.sort((a, b) => a.time - b.time);

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

    chartRef.current?.timeScale().fitContent();

    // Single delayed redraw after fitContent
    setTimeout(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(redrawOI);
    }, 250);
  }, [underlying, timeframe, fetchCandles, redrawOI]);

  useEffect(() => {
    loadCandles();
  }, [loadCandles]);

  // Redraw OI bars when data/profile changes
  useEffect(() => {
    lastDrawRef.current = ''; // Force redraw
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(redrawOI);
  }, [redrawOI]);

  // Update price line on spot change
  useEffect(() => {
    if (!candleSeriesRef.current || !spot) return;

    if (priceLineRef.current) {
      try { candleSeriesRef.current.removePriceLine(priceLineRef.current); } catch { /* ignore */ }
    }

    priceLineRef.current = candleSeriesRef.current.createPriceLine({
      price: spot.ltp,
      color: '#eab308',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: '',
    });

    const lastTime = Math.floor(Date.now() / 1000);
    try {
      candleSeriesRef.current.update({
        time: lastTime as any,
        open: spot.ltp - (spot.change > 0 ? 5 : -5),
        high: spot.high,
        low: spot.low,
        close: spot.ltp,
      });
    } catch { /* ignore sequential update errors */ }
  }, [spot?.ltp, spot?.high, spot?.low, spot?.change]);

  // Create overlay canvas element
  useEffect(() => {
    if (!containerRef.current) return;

    const existingCanvas = containerRef.current.querySelector('.oi-overlay-canvas');
    if (existingCanvas) {
      overlayCanvasRef.current = existingCanvas as HTMLCanvasElement;
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.className = 'oi-overlay-canvas';
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '10';

    containerRef.current.style.position = 'relative';
    containerRef.current.appendChild(canvas);
    overlayCanvasRef.current = canvas;

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(redrawOI);

    return () => {
      canvas.remove();
      overlayCanvasRef.current = null;
    };
  }, []);

  return (
    <div className="flex flex-col h-full">
      <ChartHeader
        underlying={underlying}
        spot={spot}
        oiProfile={oiProfile}
        onToggle={setOiProfile}
      />
      <div ref={containerRef} className="flex-1 min-h-0" />
    </div>
  );
}
