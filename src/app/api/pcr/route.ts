import { NextRequest, NextResponse } from 'next/server';

const PYTHON_ENGINE_PORT = 3035;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const underlying = searchParams.get('underlying') || 'NIFTY';
  const expiry = searchParams.get('expiry') || '';

  if (!expiry) {
    return NextResponse.json(
      { error: 'expiry parameter is required' },
      { status: 400 }
    );
  }

  try {
    const pythonUrl = `http://localhost:${PYTHON_ENGINE_PORT}/api/pcr?underlying=${encodeURIComponent(underlying)}&expiry=${encodeURIComponent(expiry)}`;
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
    console.error('[/api/pcr] Python engine error:', err.message);
    return NextResponse.json({
      underlying,
      expiry,
      data: [],
      current_pcr: 1,
      current_change_pcr: 0,
    });
  }
}
