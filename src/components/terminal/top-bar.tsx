'use client';

import { InstrumentSearch } from './instrument-search';
import { ConnectionStatus } from './connection-status';
import { UpstoxConfigDialog } from './upstox-config-dialog';
import { useTradingStore } from '@/store/trading-store';
import { Activity, RotateCcw, Zap, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function TopBar() {
  const { underlying, spotData, setUnderlying } = useTradingStore();
  const spot = spotData[underlying];

  return (
    <header className="flex h-12 items-center justify-between border-b border-[#1f2937] bg-[#0d1117] px-4 shrink-0">
      {/* Left: Logo */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-yellow-500 to-orange-600">
            <Zap className="h-4 w-4 text-white" />
          </div>
          <span className="text-sm font-bold text-white tracking-wide">7Strike Terminal</span>
        </div>

        {/* Underlying selector */}
        <div className="flex items-center gap-0.5 rounded-md bg-[#111827] p-0.5 ml-2">
          {['NIFTY', 'BANKNIFTY'].map((sym) => (
            <button
              key={sym}
              onClick={() => setUnderlying(sym)}
              className={`rounded px-2.5 py-1 text-xs font-semibold transition-all ${
                underlying === sym
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {sym === 'BANKNIFTY' ? 'BNF' : sym}
            </button>
          ))}
        </div>

        {/* Spot price */}
        {spot && (
          <div className="flex items-center gap-2 ml-3">
            <span className="text-lg font-bold text-white">{spot.ltp.toFixed(2)}</span>
            <span className={`text-xs font-medium ${spot.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {spot.change >= 0 ? '+' : ''}{spot.change.toFixed(2)} ({spot.change >= 0 ? '+' : ''}{spot.change_pct.toFixed(2)}%)
            </span>
          </div>
        )}
      </div>

      {/* Center: Search */}
      <div className="flex-1 flex justify-center px-4">
        <InstrumentSearch />
      </div>

      {/* Right: Controls */}
      <div className="flex items-center gap-2">
        <ConnectionStatus />

        <UpstoxConfigDialog />

        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs text-gray-400 hover:text-gray-200"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Replay
        </Button>

        <a href="/7strike" target="_blank" rel="noopener noreferrer">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-yellow-400 hover:text-yellow-300 hover:bg-yellow-400/10"
          >
            <Activity className="h-3.5 w-3.5" />
            7Strike
            <ExternalLink className="h-2.5 w-2.5" />
          </Button>
        </a>
      </div>
    </header>
  );
}
