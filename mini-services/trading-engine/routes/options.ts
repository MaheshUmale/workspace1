/**
 * Option chain routes.
 */

import { Router, type Request, type Response } from 'express';
import { getSimulator } from '../market-simulator';

const router = Router();

/**
 * GET /api/option-chain?underlying={symbol}&expiry={date}
 * Get full option chain for an underlying + expiry (ATM +/- 10 strikes).
 */
router.get('/', (req: Request, res: Response) => {
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

  const chain = simulator.generateOptionChain(underlying, expiry);
  res.json(chain);
});

/**
 * GET /api/option-chain/mini?underlying={symbol}&expiry={date}
 * Get mini option chain (ATM +/- 5 strikes) for an underlying + expiry.
 */
router.get('/mini', (req: Request, res: Response) => {
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

  const chain = simulator.generateMiniOptionChain(underlying, expiry);
  res.json(chain);
});

export default router;
