'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Search, X, ChevronDown } from 'lucide-react';
import { useTradingStore } from '@/store/trading-store';
import { fetchAPI } from '@/lib/chart-utils';

interface SearchResult {
  instrument_key: string;
  trading_symbol: string;
  name: string;
  expiry?: string;
  strike?: number | null;
  option_type?: string | null;
  lot_size: number;
  underlying: string;
  instrument_type?: string;
  weekly?: boolean;
}

export function InstrumentSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { underlying, expiry, selectedStrike, selectedOptionType } = useTradingStore();

  const searchInstruments = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      return;
    }

    setLoading(true);
    try {
      const data = await fetchAPI<{ results: SearchResult[] }>('/api/instruments/search', { q });
      const searchResults = data.results || [];
      setResults(searchResults);
    } catch (err) {
      console.error('Search failed:', err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (query) searchInstruments(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, searchInstruments]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const formatExpiry = (exp: string) => {
    if (!exp) return 'Select Expiry';
    try {
      const d = new Date(exp + 'T00:00:00');
      return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
    } catch {
      return exp;
    }
  };

  const displayText = `${underlying} | ${selectedStrike} ${selectedOptionType} | ${formatExpiry(expiry)}`;

  const handleSelect = (item: SearchResult) => {
    const store = useTradingStore.getState();
    if (item.underlying) store.setUnderlying(item.underlying);
    if (item.expiry) store.setExpiry(item.expiry);
    if (item.strike) store.setSelectedStrike(item.strike);
    if (item.option_type) store.setSelectedOptionType(item.option_type as 'CE' | 'PE');
    setIsOpen(false);
    setQuery('');
    setResults([]);
  };

  return (
    <div ref={containerRef} className="relative">
      <div
        className="flex items-center gap-2 rounded-md border border-[#1f2937] bg-[#111827] px-3 py-1.5 cursor-pointer hover:border-[#374151] transition-colors"
        onClick={() => {
          setIsOpen(true);
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
      >
        <Search className="h-3.5 w-3.5 text-gray-500 shrink-0" />
        <span className="text-sm text-gray-200 whitespace-nowrap">{displayText}</span>
        <ChevronDown className="h-3.5 w-3.5 text-gray-500 shrink-0 ml-auto" />
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 z-50 mt-1 w-96 rounded-md border border-[#1f2937] bg-[#111827] shadow-xl">
          <div className="flex items-center gap-2 border-b border-[#1f2937] px-3 py-2">
            <Search className="h-3.5 w-3.5 text-gray-500" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setIsOpen(false);
                  setQuery('');
                }
              }}
              placeholder="Search: NIFTY 23900 CE, BANKNIFTY 50000 PE..."
              className="flex-1 bg-transparent text-sm text-gray-200 placeholder:text-gray-500 outline-none"
            />
            {query && (
              <button onClick={() => { setQuery(''); setResults([]); }} className="text-gray-500 hover:text-gray-300">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto custom-scrollbar">
            {loading && (
              <div className="px-3 py-4 text-center text-xs text-gray-500">Searching...</div>
            )}

            {!loading && query && results.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-gray-500">
                No instruments found for &quot;{query}&quot;
              </div>
            )}

            {!loading && results.length > 0 && (
              <div className="py-1">
                {results.slice(0, 20).map((item) => (
                  <button
                    key={item.instrument_key}
                    onClick={() => handleSelect(item)}
                    className="w-full px-3 py-2 text-left hover:bg-[#1e222d] transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-200 font-medium">
                        {item.trading_symbol}
                      </span>
                      <span className="text-xs text-gray-500">
                        {item.instrument_type || ''} {item.lot_size ? `Lot: ${item.lot_size}` : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-gray-400">
                        {item.underlying}
                      </span>
                      {item.expiry && (
                        <span className="text-xs text-gray-500">
                          {formatExpiry(item.expiry)}
                        </span>
                      )}
                      {item.strike && (
                        <span className="text-xs text-gray-500">
                          Strike: {item.strike}
                        </span>
                      )}
                      {item.weekly !== undefined && (
                        <span className={`text-xs ${item.weekly ? 'text-amber-400' : 'text-blue-400'}`}>
                          {item.weekly ? 'W' : 'M'}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {!loading && !query && (
              <div className="px-3 py-4 text-center text-xs text-gray-500">
                Type to search instruments (e.g., &quot;NIFTY 23900 CE&quot;)
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
