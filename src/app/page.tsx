'use client';

import { useEffect } from 'react';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { TopBar } from '@/components/terminal/top-bar';
import { SpotChart } from '@/components/terminal/spot-chart';
import { OptionChart } from '@/components/terminal/option-chart';
import { MiniOptionChain } from '@/components/terminal/mini-option-chain';
import { PCRChart } from '@/components/terminal/pcr-chart';
import { QuickOrder } from '@/components/terminal/quick-order';
import { useTradingEngine } from '@/hooks/use-trading-engine';
import { useMarketData } from '@/hooks/use-market-data';
import { useTradingStore } from '@/store/trading-store';

export default function TradingTerminal() {
  const { underlying, expiry, setSelectedStrike } = useTradingStore();

  // Connect to trading engine WebSocket
  useTradingEngine();

  // Fetch market data (candles, option chain, PCR, expiries)
  useMarketData();

  // Auto-select ATM strike when it changes
  const atmStrike = useTradingStore((s) => s.atmStrike);
  useEffect(() => {
    if (atmStrike) {
      setSelectedStrike(atmStrike);
    }
  }, [atmStrike, setSelectedStrike]);

  return (
    <div className="flex h-screen flex-col bg-[#0a0e17] overflow-hidden no-select">
      {/* Top Bar */}
      <TopBar />

      {/* Main Content */}
      <div className="flex-1 min-h-0">
        <ResizablePanelGroup direction="vertical" className="h-full">
          {/* Top 75% - Charts */}
          <ResizablePanel defaultSize={75} minSize={50}>
            <ResizablePanelGroup direction="horizontal">
              {/* Left Chart - Spot */}
              <ResizablePanel defaultSize={40} minSize={25}>
                <div className="h-full border-r border-[#1f2937]">
                  <SpotChart />
                </div>
              </ResizablePanel>

              <ResizableHandle withHandle />

              {/* Middle Chart - CE */}
              <ResizablePanel defaultSize={30} minSize={20}>
                <div className="h-full border-r border-[#1f2937]">
                  <OptionChart optionType="CE" />
                </div>
              </ResizablePanel>

              <ResizableHandle withHandle />

              {/* Right Chart - PE */}
              <ResizablePanel defaultSize={30} minSize={20}>
                <div className="h-full">
                  <OptionChart optionType="PE" />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Bottom 25% - Option Chain, PCR, Orders */}
          <ResizablePanel defaultSize={25} minSize={15}>
            <ResizablePanelGroup direction="horizontal">
              {/* Mini Option Chain */}
              <ResizablePanel defaultSize={40} minSize={25}>
                <div className="h-full border-r border-[#1f2937]">
                  <MiniOptionChain />
                </div>
              </ResizablePanel>

              <ResizableHandle withHandle />

              {/* PCR Chart */}
              <ResizablePanel defaultSize={35} minSize={20}>
                <div className="h-full border-r border-[#1f2937]">
                  <PCRChart />
                </div>
              </ResizablePanel>

              <ResizableHandle withHandle />

              {/* Quick Order */}
              <ResizablePanel defaultSize={25} minSize={15}>
                <div className="h-full">
                  <QuickOrder />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
