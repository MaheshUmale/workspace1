'use client';

import { useEffect, useRef, useCallback } from 'react';
import { createChart, type IChartApi, type ISeriesApi, LineStyle } from 'lightweight-charts';
import { useTradingStore, type OIProfile, type OptionChainRow } from '@/store/trading-store';
import { TimeframeSelector } from './timeframe-selector';
import { DARK_THEME, CANDLE_COLORS, formatNumber, addCandlestickSeries, addHistogramSeries } from '@/lib/chart-utils';
import { useMarketData } from '@/hooks/use-market-data';

// ============ OI Bar Drawing ============

interface OIDrawParams {
  ctx: CanvasRenderingContext2D;
  series: ISeriesApi<'Candlestick'>;
  optionChain: OptionChainRow[];
  atmStrike: number;
  oiProfile: OIProfile;
  canvasWidth: number;
  canvasHeight: number;
}

function drawOIBars({ ctx, series, optionChain, atmStrike, oiProfile, canvasWidth, canvasHeight }: OIDrawParams) {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  if (!optionChain.length || canvasWidth === 0 || canvasHeight === 0) return;

  // Filter strikes near ATM (±15 strikes)
  const step = atmStrike % 100 === 0 ? 100 : 50;
  const minStrike = atmStrike - step * 15;
  const maxStrike = atmStrike + step * 15;
  const visibleChain = optionChain.filter(
    (r) => r.strike >= minStrike && r.strike <= maxStrike
  );

  if (!visibleChain.length) return;

  // Compute values based on profile
  const values = visibleChain.map((r) => {
    const ceVal = oiProfile === 'OI' ? r.ce_oi : Math.abs(r.ce_change_oi);
    const peVal = oiProfile === 'OI' ? r.pe_oi : Math.abs(r.pe_change_oi);
    return { strike: r.strike, ceVal, peVal, ceChangeOi: r.ce_change_oi, peChangeOi: r.pe_change_oi };
  });

  const maxVal = Math.max(...values.flatMap((v) => [v.ceVal, v.peVal]), 1);

  // Bar layout constants
  const maxBarPixels = canvasWidth * 0.35; // max bar width = 35% of chart
  const barHeight = 14;
  const centerX = canvasWidth * 0.55; // center divider at 55% from left

  // Draw center divider line
  ctx.strokeStyle = 'rgba(107, 114, 128, 0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(centerX, 0);
  ctx.lineTo(centerX, canvasHeight);
  ctx.stroke();

  for (const v of values) {
    // Get Y coordinate for this strike price using the candlestick series
    // This is the KEY: priceToCoordinate maps price to pixel based on current visible Y range
    const y = series.priceToCoordinate(v.strike);
    if (y === null) continue; // strike is outside visible price range

    // CE bar (red/orange) extending to the LEFT from center
    const ceBarWidth = (v.ceVal / maxVal) * maxBarPixels;
    if (ceBarWidth > 0) {
      // Determine if CE COI is negative (use lighter color)
      const isCeNegative = oiProfile === 'COI' && v.ceChangeOi < 0;
      ctx.fillStyle = isCeNegative ? 'rgba(249, 115, 22, 0.35)' : 'rgba(239, 68, 68, 0.45)';
      ctx.fillRect(centerX - ceBarWidth, y - barHeight / 2, ceBarWidth, barHeight);

      // Draw value label
      if (ceBarWidth > 30) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.font = '9px monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const labelVal = oiProfile === 'OI' ? v.ceVal : v.ceChangeOi;
        ctx.fillText(formatNumber(labelVal), centerX - 4, y);
      }
    }

    // PE bar (green) extending to the RIGHT from center
    const peBarWidth = (v.peVal / maxVal) * maxBarPixels;
    if (peBarWidth > 0) {
      const isPeNegative = oiProfile === 'COI' && v.peChangeOi < 0;
      ctx.fillStyle = isPeNegative ? 'rgba(34, 197, 94, 0.25)' : 'rgba(34, 197, 94, 0.45)';
      ctx.fillRect(centerX, y - barHeight / 2, peBarWidth, barHeight);

      // Draw value label
      if (peBarWidth > 30) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.font = '9px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const labelVal = oiProfile === 'OI' ? v.peVal : v.peChangeOi;
        ctx.fillText(formatNumber(labelVal), centerX + 4, y);
      }
    }

    // Highlight ATM strike
    if (v.strike === atmStrike) {
      ctx.strokeStyle = 'rgba(234, 179, 8, 0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(centerX - ceBarWidth - 1, y - barHeight / 2 - 1, ceBarWidth + peBarWidth + 2, barHeight + 2);
    }
  }

  // Draw profile label
  ctx.fillStyle = 'rgba(156, 163, 175, 0.7)';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(oiProfile === 'OI' ? 'Open Interest' : 'Change OI', centerX - maxBarPixels, 8);

  // Draw CE/PE legend
  const legendY = 22;
  const legendX = centerX - maxBarPixels;

  ctx.fillStyle = 'rgba(239, 68, 68, 0.7)';
  ctx.fillRect(legendX, legendY, 10, 10);
  ctx.fillStyle = 'rgba(156, 163, 175, 0.7)';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('CE', legendX + 14, legendY + 8);

  ctx.fillStyle = 'rgba(34, 197, 94, 0.7)';
  ctx.fillRect(legendX + 38, legendY, 10, 10);
  ctx.fillStyle = 'rgba(156, 163, 175, 0.7)';
  ctx.fillText('PE', legendX + 52, legendY + 8);
}

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

  const { underlying, spotData, timeframe, atmStrike, optionChain, oiProfile, setOiProfile } = useTradingStore();
  const spot = spotData[underlying];
  const { fetchCandles } = useMarketData();

  // Redraw OI bars overlay
  const redrawOI = useCallback(() => {
    if (!chartRef.current || !candleSeriesRef.current || !overlayCanvasRef.current) return;
    const canvas = overlayCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Ensure canvas dimensions match parent
    const rect = canvas.parentElement?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;

    const dpr = window.devicePixelRatio || 1;

    // Only resize canvas if dimensions changed (avoid unnecessary clears)
    const targetWidth = Math.round(rect.width * dpr);
    const targetHeight = Math.round(rect.height * dpr);
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

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

    // Subscribe to visible time range changes (X-axis zoom/pan)
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => redrawOI());
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    // Bug 1 FIX: Start a continuous redraw loop for the OI overlay.
    // lightweight-charts v5 IPriceScaleApi does NOT have subscribeVisibleLogicalRangeChange,
    // so we cannot subscribe to Y-axis zoom/pan changes. Instead, we use a periodic
    // redraw (every 100ms / 10fps) that keeps the OI bars in sync with the current
    // chart viewport. The drawOIBars function uses priceToCoordinate() which respects
    // the current Y-axis range, so this automatically scales with zoom/pan.
    redrawIntervalRef.current = setInterval(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => redrawOI());
    }, 100);

    return () => {
      // Clean up redraw interval
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
  }, []); // Only create chart once

  // Load historical data
  const loadCandles = useCallback(async () => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;

    const candles = await fetchCandles(underlying, timeframe);
    if (candles.length === 0) return;

    const sorted = [...candles].sort((a, b) => a.time - b.time);

    candleSeriesRef.current.setData(
      sorted.map((c) => ({
        time: c.time as any, // UTCTimestamp cast for lightweight-charts
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

    // Bug 4 FIX: After fitContent() rescales the chart, the OI overlay needs to be
    // redrawn. The periodic redraw loop (Bug 1 fix) will handle this, but we also
    // explicitly trigger a redraw after a short delay to ensure it's immediate.
    setTimeout(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => redrawOI());
    }, 100);
    setTimeout(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => redrawOI());
    }, 300);
  }, [underlying, timeframe, fetchCandles, redrawOI]);

  useEffect(() => {
    loadCandles();
  }, [loadCandles]);

  // Redraw OI bars when data/profile changes
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => redrawOI());
  }, [redrawOI]);

  // Update price line on spot change
  useEffect(() => {
    if (!candleSeriesRef.current || !spot) return;

    // Remove old price line
    if (priceLineRef.current) {
      try {
        candleSeriesRef.current.removePriceLine(priceLineRef.current);
      } catch {
        // Price line may have already been removed
      }
    }

    // Add new price line
    priceLineRef.current = candleSeriesRef.current.createPriceLine({
      price: spot.ltp,
      color: '#eab308',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: '',
    });

    // Real-time update last candle
    const lastTime = Math.floor(Date.now() / 1000);
    try {
      candleSeriesRef.current.update({
        time: lastTime as any,
        open: spot.ltp - (spot.change > 0 ? 5 : -5),
        high: spot.high,
        low: spot.low,
        close: spot.ltp,
      });
    } catch {
      // Update may fail if time is not sequential
    }
  }, [spot?.ltp]);

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

    // Initial draw after canvas is mounted
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => redrawOI());

    return () => {
      canvas.remove();
      overlayCanvasRef.current = null;
    };
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
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
          {/* OI Profile Toggle */}
          <div className="flex items-center bg-[#111827] rounded border border-[#1f2937] overflow-hidden">
            <button
              onClick={() => setOiProfile('COI')}
              className={`px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                oiProfile === 'COI'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              COI
            </button>
            <button
              onClick={() => setOiProfile('OI')}
              className={`px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                oiProfile === 'OI'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              OI
            </button>
          </div>
          <TimeframeSelector compact />
        </div>
      </div>

      {/* Chart container */}
      <div ref={containerRef} className="flex-1 min-h-0" />
    </div>
  );
}
