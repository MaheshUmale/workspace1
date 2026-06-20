'use client';

import { useState, useCallback } from 'react';
import { useTradingStore } from '@/store/trading-store';
import { formatPrice, buildInstrumentKey } from '@/lib/chart-utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowUp, ArrowDown, CheckCircle2, XCircle } from 'lucide-react';

export function QuickOrder() {
  const {
    underlying,
    expiry,
    selectedStrike,
    selectedOptionType,
    optionChain,
    orderState,
    setOrderState,
    addRecentOrder,
  } = useTradingStore();

  const [placing, setPlacing] = useState(false);

  const chainRow = optionChain.find((r) => r.strike === selectedStrike);
  const ltp = selectedOptionType === 'CE' ? chainRow?.ce_ltp : chainRow?.pe_ltp;

  const instrumentKey = expiry
    ? buildInstrumentKey(underlying, expiry, selectedStrike, selectedOptionType)
    : '';

  const handlePlaceOrder = useCallback(async () => {
    if (!instrumentKey) return;

    setPlacing(true);

    // Simulate order placement
    await new Promise((resolve) => setTimeout(resolve, 500));

    const order = {
      id: `ORD-${Date.now().toString(36).toUpperCase()}`,
      instrument_key: instrumentKey,
      side: orderState.side,
      type: orderState.type,
      quantity: orderState.quantity,
      price: orderState.type === 'MARKET' ? (ltp ?? 0) : orderState.price,
      timestamp: Date.now(),
      status: 'PLACED' as const,
    };

    addRecentOrder(order);
    setPlacing(false);
  }, [instrumentKey, orderState, ltp, addRecentOrder]);

  const recentOrders = useTradingStore((s) => s.recentOrders);

  const isBuy = orderState.side === 'BUY';
  const sideColor = isBuy ? 'green' : 'red';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1f2937] shrink-0">
        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
          Quick Order
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 py-2 space-y-2.5">
        {/* Current Selection */}
        <div className="rounded-md bg-[#111827] border border-[#1f2937] px-2.5 py-2">
          <div className="text-[10px] text-gray-500 mb-1">Current Selection</div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white">
              {underlying} {selectedStrike} {selectedOptionType}
            </span>
            <span className={`text-xs font-bold ${selectedOptionType === 'CE' ? 'text-green-400' : 'text-red-400'}`}>
              LTP: {ltp ? formatPrice(ltp) : '-'}
            </span>
          </div>
          {expiry && (
            <div className="text-[10px] text-gray-500 mt-0.5">
              Exp: {new Date(expiry).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            </div>
          )}
        </div>

        {/* Order Type */}
        <div className="flex gap-0.5 rounded-md bg-[#111827] p-0.5">
          {(['MARKET', 'LIMIT'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setOrderState({ type })}
              className={`flex-1 rounded px-2 py-1 text-[10px] font-semibold transition-all ${
                orderState.type === type
                  ? 'bg-[#1e222d] text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {type}
            </button>
          ))}
        </div>

        {/* Buy/Sell Toggle */}
        <div className="flex gap-1">
          <button
            onClick={() => setOrderState({ side: 'BUY' })}
            className={`flex-1 flex items-center justify-center gap-1 rounded-md py-1.5 text-xs font-bold transition-all ${
              isBuy
                ? 'bg-green-600 text-white shadow-md'
                : 'bg-green-600/10 text-green-500 hover:bg-green-600/20'
            }`}
          >
            <ArrowUp className="h-3 w-3" />
            BUY
          </button>
          <button
            onClick={() => setOrderState({ side: 'SELL' })}
            className={`flex-1 flex items-center justify-center gap-1 rounded-md py-1.5 text-xs font-bold transition-all ${
              !isBuy
                ? 'bg-red-600 text-white shadow-md'
                : 'bg-red-600/10 text-red-500 hover:bg-red-600/20'
            }`}
          >
            <ArrowDown className="h-3 w-3" />
            SELL
          </button>
        </div>

        {/* Quantity */}
        <div>
          <label className="text-[10px] text-gray-500 mb-1 block">Qty (Lots)</label>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setOrderState({ quantity: Math.max(1, orderState.quantity - 1) })}
              className="h-7 w-7 rounded bg-[#111827] text-gray-400 hover:text-white text-sm font-bold transition-colors"
            >
              -
            </button>
            <Input
              type="number"
              value={orderState.quantity}
              onChange={(e) => setOrderState({ quantity: Math.max(1, parseInt(e.target.value) || 1) })}
              className="h-7 text-center text-xs bg-[#111827] border-[#1f2937]"
            />
            <button
              onClick={() => setOrderState({ quantity: orderState.quantity + 1 })}
              className="h-7 w-7 rounded bg-[#111827] text-gray-400 hover:text-white text-sm font-bold transition-colors"
            >
              +
            </button>
          </div>
        </div>

        {/* Price (for limit orders) */}
        {orderState.type === 'LIMIT' && (
          <div>
            <label className="text-[10px] text-gray-500 mb-1 block">Price</label>
            <Input
              type="number"
              value={orderState.price || ltp || ''}
              onChange={(e) => setOrderState({ price: parseFloat(e.target.value) || 0 })}
              className="h-7 text-xs bg-[#111827] border-[#1f2937]"
              placeholder="Limit price"
            />
          </div>
        )}

        {/* Place Order Button */}
        <Button
          onClick={handlePlaceOrder}
          disabled={placing || !instrumentKey}
          className={`w-full h-8 text-xs font-bold ${
            isBuy
              ? 'bg-green-600 hover:bg-green-700 text-white'
              : 'bg-red-600 hover:bg-red-700 text-white'
          }`}
        >
          {placing ? 'Placing...' : `${orderState.side} ${underlying} ${selectedStrike} ${selectedOptionType}`}
        </Button>

        {/* Recent Orders */}
        {recentOrders.length > 0 && (
          <div>
            <div className="text-[10px] text-gray-500 mb-1.5 font-medium">Recent Orders</div>
            <div className="space-y-1">
              {recentOrders.map((order) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between rounded bg-[#111827] px-2 py-1.5 text-[10px]"
                >
                  <div className="flex items-center gap-1.5">
                    {order.status === 'PLACED' ? (
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                    ) : (
                      <XCircle className="h-3 w-3 text-red-500" />
                    )}
                    <span className={order.side === 'BUY' ? 'text-green-400' : 'text-red-400'}>
                      {order.side}
                    </span>
                    <span className="text-gray-300">
                      {order.quantity}x @ {formatPrice(order.price)}
                    </span>
                  </div>
                  <span className="text-gray-500">
                    {new Date(order.timestamp).toLocaleTimeString('en-IN', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: false,
                    })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
