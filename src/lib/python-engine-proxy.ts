// ============================================================
// Python Engine Proxy — All API requests route to the Python
// FastAPI backend at port 3031. NO SIMULATION. NO FALLBACK.
// ============================================================

const PYTHON_ENGINE_URL = 'http://127.0.0.1:3035';

/**
 * Proxy a request to the Python engine.
 * Returns the JSON response from the Python backend.
 */
export async function proxyToPythonEngine(
  path: string,
  params: Record<string, string> = {},
  options?: { method?: string; body?: unknown }
): Promise<unknown> {
  const searchParams = new URLSearchParams(params);
  const url = `${PYTHON_ENGINE_URL}${path}?${searchParams.toString()}`;

  const fetchOptions: RequestInit = {
    method: options?.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000), // 15s timeout
  };

  if (options?.body) {
    fetchOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, fetchOptions);

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Python engine error: ${response.status} — ${errorText}`);
  }

  return response.json();
}

/**
 * Proxy a GET request to the Python engine and return typed data.
 */
export async function proxyGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  return proxyToPythonEngine(path, params) as Promise<T>;
}

/**
 * Proxy a POST request to the Python engine.
 */
export async function proxyPost<T>(path: string, body: unknown): Promise<T> {
  return proxyToPythonEngine(path, {}, { method: 'POST', body }) as Promise<T>;
}

/**
 * Proxy a DELETE request to the Python engine.
 */
export async function proxyDelete<T>(path: string): Promise<T> {
  return proxyToPythonEngine(path, {}, { method: 'DELETE' }) as Promise<T>;
}
