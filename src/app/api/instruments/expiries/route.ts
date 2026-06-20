import { NextRequest, NextResponse } from 'next/server';

const PYTHON_ENGINE_PORT = 3035;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const underlying = searchParams.get('underlying') || 'NIFTY';

  try {
    const pythonUrl = `http://localhost:${PYTHON_ENGINE_PORT}/api/instruments/expiries?underlying=${encodeURIComponent(underlying)}`;
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
    return NextResponse.json(data);
  } catch (err: any) {
    console.error('[/api/instruments/expiries] Python engine error:', err.message);
    return NextResponse.json({ underlying, expiries: [] });
  }
}
