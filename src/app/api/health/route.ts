import { NextResponse } from 'next/server';

const PYTHON_ENGINE_PORT = 3035;

export async function GET() {
  try {
    const res = await fetch(`http://localhost:${PYTHON_ENGINE_PORT}/api/health`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return NextResponse.json({
        status: 'degraded',
        mode: 'offline',
        connected: false,
        upstox_configured: false,
        masked_token: '',
        uptime: 0,
        symbols: ['NIFTY', 'BANKNIFTY'],
        tick_count: 0,
        timestamp: Date.now(),
        python_engine: 'error',
      });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({
      status: 'offline',
      mode: 'offline',
      connected: false,
      upstox_configured: false,
      masked_token: '',
      uptime: 0,
      symbols: ['NIFTY', 'BANKNIFTY'],
      tick_count: 0,
      timestamp: Date.now(),
      python_engine: 'unreachable',
    });
  }
}
