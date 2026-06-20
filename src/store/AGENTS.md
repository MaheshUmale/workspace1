# DOX — Zustand State Management

## Purpose

Centralized client-side state using Zustand. Holds all trading terminal state: selected instruments, market data, option chain, PCR, and UI preferences.

## Ownership

- Single store: `trading-store.ts`
- Global state accessible from any component via `useTradingStore()` hook
- No side effects in setters — pure `set()` calls

## Local Contracts

### State Shape
```typescript
{
  underlying: "NIFTY" | "BANKNIFTY"  // Selected underlying
  expiry: string                      // Selected expiry date (ISO)
  timeframe: "1m" | "3m" | "5m" | "15m" | "1h"
  selectedStrike: number              // ATM or user-selected strike
  selectedOptionType: "CE" | "PE"
  atmStrike: number                   // Computed ATM strike
  optionChain: OptionChainRow[]       // Current option chain data
  pcrData: PCRDataPoint[]             // PCR history
  spotData: Record<string, SpotTick>  // LTP data per symbol
  expiries: string[]                  // Available expiry dates
  isLive: boolean                     // Whether live data is connected
  strikeStep: number                  // 50 for NIFTY, 100 for BANKNIFTY
}
```

### Key Actions
- `setUnderlying(v)` — Changes underlying, resets option chain
- `setExpiry(v)` — Changes selected expiry
- `setTimeframe(v)` — Changes chart timeframe
- `setSelectedStrike(v)` — User-selected or ATM strike
- `setSelectedOptionType(v)` — "CE" or "PE"
- `setAtmStrike(v)` — Computed from spot price
- `setOptionChain(v)` — Full chain data
- `addPCRDataPoint(v)` — Append PCR point (deduped by timestamp)
- `setCurrentPCR(v)` — Current PCR values
- `updateSpotData(v)` — Update spot LTP for a symbol
- `setExpiries(v)` — List of expiry dates
- `setIsLive(v)` — Connection status

### Defaults
- `selectedStrike: 0` (no hardcoded default — computed from spot)
- `atmStrike: 0` (computed from spot price)
- `strikeStep: 50` (NIFTY default)

## Work Guidance

- Never add side effects to store actions — keep them pure `set()` calls
- When adding new state, add both the field and a setter action
- Use `useTradingStore.getState()` for direct access outside React components
- PCR data points are deduped by timestamp — same timestamp overwrites previous value

## Verification

- Underlying toggle switches between NIFTY and BANKNIFTY
- Expiry selection triggers option chain refetch
- Strike selection updates option charts
