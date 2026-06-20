import { NextRequest, NextResponse } from 'next/server';

const PYTHON_ENGINE_PORT = 3035;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const instrumentKey = searchParams.get('instrument_key') || 'NIFTY';
  const timeframe = searchParams.get('timeframe') || '1m';

  try {
    const pythonUrl = `http://localhost:${PYTHON_ENGINE_PORT}/api/candles?instrument_key=${encodeURIComponent(instrumentKey)}&timeframe=${encodeURIComponent(timeframe)}`;
    const res = await fetch(pythonUrl, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Python engine returned ${res.status}` },
        { status: res.status }
      );
    }

    const data = await res.json();

    // Python engine returns a raw list of candles.
    // Frontend expects { candles: [...] } format.
    const candles = Array.isArray(data) ? data : (data.candles || []);

    // Sanitize candles: filter out corrupted data
    const sanitized = candles.filter((c: any) =>
      c.close >= c.low &&
      c.close <= c.high &&
      c.open >= c.low &&
      c.open <= c.high &&
      c.high >= c.low &&
      c.time > 0
    );

    return NextResponse.json({
      instrument_key: instrumentKey,
      timeframe,
      candles: sanitized,
    });
  } catch (err: any) {
    console.error('[/api/candles] Python engine error:', err.message);
    return NextResponse.json(
      { instrument_key: instrumentKey, timeframe, candles: [] },
      { status: 200 }
    );
  }
}
