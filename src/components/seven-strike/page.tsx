'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { createChart, LineSeries, type IChartApi, type ISeriesApi } from 'lightweight-charts';
import { useTradingStore } from '@/store/trading-store';
import { fetchAPI, formatNumber, DARK_THEME } from '@/lib/chart-utils';
import {
  ArrowUp,
  ArrowDown,
  Zap,
  Activity,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  Clock,
  ShieldAlert,
  Volume2,
  Crosshair,
  X,
  CheckCircle2,
  AlertTriangle,
  Target,
  Flag,
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'framer-motion';

// ============ Types ============

interface SevenStrikeRow {
  strike: number;
  ce_coi: number;
  pe_coi: number;
  ce_oi: number;
  pe_oi: number;
}

interface SevenStrikeMatrix {
  underlying: string;
  expiry: string;
  spot_price: number;
  atm_strike: number;
  strike_step: number;
  window_strikes: number[];
  rows: SevenStrikeRow[];
  ce_coi_sum: number;
  pe_coi_sum: number;
  coi_pcr: number;
  state: string;
}

interface Signal {
  signal_type: string;
  confidence: number;
  reason: string;
  timestamp: number;
  spot_price: number;
  coi_pcr: number;
  volume_percent: number | null;
  gate_condition: string | null;
  pain_index: number | null;
}

interface SevenStrikeSignals {
  underlying: string;
  expiry: string;
  signals: Signal[];
  current_signal: Signal | null;
  gate_condition: string;
  state: string;
}

interface COIPCRPoint {
  timestamp: number;
  coi_pcr: number;
  spot: number;
  ce_coi_sum: number;
  pe_coi_sum: number;
  state: string;
  signal_type: string;
  confidence: number;
}

interface TradeSuggestion {
  id: string;
  signal_type: 'LONG' | 'SHORT';
  entry_price: number;
  stop_loss: number;
  target: number;
  risk_reward: string;
  confidence: number;
  reason: string;
  timestamp: number;
  spot_price: number;
  coi_pcr: number;
  status: 'ACTIVE' | 'HIT_TARGET' | 'HIT_SL' | 'EXPIRED' | 'CANCELLED';
  option_suggestion: string;
  exit_reason: string | null;
}

interface VolumeProxyPoint {
  timestamp: number;
  volume_percent: number;
  classification: 'NORMAL' | 'ELEVATED' | 'HIGH' | 'EXTREME';
  spot: number;
}

interface TrapCluster {
  id: string;
  price_high: number;
  price_low: number;
  timestamp_start: number;
  volume_trapped: number;
  direction: 'BULLISH_TRAP' | 'BEARISH_TRAP';
  pain_index: number;
  active: boolean;
  triggered: boolean;
}

interface SevenStrikeHistory {
  underlying: string;
  expiry: string;
  coi_pcr_series: COIPCRPoint[];
  volume_proxy_series: VolumeProxyPoint[];
  trap_clusters: TrapCluster[];
  signals: Signal[];
  trade_suggestions: TradeSuggestion[];
}

// ============ Helpers ============

function formatTimeHHMMSS(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatTimeShort(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function timeSince(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

function getStateStyle(state: string) {
  switch (state) {
    case 'ACTIVE':
      return { bg: 'bg-green-500/15 border-green-500/40', text: 'text-green-400', pulse: true };
    case 'ZONE_WATCH':
      return { bg: 'bg-yellow-500/15 border-yellow-500/40', text: 'text-yellow-400', pulse: false };
    case 'STABILIZING':
      return { bg: 'bg-orange-500/15 border-orange-500/40', text: 'text-orange-400', pulse: false };
    default:
      return { bg: 'bg-gray-500/15 border-gray-500/40', text: 'text-gray-400', pulse: false };
  }
}

function getSignalStyle(type: string) {
  switch (type) {
    case 'LONG':
      return { text: 'text-green-400', bg: 'bg-green-500/15', icon: TrendingUp };
    case 'SHORT':
      return { text: 'text-red-400', bg: 'bg-red-500/15', icon: TrendingDown };
    default:
      return { text: 'text-gray-400', bg: 'bg-gray-500/15', icon: Minus };
  }
}

function getConfidenceColor(confidence: number): string {
  if (confidence > 0.7) return '#22c55e';
  if (confidence > 0.4) return '#eab308';
  return '#ef4444';
}

function getVolumeClassification(cls: string) {
  switch (cls) {
    case 'EXTREME':
      return { bg: 'bg-red-500/20 border-red-500/40', text: 'text-red-400', badge: 'bg-red-600' };
    case 'HIGH':
      return { bg: 'bg-orange-500/20 border-orange-500/40', text: 'text-orange-400', badge: 'bg-orange-600' };
    case 'ELEVATED':
      return { bg: 'bg-yellow-500/20 border-yellow-500/40', text: 'text-yellow-400', badge: 'bg-yellow-600' };
    default:
      return { bg: 'bg-gray-500/15 border-gray-500/40', text: 'text-gray-400', badge: 'bg-gray-600' };
  }
}

// ============ Circular Progress Component ============

function CircularProgress({ value, size = 56, strokeWidth = 4, color }: { value: number; size?: number; strokeWidth?: number; color: string }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#1f2937" strokeWidth={strokeWidth} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-all duration-700"
      />
    </svg>
  );
}

// ============ PCR Bar Component ============

function PCRBar({ pcr }: { pcr: number }) {
  const clampedPcr = Math.min(Math.max(pcr, 0), 2);
  const percent = (clampedPcr / 2) * 100;

  return (
    <div className="relative h-2 w-full rounded-full bg-[#1f2937] overflow-hidden mt-1.5">
      {/* Red zone: 0-0.8 */}
      <div className="absolute left-0 top-0 h-full bg-red-500/30" style={{ width: '40%' }} />
      {/* Neutral zone: 0.8-1.2 */}
      <div className="absolute top-0 h-full bg-yellow-500/20" style={{ left: '40%', width: '20%' }} />
      {/* Green zone: 1.2-2.0 */}
      <div className="absolute top-0 h-full bg-green-500/30" style={{ left: '60%', width: '40%' }} />
      {/* Indicator */}
      <div
        className="absolute top-0 h-full w-0.5 bg-white shadow-lg shadow-white/50 transition-all duration-500"
        style={{ left: `${percent}%` }}
      />
      {/* Reference lines */}
      <div className="absolute top-0 h-full w-px bg-gray-500/40" style={{ left: '40%' }} />
      <div className="absolute top-0 h-full w-px bg-gray-500/40" style={{ left: '60%' }} />
    </div>
  );
}

// ============ Main Component ============

export default function SevenStrikePage() {
  const { underlying, expiry, setUnderlying, setExpiry, expiries, setExpiries } = useTradingStore();

  // Data state
  const [matrix, setMatrix] = useState<SevenStrikeMatrix | null>(null);
  const [signals, setSignals] = useState<SevenStrikeSignals | null>(null);
  const [history, setHistory] = useState<SevenStrikeHistory | null>(null);
  const [trades, setTrades] = useState<TradeSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<number>(Date.now());
  const [isLive, setIsLive] = useState(false);

  // Chart refs
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const pcrSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const spotSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  // Signal log ref for auto-scroll
  const signalLogRef = useRef<HTMLDivElement>(null);

  // Dismissed trades
  const [dismissedTrades, setDismissedTrades] = useState<Set<string>>(new Set());

  // ============ Fetch expiries ============
  useEffect(() => {
    (async () => {
      try {
        const data = await fetchAPI<{ underlying: string; expiries: Array<{ expiry_date: string }> }>(
          '/api/instruments/expiries',
          { underlying }
        );
        const exps = data.expiries.map((e) => e.expiry_date);
        setExpiries(exps);
        if (exps.length > 0 && !expiry) setExpiry(exps[0]);
      } catch (err) {
        console.error('Failed to fetch expiries:', err);
        // Fallback: set default expiry so page doesn't stay stuck loading
        if (!expiry) {
          const d = new Date();
          while (d.getDay() !== 4) d.setDate(d.getDate() + 1);
          const fallback = d.toISOString().split('T')[0];
          setExpiry(fallback);
          setExpiries([fallback]);
        }
      }
    })();
  }, [underlying, setExpiries, setExpiry, expiry]);

  // ============ Fetch all data ============
  const fetchData = useCallback(async () => {
    if (!expiry) {
      setLoading(false);
      return;
    }
    try {
      const [matrixData, signalsData, historyData, tradesData] = await Promise.all([
        fetchAPI<SevenStrikeMatrix>('/api/7strike/matrix', { underlying, expiry }).catch(() => null),
        fetchAPI<SevenStrikeSignals>('/api/7strike/signals', { underlying, expiry }).catch(() => null),
        fetchAPI<SevenStrikeHistory>('/api/7strike/history', { underlying, expiry }).catch(() => null),
        fetchAPI<TradeSuggestion[]>('/api/7strike/trades', { underlying, expiry }).catch(() => []),
      ]);
      if (matrixData) setMatrix(matrixData);
      if (signalsData) setSignals(signalsData);
      if (historyData) setHistory(historyData);
      if (tradesData) setTrades(tradesData);
      setLastUpdate(Date.now());
      setIsLive(!!matrixData);
    } catch (err) {
      console.error('Failed to fetch 7-Strike data:', err);
      setIsLive(false);
    } finally {
      setLoading(false);
    }
  }, [underlying, expiry]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh (3s polling)
  useEffect(() => {
    if (!autoRefresh || !expiry) return;
    const interval = setInterval(() => {
      fetchData();
    }, 3000);
    return () => clearInterval(interval);
  }, [autoRefresh, expiry, fetchData]);

  // ============ Create lightweight-charts instance ============
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      ...DARK_THEME,
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      rightPriceScale: {
        ...DARK_THEME.rightPriceScale,
        scaleMargins: { top: 0.1, bottom: 0.2 },
      },
      leftPriceScale: {
        visible: true,
        borderColor: '#1e222d',
        textColor: '#9ca3af',
        scaleMargins: { top: 0.1, bottom: 0.2 },
      },
    });

    const pcrSeries = chart.addSeries(LineSeries, {
      color: '#eab308',
      lineWidth: 2,
      priceScaleId: 'left',
      title: 'COI PCR',
    });

    const spotSeries = chart.addSeries(LineSeries, {
      color: '#3b82f6',
      lineWidth: 1,
      priceScaleId: 'right',
      lastValueVisible: false,
      priceLineVisible: false,
      title: 'Spot',
    });

    chartRef.current = chart;
    pcrSeriesRef.current = pcrSeries;
    spotSeriesRef.current = spotSeries;

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
      pcrSeriesRef.current = null;
      spotSeriesRef.current = null;
    };
  }, []);

  // ============ Update chart data ============
  useEffect(() => {
    if (!pcrSeriesRef.current || !spotSeriesRef.current || !history) return;

    const pcrData = history.coi_pcr_series.map((p) => ({
      time: Math.floor(p.timestamp / 1000) as unknown as import('lightweight-charts').UTCTimestamp,
      value: p.coi_pcr,
    }));

    const spotData = history.coi_pcr_series.map((p) => ({
      time: Math.floor(p.timestamp / 1000) as unknown as import('lightweight-charts').UTCTimestamp,
      value: p.spot,
    }));

    pcrSeriesRef.current.setData(pcrData);
    spotSeriesRef.current.setData(spotData);

    // Add markers at signal change points
    const markers = history.coi_pcr_series
      .filter((p, i, arr) => i === 0 || p.signal_type !== arr[i - 1].signal_type)
      .map((p) => ({
        time: Math.floor(p.timestamp / 1000) as unknown as import('lightweight-charts').UTCTimestamp,
        position: (p.signal_type === 'LONG' ? 'belowBar' : p.signal_type === 'SHORT' ? 'aboveBar' : 'inBar') as 'belowBar' | 'aboveBar' | 'inBar',
        color: p.signal_type === 'LONG' ? '#22c55e' : p.signal_type === 'SHORT' ? '#ef4444' : '#9ca3af',
        shape: (p.signal_type === 'LONG' ? 'arrowUp' : p.signal_type === 'SHORT' ? 'arrowDown' : 'circle') as 'arrowUp' | 'arrowDown' | 'circle',
        text: p.signal_type,
      }));

    pcrSeriesRef.current.setMarkers(markers);

    // Add PCR reference lines using priceLineSources
    const createPriceLine = (price: number, color: string, title: string) => {
      return pcrSeriesRef.current?.createPriceLine({
        price,
        color,
        lineWidth: 1 as const,
        lineStyle: 2 as const,
        axisLabelVisible: true,
        title,
      });
    };

    const lines = [
      createPriceLine(0.6, '#ef4444', 'Extreme Bear'),
      createPriceLine(0.8, '#f97316', 'Bearish'),
      createPriceLine(1.0, '#9ca3af', 'Neutral'),
      createPriceLine(1.2, '#22c55e', 'Bullish'),
      createPriceLine(1.5, '#15803d', 'Extreme Bull'),
    ];

    // Fit content
    chartRef.current?.timeScale().fitContent();

    return () => {
      lines.forEach((line) => {
        if (line) pcrSeriesRef.current?.removePriceLine(line);
      });
    };
  }, [history]);

  // ============ Auto-scroll signal log ============
  useEffect(() => {
    if (signalLogRef.current) {
      signalLogRef.current.scrollTop = signalLogRef.current.scrollHeight;
    }
  }, [signals]);

  // ============ Derived data ============
  const currentSignal = signals?.current_signal;
  const activeTrades = trades.filter((t) => t.status === 'ACTIVE' && !dismissedTrades.has(t.id));
  const currentVolume = history?.volume_proxy_series[history.volume_proxy_series.length - 1];
  const activeTrapClusters = history?.trap_clusters.filter((c) => c.active) || [];

  const stateStyle = getStateStyle(signals?.state || 'IDLE');
  const signalStyle = getSignalStyle(currentSignal?.signal_type || 'NEUTRAL');
  const SignalIcon = signalStyle.icon;

  const dismissTrade = (id: string) => {
    setDismissedTrades((prev) => new Set(prev).add(id));
  };

  const pcrValue = matrix?.coi_pcr ?? 0;

  // ============ Render ============

  if (loading && !matrix) {
    return (
      <div className="min-h-screen bg-[#0a0e17] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Activity className="h-10 w-10 text-yellow-500 animate-spin" />
          <span className="text-gray-400 text-sm">Loading 7-Strike System...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0e17] text-gray-200">
      {/* ============ HEADER ============ */}
      <header className="sticky top-0 z-50 bg-[#0a0e17]/95 backdrop-blur-sm border-b border-[#1f2937]">
        <div className="flex items-center justify-between px-3 py-2 gap-2">
          {/* Left: Logo */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-yellow-500 to-orange-600">
              <Zap className="h-4 w-4 text-white" />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-sm font-bold text-white leading-tight">7-Strike System</h1>
              <p className="text-[9px] text-gray-500 leading-tight">COI PCR Signal Engine</p>
            </div>
          </div>

          {/* Center: Underlying + Expiry */}
          <div className="flex items-center gap-2">
            {/* Underlying toggle */}
            <div className="flex items-center gap-0.5 rounded-md bg-[#111827] p-0.5 border border-[#1f2937]">
              {['NIFTY', 'BANKNIFTY'].map((sym) => (
                <button
                  key={sym}
                  onClick={() => setUnderlying(sym)}
                  className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-all ${
                    underlying === sym
                      ? 'bg-yellow-600 text-white shadow-sm'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {sym === 'BANKNIFTY' ? 'BNF' : sym}
                </button>
              ))}
            </div>

            {/* Expiry select */}
            <Select value={expiry} onValueChange={setExpiry}>
              <SelectTrigger className="h-7 w-[130px] text-[11px] bg-[#111827] border-[#1f2937] text-gray-300">
                <SelectValue placeholder="Expiry" />
              </SelectTrigger>
              <SelectContent className="bg-[#111827] border-[#1f2937]">
                {expiries.map((exp) => (
                  <SelectItem key={exp} value={exp} className="text-[11px] text-gray-300 focus:bg-[#1f2937] focus:text-white">
                    {new Date(exp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Right: Controls */}
          <div className="flex items-center gap-3">
            {/* Mode indicator */}
            <div className="hidden md:flex items-center gap-1.5">
              <div className={`h-1.5 w-1.5 rounded-full ${isLive ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`} />
              <span className="text-[10px] font-medium text-gray-400">
                {isLive ? 'LIVE' : 'SIMULATED'}
              </span>
            </div>

            {/* Auto-refresh */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-500 hidden sm:inline">Auto</span>
              <Switch
                checked={autoRefresh}
                onCheckedChange={setAutoRefresh}
                className="data-[state=checked]:bg-yellow-600"
              />
            </div>

            {/* Last update */}
            <div className="hidden lg:flex items-center gap-1 text-[10px] text-gray-500">
              <Clock className="h-3 w-3" />
              {formatTimeHHMMSS(lastUpdate)}
            </div>
          </div>
        </div>
      </header>

      {/* ============ MAIN CONTENT ============ */}
      <div className="p-2 sm:p-3">
        {/* Top Section: Chart + Right Panel */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-2 sm:gap-3 mb-2 sm:mb-3">
          {/* LEFT: COI PCR Chart (3/5) */}
          <div className="lg:col-span-3 rounded-lg border border-[#1f2937] bg-[#111827] overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1f2937]">
              <div className="flex items-center gap-2">
                <Crosshair className="h-3.5 w-3.5 text-yellow-500" />
                <span className="text-xs font-semibold text-white">COI PCR Chart</span>
              </div>
              <div className="flex items-center gap-3 text-[10px]">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-yellow-500" />
                  PCR
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-blue-500" />
                  Spot
                </span>
              </div>
            </div>
            <div
              ref={chartContainerRef}
              className="w-full"
              style={{ height: '340px' }}
            />
          </div>

          {/* RIGHT: Signal Dashboard + Trade Assistant + Signal Log (2/5) */}
          <div className="lg:col-span-2 flex flex-col gap-2 sm:gap-3">
            {/* Signal Dashboard - 4 cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4 gap-2">
              {/* State Card */}
              <motion.div
                className={`rounded-lg border p-2.5 ${stateStyle.bg}`}
                animate={stateStyle.pulse ? { opacity: [1, 0.7, 1] } : {}}
                transition={stateStyle.pulse ? { duration: 2, repeat: Infinity } : {}}
              >
                <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-0.5">State</div>
                <div className={`text-base font-bold ${stateStyle.text}`}>
                  {signals?.state || 'IDLE'}
                </div>
              </motion.div>

              {/* Signal Card */}
              <div className="rounded-lg border border-[#1f2937] bg-[#111827] p-2.5">
                <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-0.5">Signal</div>
                <div className="flex items-center gap-1.5">
                  <SignalIcon className={`h-4 w-4 ${signalStyle.text}`} />
                  <span className={`text-base font-bold ${signalStyle.text}`}>
                    {currentSignal?.signal_type || 'NEUTRAL'}
                  </span>
                </div>
                {signals?.gate_condition && signals.gate_condition !== 'NONE' && (
                  <div className={`text-[9px] mt-0.5 font-medium ${signals.gate_condition === 'LONG' ? 'text-green-400' : signals.gate_condition === 'SHORT' ? 'text-red-400' : 'text-gray-500'}`}>
                    Gate: {signals.gate_condition}
                  </div>
                )}
              </div>

              {/* COI PCR Card */}
              <div className="rounded-lg border border-[#1f2937] bg-[#111827] p-2.5">
                <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-0.5">COI PCR</div>
                <div className="text-base font-bold text-white">
                  {matrix ? pcrValue.toFixed(3) : '-'}
                </div>
                <div className="text-[9px] text-gray-500">
                  CE: {formatNumber(matrix?.ce_coi_sum ?? 0)} | PE: {formatNumber(matrix?.pe_coi_sum ?? 0)}
                </div>
                {matrix && <PCRBar pcr={pcrValue} />}
              </div>

              {/* Confidence Card */}
              <div className="rounded-lg border border-[#1f2937] bg-[#111827] p-2.5">
                <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-0.5">Confidence</div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <CircularProgress
                      value={currentSignal ? currentSignal.confidence * 100 : 0}
                      size={36}
                      strokeWidth={3}
                      color={currentSignal ? getConfidenceColor(currentSignal.confidence) : '#374151'}
                    />
                    <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-white">
                      {currentSignal ? `${Math.round(currentSignal.confidence * 100)}` : '-'}
                    </span>
                  </div>
                  <span className={`text-sm font-bold ${currentSignal ? (currentSignal.confidence > 0.7 ? 'text-green-400' : currentSignal.confidence > 0.4 ? 'text-yellow-400' : 'text-red-400') : 'text-gray-500'}`}>
                    {currentSignal ? `${(currentSignal.confidence * 100).toFixed(1)}%` : 'N/A'}
                  </span>
                </div>
              </div>
            </div>

            {/* Trade Assistant Panel */}
            <div className="rounded-lg border border-[#1f2937] bg-[#111827] overflow-hidden flex-1 min-h-0">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1f2937]">
                <div className="flex items-center gap-2">
                  <Target className="h-3.5 w-3.5 text-yellow-500" />
                  <span className="text-xs font-semibold text-white">Trade Assistant</span>
                </div>
                {activeTrades.length > 0 && (
                  <Badge className="bg-yellow-600/20 text-yellow-400 border-yellow-600/30 text-[9px] h-4 px-1.5">
                    {activeTrades.length} active
                  </Badge>
                )}
              </div>
              <div className="max-h-[220px] overflow-y-auto custom-scrollbar">
                {activeTrades.length > 0 ? (
                  <div className="divide-y divide-[#1f2937]">
                    <AnimatePresence>
                      {activeTrades.map((trade) => {
                        const isLong = trade.signal_type === 'LONG';
                        return (
                          <motion.div
                            key={trade.id}
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, x: 20 }}
                            className="p-2.5"
                          >
                            {/* Trade header */}
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex items-center gap-1.5">
                                <Badge className={`text-[9px] h-4 px-1.5 ${isLong ? 'bg-green-600/20 text-green-400 border-green-600/30' : 'bg-red-600/20 text-red-400 border-red-600/30'}`}>
                                  {trade.signal_type}
                                </Badge>
                                <span className="text-[10px] text-gray-300 font-medium">{trade.option_suggestion}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => dismissTrade(trade.id)}
                                  className="h-5 w-5 rounded flex items-center justify-center hover:bg-[#1f2937] text-gray-500 hover:text-gray-300 transition-colors"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            </div>

                            {/* Trade details */}
                            <div className="grid grid-cols-4 gap-1.5 mb-1.5">
                              <div>
                                <div className="text-[8px] text-gray-500 uppercase">Entry</div>
                                <div className="text-[11px] font-semibold text-white">{trade.entry_price.toFixed(1)}</div>
                              </div>
                              <div>
                                <div className="text-[8px] text-gray-500 uppercase">SL</div>
                                <div className="text-[11px] font-semibold text-red-400">{trade.stop_loss.toFixed(1)}</div>
                              </div>
                              <div>
                                <div className="text-[8px] text-gray-500 uppercase">Target</div>
                                <div className="text-[11px] font-semibold text-green-400">{trade.target.toFixed(1)}</div>
                              </div>
                              <div>
                                <div className="text-[8px] text-gray-500 uppercase">R:R</div>
                                <div className="text-[11px] font-semibold text-yellow-400">{trade.risk_reward}</div>
                              </div>
                            </div>

                            {/* Reason + confidence */}
                            <div className="flex items-center justify-between">
                              <div className="text-[9px] text-gray-500 flex-1 mr-2 truncate" title={trade.reason}>
                                {trade.reason}
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[9px] text-gray-400">
                                  {Math.round(trade.confidence * 100)}%
                                </span>
                                <button className="h-5 px-2 rounded text-[9px] font-semibold bg-yellow-600 hover:bg-yellow-500 text-white transition-colors">
                                  Take Trade
                                </button>
                              </div>
                            </div>
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-gray-500">
                    <Activity className="h-6 w-6 mb-2 animate-pulse text-gray-600" />
                    <span className="text-[11px]">Waiting for signal...</span>
                    <span className="text-[9px] text-gray-600 mt-0.5">Trade suggestions will appear here</span>
                  </div>
                )}
              </div>
            </div>

            {/* Signal Log */}
            <div className="rounded-lg border border-[#1f2937] bg-[#111827] overflow-hidden flex-1 min-h-0">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1f2937]">
                <div className="flex items-center gap-2">
                  <Flag className="h-3.5 w-3.5 text-yellow-500" />
                  <span className="text-xs font-semibold text-white">Signal Log</span>
                </div>
                {signals && signals.signals.length > 0 && (
                  <span className="text-[9px] text-gray-500">{signals.signals.length} signals</span>
                )}
              </div>
              <div
                ref={signalLogRef}
                className="max-h-[180px] overflow-y-auto custom-scrollbar"
              >
                {signals && signals.signals.length > 0 ? (
                  <div className="divide-y divide-[#1e222d]">
                    {signals.signals.slice(-20).reverse().map((sig, idx) => {
                      const sigStyle = getSignalStyle(sig.signal_type);
                      return (
                        <div key={idx} className="flex items-center gap-2 px-3 py-1.5">
                          <span className={`h-2 w-2 rounded-full shrink-0 ${
                            sig.signal_type === 'LONG' ? 'bg-green-400' :
                            sig.signal_type === 'SHORT' ? 'bg-red-400' : 'bg-gray-400'
                          }`} />
                          <span className="text-[9px] text-gray-600 w-14 shrink-0">
                            {formatTimeHHMMSS(sig.timestamp)}
                          </span>
                          <span className={`text-[10px] font-semibold w-12 ${sigStyle.text}`}>
                            {sig.signal_type}
                          </span>
                          <span className="text-[10px] text-gray-400 w-12">
                            PCR {sig.coi_pcr.toFixed(2)}
                          </span>
                          <span className="text-[10px] text-gray-500 w-10">
                            {Math.round(sig.confidence * 100)}%
                          </span>
                          <span className="text-[9px] text-gray-600 flex-1 truncate" title={sig.reason}>
                            {sig.reason}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="py-6 text-center text-[11px] text-gray-600">No signals yet</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Section: Matrix + Trap Clusters + Volume */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-2 sm:gap-3">
          {/* 7-Strike Matrix Table (3/4) */}
          <div className="lg:col-span-3 rounded-lg border border-[#1f2937] bg-[#111827] overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1f2937]">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-3.5 w-3.5 text-yellow-500" />
                <span className="text-xs font-semibold text-white">7-Strike Window</span>
              </div>
              {matrix && (
                <div className="flex items-center gap-3 text-[10px]">
                  <span className="text-gray-500">Spot: <span className="text-white font-semibold">{matrix.spot_price.toFixed(2)}</span></span>
                  <span className="text-gray-500">ATM: <span className="text-yellow-400 font-semibold">{matrix.atm_strike}</span></span>
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-[#1f2937]">
                    <th className="text-center px-3 py-1.5 text-gray-500 font-medium">Strike</th>
                    <th className="text-right px-3 py-1.5 text-gray-500 font-medium">CE COI</th>
                    <th className="text-right px-3 py-1.5 text-gray-500 font-medium">PE COI</th>
                    <th className="text-right px-3 py-1.5 text-gray-500 font-medium">CE OI</th>
                    <th className="text-right px-3 py-1.5 text-gray-500 font-medium">PE OI</th>
                    <th className="text-center px-3 py-1.5 text-gray-500 font-medium">Bias</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix?.rows.map((row) => {
                    const isATM = row.strike === matrix.atm_strike;
                    const peBias = row.pe_coi > row.ce_coi;
                    return (
                      <tr
                        key={row.strike}
                        className={`border-b border-[#1e222d] ${isATM ? 'bg-yellow-500/10' : ''}`}
                      >
                        <td className={`text-center px-3 py-1.5 font-semibold ${isATM ? 'text-yellow-400' : 'text-white'}`}>
                          {row.strike}
                          {isATM && <span className="ml-1 text-[8px] text-yellow-500">ATM</span>}
                        </td>
                        <td className="text-right px-3 py-1.5 text-red-400">{formatNumber(row.ce_coi)}</td>
                        <td className="text-right px-3 py-1.5 text-green-400">{formatNumber(row.pe_coi)}</td>
                        <td className="text-right px-3 py-1.5 text-gray-300">{formatNumber(row.ce_oi)}</td>
                        <td className="text-right px-3 py-1.5 text-gray-300">{formatNumber(row.pe_oi)}</td>
                        <td className="text-center px-3 py-1.5">
                          {peBias ? (
                            <ArrowUp className="h-3.5 w-3.5 text-green-400 inline" />
                          ) : (
                            <ArrowDown className="h-3.5 w-3.5 text-red-400 inline" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-[#1f2937] bg-[#0d1117]">
                    <td className="text-center px-3 py-1.5 font-semibold text-gray-400">SUM</td>
                    <td className="text-right px-3 py-1.5 font-semibold text-red-400">
                      {matrix ? formatNumber(matrix.ce_coi_sum) : '-'}
                    </td>
                    <td className="text-right px-3 py-1.5 font-semibold text-green-400">
                      {matrix ? formatNumber(matrix.pe_coi_sum) : '-'}
                    </td>
                    <td colSpan={2} />
                    <td className="text-center px-3 py-1.5">
                      <span className={`font-bold text-sm ${
                        matrix ? (matrix.coi_pcr > 1.2 ? 'text-green-400' : matrix.coi_pcr < 0.8 ? 'text-red-400' : 'text-yellow-400') : 'text-gray-400'
                      }`}>
                        {matrix ? matrix.coi_pcr.toFixed(3) : '-'}
                      </span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Right panels: Trap Clusters + Volume Proxy (1/4) */}
          <div className="flex flex-col gap-2 sm:gap-3">
            {/* Trap Clusters */}
            <div className="rounded-lg border border-[#1f2937] bg-[#111827] overflow-hidden flex-1">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1f2937]">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />
                  <span className="text-xs font-semibold text-white">Trap Clusters</span>
                </div>
                {activeTrapClusters.length > 0 && (
                  <Badge className="bg-orange-600/20 text-orange-400 border-orange-600/30 text-[9px] h-4 px-1.5">
                    {activeTrapClusters.length}
                  </Badge>
                )}
              </div>
              <div className="max-h-[180px] overflow-y-auto custom-scrollbar">
                {activeTrapClusters.length > 0 ? (
                  <div className="divide-y divide-[#1e222d]">
                    {activeTrapClusters.map((cluster) => {
                      const isBullish = cluster.direction === 'BULLISH_TRAP';
                      return (
                        <div key={cluster.id} className="px-3 py-2">
                          <div className="flex items-center justify-between mb-1">
                            <Badge className={`text-[9px] h-4 px-1.5 ${isBullish ? 'bg-red-600/20 text-red-400 border-red-600/30' : 'bg-green-600/20 text-green-400 border-green-600/30'}`}>
                              {isBullish ? 'BULL TRAP' : 'BEAR TRAP'}
                            </Badge>
                            <span className="text-[9px] text-gray-500">{timeSince(cluster.timestamp_start)}</span>
                          </div>
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-gray-400">
                              {cluster.price_low.toFixed(0)} - {cluster.price_high.toFixed(0)}
                            </span>
                            <span className="text-gray-500">
                              Vol: {formatNumber(cluster.volume_trapped)}
                            </span>
                          </div>
                          {/* Pain index bar */}
                          <div className="mt-1.5">
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-[8px] text-gray-500 uppercase">Pain Index</span>
                              <span className={`text-[9px] font-semibold ${cluster.pain_index > 3 ? 'text-red-400' : cluster.pain_index > 1.5 ? 'text-orange-400' : 'text-yellow-400'}`}>
                                {cluster.pain_index.toFixed(1)} / 5
                              </span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-[#1f2937] overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${cluster.pain_index > 3 ? 'bg-red-500' : cluster.pain_index > 1.5 ? 'bg-orange-500' : 'bg-yellow-500'}`}
                                style={{ width: `${Math.min((cluster.pain_index / 5) * 100, 100)}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="py-6 text-center text-[11px] text-gray-600">No active traps</div>
                )}
              </div>
            </div>

            {/* Volume Proxy */}
            <div className="rounded-lg border border-[#1f2937] bg-[#111827] overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1f2937]">
                <div className="flex items-center gap-2">
                  <Volume2 className="h-3.5 w-3.5 text-blue-500" />
                  <span className="text-xs font-semibold text-white">Volume Proxy</span>
                </div>
              </div>
              <div className="p-3">
                {currentVolume ? (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] text-gray-500">Classification</span>
                      <Badge className={`text-[9px] h-5 px-2 ${getVolumeClassification(currentVolume.classification).bg} ${getVolumeClassification(currentVolume.classification).text} border`}>
                        {currentVolume.classification}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] text-gray-500">Volume %</span>
                      <span className={`text-lg font-bold ${
                        currentVolume.classification === 'EXTREME' ? 'text-red-400' :
                        currentVolume.classification === 'HIGH' ? 'text-orange-400' :
                        currentVolume.classification === 'ELEVATED' ? 'text-yellow-400' : 'text-gray-300'
                      }`}>
                        {currentVolume.volume_percent.toFixed(1)}x
                      </span>
                    </div>
                    {/* Volume bar visualization */}
                    <div className="h-2 w-full rounded-full bg-[#1f2937] overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          currentVolume.classification === 'EXTREME' ? 'bg-red-500' :
                          currentVolume.classification === 'HIGH' ? 'bg-orange-500' :
                          currentVolume.classification === 'ELEVATED' ? 'bg-yellow-500' : 'bg-gray-500'
                        }`}
                        style={{ width: `${Math.min((currentVolume.volume_percent / 6) * 100, 100)}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[8px] text-gray-600">0x</span>
                      <span className="text-[8px] text-gray-600">3x</span>
                      <span className="text-[8px] text-gray-600">6x</span>
                    </div>
                  </>
                ) : (
                  <div className="py-3 text-center text-[11px] text-gray-600">No data</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
