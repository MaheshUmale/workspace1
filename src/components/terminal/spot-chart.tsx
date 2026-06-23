'use client';

import { useEffect, useRef, useCallback, memo, useState } from 'react';
import { createChart, type IChartApi, type ISeriesApi, LineStyle } from 'lightweight-charts';
import { Plus, Minus, Maximize2 } from 'lucide-react';
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

  ctx.strokeStyle = CENTER_DIVIDER_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(centerX, 0);
  ctx.lineTo(centerX, canvasHeight);
  ctx.stroke();

  for (const v of visibleValues) {
    const y = v.y!;
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

    if (v.strike === atmStrike) {
      ctx.strokeStyle = ATM_STROKE_COLOR;
      ctx.lineWidth = 1;
      ctx.strokeRect(centerX - ceBarWidth - 1, y - BAR_HEIGHT / 2 - 1, ceBarWidth + peBarWidth + 2, BAR_HEIGHT + 2);
    }
  }

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
  spot: any;
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
  const priceLineRef = useRef<any>(null);
  const rafRef = useRef<number>(0);
  const redrawIntervalRef = useRef<any>(null);
  const lastDrawRef = useRef<string>('');
  const lastUnderlyingRef = useRef<string>('');
  const lastTimeframeRef = useRef<string>('');
  const [isAutoFit, setIsAutoFit] = useState(true);

  const { underlying, spotData, timeframe, atmStrike, optionChain, oiProfile, setOiProfile } = useTradingStore();
  const spot = spotData[underlying];
  const { fetchCandles } = useMarketData();

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

    const logicalRange = chartRef.current.timeScale().getVisibleLogicalRange();
    const rangeHash = logicalRange ? `${logicalRange.from}-${logicalRange.to}` : '';
    const dataHash = `${optionChain.length}-${atmStrike}-${oiProfile}-${rect.width}-${rect.height}-${rangeHash}`;
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

    redrawIntervalRef.current = setInterval(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(redrawOI);
    }, 100);

    return () => {
      if (redrawIntervalRef.current) clearInterval(redrawIntervalRef.current);
      resizeObserver.disconnect();
      cancelAnimationFrame(rafRef.current);
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  const loadCandles = useCallback(async () => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;

    console.log(`[SpotChart] Loading candles for ${underlying} @ ${timeframe}`);
    const candles = await fetchCandles(underlying, timeframe);
    if (!candles || candles.length === 0) {
      console.log(`[SpotChart] No candles returned for ${underlying} @ ${timeframe}`);
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

    const isNewUnderlying = underlying !== lastUnderlyingRef.current;
    const isNewTimeframe = timeframe !== lastTimeframeRef.current;
    if (isAutoFit || isNewUnderlying || isNewTimeframe) {
      console.log(`[SpotChart] Fitting content (isAutoFit=${isAutoFit}, isNewUnderlying=${isNewUnderlying}, isNewTimeframe=${isNewTimeframe})`);
      chartRef.current?.timeScale().fitContent();
      lastUnderlyingRef.current = underlying;
      lastTimeframeRef.current = timeframe;
    }

    setTimeout(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(redrawOI);
    }, 250);
  }, [underlying, timeframe, fetchCandles, redrawOI, isAutoFit]);

  useEffect(() => {
    loadCandles();
  }, [loadCandles]);

  useEffect(() => {
    lastDrawRef.current = '';
    const raf = requestAnimationFrame(redrawOI);
    return () => cancelAnimationFrame(raf);
  }, [redrawOI, optionChain, atmStrike, oiProfile]);

  useEffect(() => {
    if (!candleSeriesRef.current || !spot) return;

    if (priceLineRef.current) {
      try { candleSeriesRef.current.removePriceLine(priceLineRef.current); } catch { }
    }

    priceLineRef.current = candleSeriesRef.current.createPriceLine({
      price: spot.ltp,
      color: '#eab308',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: '',
    });

    const tfSeconds = timeframe === '1h' ? 3600 : parseInt(timeframe) * 60;
    const now = Math.floor(Date.now() / 1000);
    const alignedTime = Math.floor(now / tfSeconds) * tfSeconds;

    try {
      candleSeriesRef.current.update({
        time: alignedTime as any,
        open: spot.ltp - (spot.change > 0 ? 5 : -5),
        high: spot.high,
        low: spot.low,
        close: spot.ltp,
      });
    } catch { }
  }, [spot?.ltp, spot?.high, spot?.low, spot?.change, timeframe]);

  return (
    <div className="flex flex-col h-full">
      <ChartHeader
        underlying={underlying}
        spot={spot}
        oiProfile={oiProfile}
        onToggle={setOiProfile}
      />
      <div className="flex-1 min-h-0 relative">
        <div ref={containerRef} className="w-full h-full" />

        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none z-10"
        />

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
