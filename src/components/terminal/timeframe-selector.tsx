'use client';

import { useTradingStore, type Timeframe } from '@/store/trading-store';

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: '1m', label: '1m' },
  { value: '3m', label: '3m' },
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '1h', label: '1h' },
];

interface TimeframeSelectorProps {
  value?: Timeframe;
  onChange?: (tf: Timeframe) => void;
  compact?: boolean;
}

export function TimeframeSelector({ value, onChange, compact = false }: TimeframeSelectorProps) {
  const storeTimeframe = useTradingStore((s) => s.timeframe);
  const storeSetTimeframe = useTradingStore((s) => s.setTimeframe);

  const currentTf = value || storeTimeframe;
  const handleChange = onChange || storeSetTimeframe;

  return (
    <div className="flex items-center gap-0.5 rounded-md bg-[#111827] p-0.5">
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf.value}
          onClick={() => handleChange(tf.value)}
          className={`rounded px-2 py-1 text-xs font-medium transition-all ${
            currentTf === tf.value
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-gray-400 hover:text-gray-200 hover:bg-[#1e222d]'
          } ${compact ? 'px-1.5 py-0.5 text-[10px]' : ''}`}
        >
          {tf.label}
        </button>
      ))}
    </div>
  );
}
