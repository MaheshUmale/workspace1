'use client';

import { useEffect, useState, useRef } from 'react';
import { useTradingStore } from '@/store/trading-store';
import { Loader2, Radio, Monitor } from 'lucide-react';

interface UpstoxStatus {
  mode: 'live' | 'offline';
  connected: boolean;
  upstox_configured: boolean;
  masked_token: string;
}

export function ConnectionStatus() {
  const { connected, reconnecting, lastUpdate } = useTradingStore(
    (state) => state.connectionStatus
  );
  const [upstoxStatus, setUpstoxStatus] = useState<UpstoxStatus | null>(null);
  const mountedRef = useRef(false);

  // Poll Upstox status periodically
  useEffect(() => {
    mountedRef.current = true;

    const poll = async () => {
      try {
        const res = await fetch('/api/config/upstox');
        if (res.ok && mountedRef.current) {
          const data = await res.json();
          setUpstoxStatus(data);
        }
      } catch {
        // Silently ignore
      }
    };

    // Initial fetch
    poll();

    // Poll every 10 seconds
    const interval = setInterval(poll, 10000);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, []);

  // Determine display state
  const isLive = upstoxStatus?.connected === true;
  const isOffline = !isLive;

  return (
    <div className="flex items-center gap-2 text-xs">
      {isLive ? (
        // LIVE — Green
        <div className="flex items-center gap-1.5">
          <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
          <Radio className="h-3.5 w-3.5 text-green-500" />
          <span className="text-green-400 font-semibold">LIVE</span>
        </div>
      ) : isOffline ? (
        // OFFLINE — Yellow
        <div className="flex items-center gap-1.5">
          <div className="h-2 w-2 rounded-full bg-yellow-500" />
          <Monitor className="h-3.5 w-3.5 text-yellow-500" />
          <span className="text-yellow-400 font-semibold">OFFLINE</span>
        </div>
      ) : reconnecting ? (
        // Reconnecting — Yellow spinner
        <div className="flex items-center gap-1.5">
          <Loader2 className="h-3.5 w-3.5 text-yellow-500 animate-spin" />
          <span className="text-yellow-400">Reconnecting</span>
        </div>
      ) : (
        // Offline — Default
        <div className="flex items-center gap-1.5">
          <div className="h-2 w-2 rounded-full bg-yellow-500" />
          <Monitor className="h-3.5 w-3.5 text-yellow-500" />
          <span className="text-yellow-400 font-semibold">OFFLINE</span>
        </div>
      )}

      {lastUpdate && (connected || isLive) && (
        <span className="text-gray-500">
          {new Date(lastUpdate).toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
          })}
        </span>
      )}
    </div>
  );
}
