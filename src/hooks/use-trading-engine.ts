'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useTradingStore } from '@/store/trading-store';
import type { SpotData, PCRDataPoint } from '@/store/trading-store';

type SocketType = any;

export function useTradingEngine() {
  const socketRef = useRef<SocketType | null>(null);

  const {
    underlying,
    updateSpotData,
    updateOptionChainOI,
    addPCRDataPoint,
    setConnectionStatus,
  } = useTradingStore();

  const connect = useCallback(() => {
    if (socketRef.current?.connected) return;
    if (typeof window === 'undefined') return;

    // Try to connect to the Python engine via WebSocket (port 3035)
    // If Python engine is not running, the connection will fail gracefully
    import('socket.io-client').then(({ io }) => {
      const socket = io('/?XTransformPort=3035', {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5, // Reduced attempts since Python engine may not be running
        reconnectionDelay: 3000,
        reconnectionDelayMax: 10000,
        timeout: 5000,
      });

      socket.on('connect', () => {
        console.log('[WS] Connected to Python engine:', socket.id);
        setConnectionStatus({ connected: true, reconnecting: false });
      });

      socket.on('disconnect', (reason: string) => {
        console.log('[WS] Disconnected:', reason);
        setConnectionStatus({ connected: false, reconnecting: false, lastUpdate: Date.now() });
      });

      socket.on('connect_error', (err: Error) => {
        // Don't spam console — Python engine may not be running
        setConnectionStatus({ connected: false, reconnecting: false });
      });

      socket.on('reconnect_attempt', () => {
        setConnectionStatus({ reconnecting: true });
      });

      socket.on('spot_tick', (data: SpotData) => {
        updateSpotData(data);
        setConnectionStatus({ lastUpdate: Date.now() });
      });

      socket.on('oi_update', (data: {
        underlying: string;
        strikes: Array<{
          strike: number;
          ce_oi: number;
          ce_change_oi: number;
          pe_oi: number;
          pe_change_oi: number;
        }>;
      }) => {
        updateOptionChainOI(data);
      });

      socket.on('pcr_update', (data: {
        underlying: string;
        pcr: number;
        change_pcr: number;
        spot: number;
        timestamp: number;
      }) => {
        if (data.underlying === useTradingStore.getState().underlying) {
          addPCRDataPoint({
            timestamp: data.timestamp,
            spot: data.spot,
            pcr: data.pcr,
            change_pcr: data.change_pcr,
          } as PCRDataPoint);
        }
      });

      socketRef.current = socket;
    }).catch((err) => {
      console.error('[WS] Failed to load socket.io-client:', err);
    });
  }, [updateSpotData, updateOptionChainOI, addPCRDataPoint, setConnectionStatus, underlying]);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return { socketRef, connect, disconnect };
}
