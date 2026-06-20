/**
 * Replay routes for historical data replay.
 */

import { Router, type Request, type Response } from 'express';

const router = Router();

// In-memory replay sessions
interface ReplaySessionData {
  date: string;
  underlying: string;
  status: string;
  tick_count: number;
}

let sessions: ReplaySessionData[] = [];

// Initialize some demo sessions on first request
let sessionsInitialized = false;

function ensureSessions(): void {
  if (sessionsInitialized) return;
  sessionsInitialized = true;

  const now = new Date();
  for (let i = 0; i < 5; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - (i + 1));
    const date = d.toISOString().split('T')[0];
    for (const symbol of ['NIFTY', 'BANKNIFTY']) {
      sessions.push({
        date,
        underlying: symbol,
        status: 'available',
        tick_count: Math.floor(Math.random() * 30000) + 20000,
      });
    }
  }
}

/**
 * GET /api/replay/sessions
 * List available replay sessions.
 */
router.get('/sessions', (req: Request, res: Response) => {
  ensureSessions();

  const underlying = req.query.underlying as string | undefined;
  let filtered = sessions;
  if (underlying) {
    filtered = sessions.filter(s => s.underlying === underlying);
  }

  res.json({ sessions: filtered });
});

/**
 * POST /api/replay/start
 * Start replay for a specific date.
 * Request body: { "date": "2026-03-04", "underlying": "NIFTY", "speed": 1.0 }
 */
router.post('/start', (req: Request, res: Response) => {
  ensureSessions();

  const body = req.body || {};
  const date = body.date || new Date().toISOString().split('T')[0];
  const underlying = body.underlying || 'NIFTY';
  const speed = body.speed || 1.0;

  // Update session status
  const existing = sessions.find(s => s.date === date && s.underlying === underlying);
  if (existing) {
    existing.status = 'in_progress';
  } else {
    sessions.push({
      date,
      underlying,
      status: 'in_progress',
      tick_count: 0,
    });
  }

  res.json({
    status: 'started',
    date,
    underlying,
    speed,
    message: `Replay session started for ${underlying} on ${date} at ${speed}x speed`,
  });
});

export default router;
