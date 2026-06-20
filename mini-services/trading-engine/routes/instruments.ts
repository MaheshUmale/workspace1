/**
 * Instrument search and expiry routes.
 */

import { Router, type Request, type Response } from 'express';
import { getSimulator } from '../market-simulator';

const router = Router();

/**
 * GET /api/instruments/search?q={query}
 * Search instruments by human-readable query (e.g., 'NIFTY 23900 CE 25 Jun 2026')
 */
router.get('/search', (req: Request, res: Response) => {
  const q = (req.query.q as string) || '';
  const simulator = getSimulator();
  const results = simulator.searchInstruments(q);
  res.json({ instruments: results, total: results.length });
});

/**
 * GET /api/instruments/expiries?underlying={symbol}
 * Get current week expiry dates for an underlying.
 */
router.get('/expiries', (req: Request, res: Response) => {
  const underlying = (req.query.underlying as string) || 'NIFTY';
  const simulator = getSimulator();
  const expiries = simulator.getExpiries(underlying);
  res.json({ underlying, expiries });
});

export default router;
