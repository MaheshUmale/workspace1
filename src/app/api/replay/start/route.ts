import { NextRequest, NextResponse } from 'next/server';

const PYTHON_ENGINE_PORT = 3035;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sessionId = body.session_id || '';

    const res = await fetch(`http://localhost:${PYTHON_ENGINE_PORT}/api/replay/start?session_id=${encodeURIComponent(sessionId)}`, {
      method: 'POST',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { session_id: '', status: 'error', message: 'Failed to start replay' },
        { status: 400 }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error('[Replay Start API] Error:', err);
    return NextResponse.json(
      { session_id: '', status: 'error', message: 'Failed to start replay' },
      { status: 400 }
    );
  }
}
