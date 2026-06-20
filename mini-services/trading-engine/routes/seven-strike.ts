/**
 * 7-Strike COI PCR Matrix and Signal routes.
 * Implements the 7-Strike System logic.
 */

import { Router, type Request, type Response } from 'express';
import { getSimulator } from '../market-simulator';

const router = Router();

/**
 * GET /api/7strike/matrix?underlying={symbol}&expiry={date}
 *
 * Get 7-Strike COI PCR Matrix data.
 * The matrix tracks Change in OI since market open (09:15 AM)
 * across a 7-strike window centered around ATM.
 * COI PCR = Sum(PE COI) / Sum(CE COI) for the 7-strike window.
 *
 * Includes window shifting with stabilization protocol:
 * - When ATM shifts, new strikes inherit their intraday COI
 * - 15-minute stabilization freeze after shift
 */
router.get('/matrix', (req: Request, res: Response) => {
  const underlying = (req.query.underlying as string) || 'NIFTY';
  let expiry = req.query.expiry as string | undefined;

  const simulator = getSimulator();

  // Default to nearest expiry
  if (!expiry) {
    const expiries = simulator.getExpiries(underlying);
    if (expiries.length > 0) {
      expiry = expiries[0].expiry_date;
    } else {
      expiry = '2026-06-25';
    }
  }

  const matrix = simulator.get7StrikeMatrix(underlying, expiry);
  res.json(matrix);
});

/**
 * GET /api/7strike/signals?underlying={symbol}&expiry={date}
 *
 * Get 7-Strike system signals.
 *
 * Signal logic:
 * - COI PCR > 1.2: Bullish bias (heavy PE writing = support)
 * - COI PCR < 0.8: Bearish bias (heavy CE writing = resistance)
 * - Gate Condition: When bias is strong enough, system enters ZONE_WATCH
 * - Trigger: Requires velocity surge + volume expansion + opposing force collapse
 *
 * States: IDLE, ZONE_WATCH, ACTIVE
 * Gate Conditions: NONE, LONG, SHORT
 */
router.get('/signals', (req: Request, res: Response) => {
  const underlying = (req.query.underlying as string) || 'NIFTY';
  let expiry = req.query.expiry as string | undefined;

  const simulator = getSimulator();

  // Default to nearest expiry
  if (!expiry) {
    const expiries = simulator.getExpiries(underlying);
    if (expiries.length > 0) {
      expiry = expiries[0].expiry_date;
    } else {
      expiry = '2026-06-25';
    }
  }

  const signals = simulator.get7StrikeSignals(underlying, expiry);
  res.json(signals);
});

export default router;
