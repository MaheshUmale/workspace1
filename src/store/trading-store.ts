'use client';

import { create } from 'zustand';

// ============ Types ============

export type Timeframe = '1m' | '3m' | '5m' | '15m' | '1h';

export interface SpotData {
  symbol: string;
  ltp: number;
  change: number;
  change_pct: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

export interface OptionChainRow {
  strike: number;
  ce_ltp: number;
  ce_oi: number;
  ce_change_oi: number;
  pe_change_oi: number;
  pe_oi: number;
  pe_ltp: number;
  ce_instrument_key?: string;
  pe_instrument_key?: string;
}

export interface PCRDataPoint {
  timestamp: number;
  spot: number;
  pcr: number;
  change_pcr: number;
}

export interface OrderState {
  type: 'MARKET' | 'LIMIT';
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  instrument_key: string;
}

export interface RecentOrder {
  id: string;
  instrument_key: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT';
  quantity: number;
  price: number;
  timestamp: number;
  status: 'PLACED' | 'FILLED' | 'REJECTED';
}

export interface ConnectionStatus {
  connected: boolean;
  reconnecting: boolean;
  lastUpdate: number | null;
}

// ============ Store Interface ============

export type OIProfile = 'OI' | 'COI';

interface TradingStore {
  // Selection state
  underlying: string;
  expiry: string;
  selectedStrike: number;
  selectedOptionType: 'CE' | 'PE';
  timeframe: Timeframe;

  // Real-time data
  spotData: Record<string, SpotData>;
  optionChain: OptionChainRow[];
  pcrHistory: PCRDataPoint[];
  currentPCR: number;
  currentChangePCR: number;
  atmStrike: number;

  // Connection
  connectionStatus: ConnectionStatus;

  // Order
  orderState: OrderState;
  recentOrders: RecentOrder[];

  // Expiries
  expiries: string[];

  // OI Profile
  oiProfile: OIProfile;

  // Actions
  setUnderlying: (underlying: string) => void;
  setExpiry: (expiry: string) => void;
  setSelectedStrike: (strike: number) => void;
  setSelectedOptionType: (type: 'CE' | 'PE') => void;
  setTimeframe: (tf: Timeframe) => void;
  updateSpotData: (data: SpotData) => void;
  setOptionChain: (chain: OptionChainRow[]) => void;
  updateOptionChainOI: (data: { underlying: string; strikes: Array<{ strike: number; ce_oi: number; ce_change_oi: number; pe_oi: number; pe_change_oi: number }> }) => void;
  addPCRDataPoint: (point: PCRDataPoint) => void;
  setCurrentPCR: (pcr: number, change: number) => void;
  setAtmStrike: (strike: number) => void;
  setConnectionStatus: (status: Partial<ConnectionStatus>) => void;
  setOrderState: (state: Partial<OrderState>) => void;
  addRecentOrder: (order: RecentOrder) => void;
  setExpiries: (expiries: string[]) => void;
  setOiProfile: (profile: OIProfile) => void;
}

// ============ Store Implementation ============

export const useTradingStore = create<TradingStore>((set, get) => ({
  // Selection state
  underlying: 'NIFTY',
  expiry: '',
  selectedStrike: 0,
  selectedOptionType: 'CE',
  timeframe: '1m',

  // Real-time data
  spotData: {},
  optionChain: [],
  pcrHistory: [],
  currentPCR: 1,
  currentChangePCR: 0,
  atmStrike: 0,

  // Connection
  connectionStatus: {
    connected: false,
    reconnecting: false,
    lastUpdate: null,
  },

  // Order
  orderState: {
    type: 'MARKET',
    side: 'BUY',
    quantity: 25,
    price: 0,
    instrument_key: '',
  },
  recentOrders: [],

  // Expiries
  expiries: [],

  // OI Profile
  oiProfile: 'COI' as OIProfile,

  // Actions
  setUnderlying: (underlying) => set({ underlying }),
  setExpiry: (expiry) => set({ expiry }),
  setSelectedStrike: (strike) => set({ selectedStrike: strike }),
  setSelectedOptionType: (type) => set({ selectedOptionType: type }),
  setTimeframe: (timeframe) => set({ timeframe }),

  updateSpotData: (data) =>
    set((state) => ({
      spotData: { ...state.spotData, [data.symbol]: data },
      atmStrike: Math.round(data.ltp / (data.symbol === 'NIFTY' ? 50 : 100)) * (data.symbol === 'NIFTY' ? 50 : 100),
    })),

  setOptionChain: (chain) => set({ optionChain: chain }),

  updateOptionChainOI: (data) =>
    set((state) => {
      if (data.underlying !== state.underlying) return state;
      const updated = state.optionChain.map((row) => {
        const strikeData = data.strikes.find((s) => s.strike === row.strike);
        if (strikeData) {
          return {
            ...row,
            ce_oi: strikeData.ce_oi,
            ce_change_oi: strikeData.ce_change_oi,
            pe_oi: strikeData.pe_oi,
            pe_change_oi: strikeData.pe_change_oi,
          };
        }
        return row;
      });
      return { optionChain: updated };
    }),

  addPCRDataPoint: (point) =>
    set((state) => ({
      pcrHistory: [...state.pcrHistory.slice(-299), point],
      currentPCR: point.pcr,
      currentChangePCR: point.change_pcr,
    })),

  setCurrentPCR: (pcr, change) => set({ currentPCR: pcr, currentChangePCR: change }),
  setAtmStrike: (strike) => set({ atmStrike: strike }),

  setConnectionStatus: (status) =>
    set((state) => ({
      connectionStatus: { ...state.connectionStatus, ...status },
    })),

  setOrderState: (state) =>
    set((prev) => ({
      orderState: { ...prev.orderState, ...state },
    })),

  addRecentOrder: (order) =>
    set((state) => ({
      recentOrders: [order, ...state.recentOrders].slice(0, 5),
    })),

  setExpiries: (expiries) => set({ expiries }),
  setOiProfile: (profile) => set({ oiProfile: profile }),
}));
