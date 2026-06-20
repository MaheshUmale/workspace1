'use client';

import { useTradingStore } from '@/store/trading-store';
import { formatNumber, formatPrice } from '@/lib/chart-utils';
import { ArrowUp, ArrowDown } from 'lucide-react';

export function MiniOptionChain() {
  const { optionChain, atmStrike, underlying, setSelectedStrike, setSelectedOptionType } = useTradingStore();
  const strikeStep = underlying === 'NIFTY' ? 50 : 100;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1f2937] shrink-0">
        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
          Option Chain (ATM ±5)
        </span>
        <span className="text-[10px] text-yellow-400 font-medium">
          ATM: {atmStrike}
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-auto custom-scrollbar">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#111827] border-b border-[#1f2937]">
              <th className="text-right px-2 py-1.5 text-gray-500 font-medium">CE LTP</th>
              <th className="text-right px-2 py-1.5 text-gray-500 font-medium">CE OI</th>
              <th className="text-right px-2 py-1.5 text-gray-500 font-medium">CE Chg</th>
              <th className="text-center px-2 py-1.5 text-yellow-500 font-semibold">Strike</th>
              <th className="text-left px-2 py-1.5 text-gray-500 font-medium">PE Chg</th>
              <th className="text-left px-2 py-1.5 text-gray-500 font-medium">PE OI</th>
              <th className="text-left px-2 py-1.5 text-gray-500 font-medium">PE LTP</th>
              <th className="text-center px-1 py-1.5 text-gray-500 font-medium">Trade</th>
            </tr>
          </thead>
          <tbody>
            {optionChain.map((row) => {
              const isATM = row.strike === atmStrike;
              const isITM_CE = row.strike < atmStrike;
              const isITM_PE = row.strike > atmStrike;
              const isITM = isITM_CE || isITM_PE;

              return (
                <tr
                  key={row.strike}
                  className={`border-b border-[#1e222d] transition-colors ${
                    isATM
                      ? 'bg-yellow-500/10'
                      : isITM
                      ? 'bg-[#0d1117]'
                      : 'hover:bg-[#111827]'
                  }`}
                >
                  {/* CE LTP */}
                  <td className={`text-right px-2 py-1 ${row.ce_ltp > 0 ? 'text-green-400' : 'text-gray-600'}`}>
                    {row.ce_ltp > 0 ? formatPrice(row.ce_ltp) : '-'}
                  </td>

                  {/* CE OI */}
                  <td className="text-right px-2 py-1 text-gray-300">
                    {formatNumber(row.ce_oi)}
                  </td>

                  {/* CE Change OI */}
                  <td className={`text-right px-2 py-1 ${row.ce_change_oi >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    <div className="flex items-center justify-end gap-0.5">
                      {row.ce_change_oi >= 0 ? (
                        <ArrowUp className="h-2.5 w-2.5" />
                      ) : (
                        <ArrowDown className="h-2.5 w-2.5" />
                      )}
                      {formatNumber(Math.abs(row.ce_change_oi))}
                    </div>
                  </td>

                  {/* Strike */}
                  <td className={`text-center px-2 py-1 font-semibold ${isATM ? 'text-yellow-400' : 'text-white'}`}>
                    {row.strike}
                  </td>

                  {/* PE Change OI */}
                  <td className={`text-left px-2 py-1 ${row.pe_change_oi >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    <div className="flex items-center gap-0.5">
                      {row.pe_change_oi >= 0 ? (
                        <ArrowUp className="h-2.5 w-2.5" />
                      ) : (
                        <ArrowDown className="h-2.5 w-2.5" />
                      )}
                      {formatNumber(Math.abs(row.pe_change_oi))}
                    </div>
                  </td>

                  {/* PE OI */}
                  <td className="text-left px-2 py-1 text-gray-300">
                    {formatNumber(row.pe_oi)}
                  </td>

                  {/* PE LTP */}
                  <td className={`text-left px-2 py-1 ${row.pe_ltp > 0 ? 'text-red-400' : 'text-gray-600'}`}>
                    {row.pe_ltp > 0 ? formatPrice(row.pe_ltp) : '-'}
                  </td>

                  {/* Trade buttons */}
                  <td className="text-center px-1 py-1">
                    <div className="flex gap-0.5 justify-center">
                      <button
                        onClick={() => {
                          setSelectedStrike(row.strike);
                          setSelectedOptionType('CE');
                        }}
                        className="h-5 w-5 rounded text-[8px] font-bold bg-green-600/20 text-green-400 hover:bg-green-600/40 transition-colors"
                      >
                        B
                      </button>
                      <button
                        onClick={() => {
                          setSelectedStrike(row.strike);
                          setSelectedOptionType('PE');
                        }}
                        className="h-5 w-5 rounded text-[8px] font-bold bg-red-600/20 text-red-400 hover:bg-red-600/40 transition-colors"
                      >
                        S
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
