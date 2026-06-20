"use client";

import { useEffect, useState, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────

interface RLModelBreakdown {
  bullish: number;
  bearish: number;
  confidence: number;
  agrees: string;
}

interface RLSignal {
  action: "BUY_CALL" | "BUY_PUT" | "NO_TRADE";
  confidence: number;
  consensus: number;
  reasoning: string;
  models: Record<string, RLModelBreakdown>;
  position_open: boolean;
  position_type: string;
  bars_processed: number;
  ready: boolean;
}

const EMPTY_SIGNAL: RLSignal = {
  action: "NO_TRADE",
  confidence: 0,
  consensus: 0,
  reasoning: "Connecting...",
  models: {},
  position_open: false,
  position_type: "flat",
  bars_processed: 0,
  ready: false,
};

// ── Component ────────────────────────────────────────────────

interface RLSignalPanelProps {
  underlying?: string;
  pollIntervalMs?: number;
  engineUrl?: string;
}

export default function RLSignalPanel({
  underlying = "NIFTY",
  pollIntervalMs = 3000,
  engineUrl = "/api/rl",
}: RLSignalPanelProps) {
  const [signal, setSignal] = useState<RLSignal>(EMPTY_SIGNAL);
  const [status, setStatus] = useState<{
    initialized: boolean;
    models_loaded: string[];
    bars_processed: number;
    total_trades: number;
  } | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string>("");

  // Fetch RL signal
  const fetchSignal = useCallback(async () => {
    try {
      const res = await fetch(
        `${engineUrl}/signal?underlying=${underlying}`
      );
      const data = await res.json();
      setSignal(data);
      setLastUpdate(
        new Date().toLocaleTimeString("en-IN", { hour12: false })
      );
    } catch {
      setSignal({
        ...EMPTY_SIGNAL,
        reasoning: "RL engine not responding",
      });
    }
  }, [engineUrl, underlying]);

  // Fetch engine status (less frequent)
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${engineUrl}/status`);
      const data = await res.json();
      setStatus(data);
    } catch {
      // silent
    }
  }, [engineUrl]);

  useEffect(() => {
    fetchSignal();
    fetchStatus();
    const signalInterval = setInterval(fetchSignal, pollIntervalMs);
    const statusInterval = setInterval(fetchStatus, 30000); // status every 30s
    return () => {
      clearInterval(signalInterval);
      clearInterval(statusInterval);
    };
  }, [fetchSignal, fetchStatus, pollIntervalMs]);

  // ── Render helpers ───────────────────────────────────────

  const actionColor =
    signal.action === "BUY_CALL"
      ? "text-green-400 bg-green-400/10 border-green-400/30"
      : signal.action === "BUY_PUT"
      ? "text-red-400 bg-red-400/10 border-red-400/30"
      : "text-zinc-400 bg-zinc-400/10 border-zinc-400/20";

  const actionLabel =
    signal.action === "BUY_CALL"
      ? "▲ BUY CALL"
      : signal.action === "BUY_PUT"
      ? "▼ BUY PUT"
      : "— NO TRADE";

  const confidencePct = (signal.confidence * 100).toFixed(1);

  const modelEntries = Object.entries(signal.models);

  return (
    <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/80 p-3 font-mono text-xs">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              signal.ready
                ? "bg-emerald-400"
                : "bg-amber-400 animate-pulse"
            }`}
          />
          <span className="text-zinc-300 font-semibold tracking-wide">
            RL SIGNAL
          </span>
        </div>
        <span className="text-zinc-500 text-[10px]">{lastUpdate}</span>
      </div>

      {/* Main Action */}
      <div
        className={`text-center py-2 px-3 rounded-md border mb-2 ${actionColor}`}
      >
        <div className="text-lg font-bold tracking-wider">{actionLabel}</div>
        <div className="text-[10px] opacity-70 mt-0.5">
          Confidence: {confidencePct}%
          {signal.consensus > 0 && ` · ${signal.consensus}/3 agree`}
        </div>
      </div>

      {/* Not ready warning */}
      {!signal.ready && (
        <div className="text-amber-400/80 text-[10px] text-center mb-2 px-2 py-1 bg-amber-400/5 rounded">
          Warming up: {signal.bars_processed}/500 bars
        </div>
      )}

      {/* Per-model breakdown */}
      {modelEntries.length > 0 && (
        <div className="space-y-1 mb-2">
          {modelEntries.map(([name, m]) => {
            const modelLabel = name
              .replace("spot_direction", "Spot/Dir")
              .replace("oi_dynamics", "OI Dynamics")
              .replace("skew_vol", "Skew/Vol");
            const isBull = m.agrees === "bullish";
            const barWidth = Math.max(m.confidence * 100, 5);

            return (
              <div
                key={name}
                className="flex items-center gap-2 text-[10px]"
              >
                <span className="text-zinc-400 w-20 truncate">
                  {modelLabel}
                </span>
                <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      isBull ? "bg-green-500" : "bg-red-500"
                    }`}
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
                <span
                  className={`w-8 text-right ${
                    isBull ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {isBull ? "BULL" : "BEAR"} {Math.round(m.confidence * 100)}
                  %
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Reasoning */}
      <div className="text-zinc-500 text-[10px] leading-relaxed border-t border-zinc-800 pt-1.5">
        {signal.reasoning}
      </div>

      {/* Position status */}
      {signal.position_open && (
        <div className="mt-1.5 text-[10px] px-2 py-0.5 bg-blue-400/10 text-blue-300 rounded border border-blue-400/20">
          Position: {signal.position_type.toUpperCase()} · Trades:{" "}
          {status?.total_trades ?? "?"}
        </div>
      )}

      {/* Engine status line */}
      {status && (
        <div className="mt-1.5 text-[9px] text-zinc-600 flex justify-between">
          <span>
            Models:{" "}
            {status.initialized
              ? status.models_loaded.join(", ")
              : "not loaded"}
          </span>
          <span>Bars: {status.bars_processed}</span>
        </div>
      )}
    </div>
  );
}