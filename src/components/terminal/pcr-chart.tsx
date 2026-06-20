'use client';

import { useMemo, useRef, useEffect } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  ReferenceLine,
} from 'recharts';
import { useTradingStore } from '@/store/trading-store';
import { formatNumber } from '@/lib/chart-utils';

export function PCRChart() {
  const { pcrHistory, currentPCR, currentChangePCR } = useTradingStore();

  // Prepare chart data
  const chartData = useMemo(() => {
    return pcrHistory.slice(-100).map((point) => ({
      time: new Date(point.timestamp).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }),
      spot: point.spot,
      pcr: point.pcr,
      change_pcr: point.change_pcr,
    }));
  }, [pcrHistory]);

  const pcrColor = currentChangePCR >= 0 ? '#22c55e' : '#ef4444';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1f2937] shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
            Spot vs PCR vs Chg PCR
          </span>
          <span className="text-xs font-bold text-white">
            PCR: {currentPCR.toFixed(3)}
          </span>
          <span className={`text-[10px] font-medium ${pcrColor}`}>
            {currentChangePCR >= 0 ? '+' : ''}{currentChangePCR.toFixed(4)}
          </span>
        </div>
      </div>

      {/* Charts - stacked */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Spot line chart - top */}
        <div className="flex-[2] min-h-0 border-b border-[#1e222d]">
          <div className="px-2 py-0.5">
            <span className="text-[9px] text-gray-500 font-medium">SPOT</span>
          </div>
          <div className="h-[calc(100%-20px)]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 2, right: 5, bottom: 2, left: 5 }}>
                <XAxis dataKey="time" hide />
                <YAxis
                  domain={['auto', 'auto']}
                  tick={{ fill: '#9ca3af', fontSize: 9 }}
                  axisLine={false}
                  tickLine={false}
                  width={45}
                />
                <Line
                  type="monotone"
                  dataKey="spot"
                  stroke="#eab308"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* PCR line chart - middle */}
        <div className="flex-[2] min-h-0 border-b border-[#1e222d]">
          <div className="px-2 py-0.5">
            <span className="text-[9px] text-gray-500 font-medium">PCR</span>
          </div>
          <div className="h-[calc(100%-20px)]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 2, right: 5, bottom: 2, left: 5 }}>
                <XAxis dataKey="time" hide />
                <YAxis
                  domain={['auto', 'auto']}
                  tick={{ fill: '#9ca3af', fontSize: 9 }}
                  axisLine={false}
                  tickLine={false}
                  width={45}
                />
                <ReferenceLine y={1} stroke="#4b5563" strokeDasharray="3 3" />
                <Line
                  type="monotone"
                  dataKey="pcr"
                  stroke="#3b82f6"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Change PCR bar chart - bottom */}
        <div className="flex-[1.5] min-h-0">
          <div className="px-2 py-0.5">
            <span className="text-[9px] text-gray-500 font-medium">CHG PCR</span>
          </div>
          <div className="h-[calc(100%-20px)]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 2, right: 5, bottom: 2, left: 5 }}>
                <XAxis
                  dataKey="time"
                  tick={{ fill: '#9ca3af', fontSize: 8 }}
                  interval="preserveStartEnd"
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#9ca3af', fontSize: 9 }}
                  axisLine={false}
                  tickLine={false}
                  width={45}
                />
                <ReferenceLine y={0} stroke="#4b5563" />
                <Bar
                  dataKey="change_pcr"
                  fill="#22c55e"
                  isAnimationActive={false}
                  shape={(props: any) => {
                    const { x, y, width, height, value } = props;
                    const fill = value >= 0 ? '#22c55e' : '#ef4444';
                    return <rect x={x} y={y} width={width} height={height} fill={fill} opacity={0.7} />;
                  }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
