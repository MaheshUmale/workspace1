/**
 * PCR (Put-Call Ratio) and OI data routes.
 */

import { Router, type Request, type Response } from 'express';
import { getSimulator } from '../market-simulator';

const router = Router();

/**
 * GET /api/pcr?underlying={symbol}&expiry={date}
 * Get PCR data (spot vs PCR vs change in PCR).
 */
router.get('/pcr', (req: Request, res: Response) => {
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

  const pcrData = simulator.generatePcrData(underlying, expiry);
  res.json(pcrData);
});

/**
 * GET /api/oi-data?instrument_key={key}
 * Get OI and Change in OI data for an instrument.
 */
router.get('/oi-data', (req: Request, res: Response) => {
  const instrumentKey = (req.query.instrument_key as string) || '';

  if (!instrumentKey) {
    res.status(400).json({ error: 'instrument_key is required' });
    return;
  }

  const simulator = getSimulator();
  const oiData = simulator.generateOiData(instrumentKey);
  res.json(oiData);
});

export default router;
