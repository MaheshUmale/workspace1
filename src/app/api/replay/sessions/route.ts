import { NextResponse } from 'next/server';

const PYTHON_ENGINE_PORT = 3035;

export async function GET() {
  try {
    const res = await fetch(`http://localhost:${PYTHON_ENGINE_PORT}/api/replay/sessions`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return NextResponse.json([]);
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json([]);
  }
}
