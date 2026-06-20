import { NextRequest, NextResponse } from 'next/server';

const PYTHON_ENGINE_PORT = 3035;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  // Frontend sends 'q' parameter (via fetchAPI)
  const query = searchParams.get('q') || searchParams.get('query') || '';

  if (!query || query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  try {
    const pythonUrl = `http://localhost:${PYTHON_ENGINE_PORT}/api/instruments/search?q=${encodeURIComponent(query)}`;
    const res = await fetch(pythonUrl, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return NextResponse.json({ results: [] });
    }

    const data = await res.json();
    // Python engine returns { results: [...] }
    return NextResponse.json(data);
  } catch (err: any) {
    console.error('[/api/instruments/search] Python engine error:', err.message);
    return NextResponse.json({ results: [] });
  }
}
