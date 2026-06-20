/**
 * Candlestick data routes.
 */

import { Router, type Request, type Response } from 'express';
import { getSimulator } from '../market-simulator';

const router = Router();

/**
 * GET /api/candles?instrument_key={key}&timeframe={1m|3m|5m|15m|1h}
 * Get candlestick data for an instrument.
 *
 * Candle format compatible with lightweight-charts:
 * { time: number (epoch seconds), open, high, low, close, volume }
 */
router.get('/candles', (req: Request, res: Response) => {
  const instrumentKey = (req.query.instrument_key as string) || '';
  const timeframe = (req.query.timeframe as string) || '1m';

  if (!instrumentKey) {
    res.status(400).json({ error: 'instrument_key is required' });
    return;
  }

  const simulator = getSimulator();

  // Determine candle count based on timeframe
  const countMap: Record<string, number> = {
    '1m': 200,
    '3m': 200,
    '5m': 200,
    '15m': 200,
    '1h': 200,
  };
  const count = countMap[timeframe] ?? 200;

  // Check if this is a spot request (e.g., NIFTY_SPOT or just NIFTY)
  const isSpot = instrumentKey.endsWith('_SPOT') || (!instrumentKey.includes('|') && !instrumentKey.includes('CE') && !instrumentKey.includes('PE'));

  let candles;
  if (isSpot) {
    const underlying = instrumentKey.replace('_SPOT', '');
    candles = simulator.getSpotCandles(underlying, timeframe, count);
  } else {
    candles = simulator.generateCandles(instrumentKey, timeframe, count);
  }

  res.json({
    instrument_key: instrumentKey,
    timeframe,
    candles,
  });
});

export default router;
