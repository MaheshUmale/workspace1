import { NextRequest, NextResponse } from 'next/server';

const PYTHON_ENGINE_PORT = 3035;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const underlying = searchParams.get('underlying') || 'NIFTY';
  const expiry = searchParams.get('expiry') || '';

  try {
    const pythonUrl = `http://localhost:${PYTHON_ENGINE_PORT}/api/7strike/signals?underlying=${encodeURIComponent(underlying)}&expiry=${encodeURIComponent(expiry)}`;
    const res = await fetch(pythonUrl, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return NextResponse.json({});
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    console.error('[/api/7strike/signals] Python engine error:', err.message);
    return NextResponse.json({});
  }
}
