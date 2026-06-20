import { NextRequest, NextResponse } from 'next/server';

const PYTHON_ENGINE_PORT = 3035;

// GET - Check Upstox connection status
export async function GET() {
  try {
    const res = await fetch(`http://localhost:${PYTHON_ENGINE_PORT}/api/config/upstox`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return NextResponse.json({
        mode: 'offline',
        connected: false,
        upstox_configured: false,
        masked_token: '',
      });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({
      mode: 'offline',
      connected: false,
      upstox_configured: false,
      masked_token: '',
    });
  }
}

// POST - Set Upstox credentials and connect
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { access_token } = body;

    if (!access_token || typeof access_token !== 'string') {
      return NextResponse.json(
        { error: 'access_token is required and must be a string' },
        { status: 400 }
      );
    }

    const res = await fetch(`http://localhost:${PYTHON_ENGINE_PORT}/api/config/upstox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token }),
      signal: AbortSignal.timeout(15000),
    });

    const data = await res.json();

    if (data.success) {
      return NextResponse.json({
        mode: 'live',
        connected: true,
        message: 'Successfully connected to Upstox via Python engine',
      });
    } else {
      return NextResponse.json(
        { error: data.error || 'Failed to connect to Upstox. Please check your access token.' },
        { status: 401 }
      );
    }
  } catch (err) {
    console.error('[UpstoxConfig] POST error:', err);
    return NextResponse.json(
      { error: 'Invalid request body or Python engine unreachable' },
      { status: 400 }
    );
  }
}

// DELETE - Disconnect Upstox
export async function DELETE() {
  try {
    await fetch(`http://localhost:${PYTHON_ENGINE_PORT}/api/config/upstox/disconnect`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Ignore errors on disconnect
  }

  return NextResponse.json({
    mode: 'offline',
    connected: false,
    message: 'Disconnected from Upstox.',
  });
}
