/**
 * Trading Engine - Main Entry Point
 *
 * Express + Socket.io service on port 3031.
 * Combines REST API endpoints and WebSocket real-time data relay
 * into a single reliable Node.js/Bun service.
 *
 * Replaces both the Python trading engine (port 3031) and the
 * separate WS relay (port 3032).
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { getSimulator } from './market-simulator';
import { UNDERLYINGS } from './types';
import type { SpotTick, OptionTick } from './types';

// Import route modules
import instrumentsRouter from './routes/instruments';
import candlesRouter from './routes/candles';
import optionsRouter from './routes/options';
import pcrRouter from './routes/pcr';
import sevenStrikeRouter from './routes/seven-strike';
import replayRouter from './routes/replay';

const PORT = 3031;

// ============ Express App ============

const app = express();
app.use(express.json({ limit: '10mb' }));

// CORS middleware
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

// ============ HTTP Server + Socket.io ============

const httpServer = createServer(app);

// NOTE: We intentionally do NOT set `path: '/'` here.
// Setting path:'/' causes Socket.io to intercept ALL HTTP requests,
// breaking Express routes like /api/health.
// The Caddy gateway requirement "path must be /" refers to the
// frontend namespace: io("/?XTransformPort=3031") — the "/" there
// is the Socket.io namespace, not the transport path.
// Default path "/socket.io/" works correctly with Caddy.
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ============ Register Routes ============

app.use('/api/instruments', instrumentsRouter);
app.use('/api', candlesRouter);
app.use('/api/option-chain', optionsRouter);
app.use('/api', pcrRouter);
app.use('/api/7strike', sevenStrikeRouter);
app.use('/api/replay', replayRouter);

// ============ Health & Root ============

const startTime = Date.now();

app.get('/api/health', (_req, res) => {
  const simulator = getSimulator();
  res.json({
    status: 'ok',
    mode: 'simulation',
    uptime_seconds: Math.round((Date.now() - startTime) / 1000 * 10) / 10,
    tick_count: simulator.getGlobalTickCount(),
    last_tick_time: lastTickTime,
    connections: io.sockets.sockets.size,
  });
});

app.get('/', (_req, res) => {
  res.json({
    service: 'Trading Engine',
    version: '1.0.0',
    mode: 'simulation',
    endpoints: {
      health: '/api/health',
      search: '/api/instruments/search?q=',
      expiries: '/api/instruments/expiries?underlying=NIFTY',
      candles: '/api/candles?instrument_key=&timeframe=1m',
      option_chain: '/api/option-chain?underlying=NIFTY&expiry=',
      mini_chain: '/api/option-chain/mini?underlying=NIFTY&expiry=',
      oi_data: '/api/oi-data?instrument_key=',
      pcr: '/api/pcr?underlying=NIFTY&expiry=',
      '7strike_matrix': '/api/7strike/matrix?underlying=NIFTY&expiry=',
      '7strike_signals': '/api/7strike/signals?underlying=NIFTY&expiry=',
      replay_sessions: '/api/replay/sessions',
      replay_start: 'POST /api/replay/start',
    },
  });
});

// ============ Socket.io Connection Handling ============

io.on('connection', (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  socket.on('subscribe', (instruments: string[]) => {
    for (const inst of instruments) {
      socket.join(`instrument:${inst}`);
    }
  });

  socket.on('unsubscribe', (instruments: string[]) => {
    for (const inst of instruments) {
      socket.leave(`instrument:${inst}`);
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`[WS] Client disconnected: ${socket.id} (${reason})`);
  });
});

// ============ Market Data Engine Loop ============

let lastTickTime: number | null = null;
let tickInterval: ReturnType<typeof setInterval> | null = null;
let sevenStrikeInterval: ReturnType<typeof setInterval> | null = null;

// Current PCR state for tracking changes
const currentPcr: Record<string, { pcr: number }> = {};

function startSimulation(): void {
  const simulator = getSimulator();

  // Main tick loop — runs every 1 second
  tickInterval = setInterval(() => {
    try {
      for (const symbol of Object.keys(UNDERLYINGS)) {
        const config = UNDERLYINGS[symbol];

        // Generate spot tick
        const spotTick: SpotTick = simulator.generateTick(symbol);
        lastTickTime = spotTick.timestamp;

        // Emit spot_tick via Socket.io
        io.emit('spot_tick', spotTick);
        io.to(`instrument:${symbol}`).emit('spot_tick', spotTick);

        // Generate option ticks for ATM +/- 5 strikes every 5th tick
        if (simulator.getGlobalTickCount() % 5 === 0) {
          const expiries = simulator.getExpiries(symbol);
          if (expiries.length > 0) {
            const expiry = expiries[0].expiry_date;
            const spot = spotTick.ltp;
            const step = config.strikeStep;
            const atm = Math.round(spot / step) * step;

            // OI update data structure
            const oiStrikes: Array<{
              strike: number;
              ce_oi: number;
              ce_change_oi: number;
              pe_oi: number;
              pe_change_oi: number;
            }> = [];

            for (let i = -5; i <= 5; i++) {
              const strike = atm + i * step;
              for (const optType of ['CE', 'PE'] as const) {
                const optTick: OptionTick = simulator.generateOptionTick(symbol, expiry, strike, optType);
                io.to(`instrument:${optTick.instrument_key}`).emit('option_tick', optTick);
              }

              // Collect OI for oi_update event
              const ceKey = `NSE_FO|${symbol}${expiry.replace(/-/g, '').slice(2)}${strike}CE`;
              const peKey = `NSE_FO|${symbol}${expiry.replace(/-/g, '').slice(2)}${strike}PE`;

              // Get current OI data from the simulator
              const ceTick = simulator.generateOptionTick(symbol, expiry, strike, 'CE');
              const peTick = simulator.generateOptionTick(symbol, expiry, strike, 'PE');

              oiStrikes.push({
                strike,
                ce_oi: ceTick.oi,
                ce_change_oi: ceTick.change_oi,
                pe_oi: peTick.oi,
                pe_change_oi: peTick.change_oi,
              });
            }

            // Emit oi_update
            io.emit('oi_update', {
              underlying: symbol,
              strikes: oiStrikes,
            });
          }
        }
      }
    } catch (err) {
      console.error('[Engine] Simulation loop error:', err);
    }
  }, 1000);

  // 7-Strike update loop — runs every 5 seconds
  sevenStrikeInterval = setInterval(() => {
    try {
      for (const symbol of Object.keys(UNDERLYINGS)) {
        const simulator = getSimulator();
        const expiries = simulator.getExpiries(symbol);
        if (expiries.length === 0) continue;

        const expiry = expiries[0].expiry_date;

        const matrix = simulator.get7StrikeMatrix(symbol, expiry);
        const signals = simulator.get7StrikeSignals(symbol, expiry);

        // Emit 7strike_update
        io.emit('7strike_update', { matrix, signals });

        // Calculate and emit pcr_update
        const pcrValue = matrix.coi_pcr;
        const prevPcr = currentPcr[symbol]?.pcr ?? pcrValue;
        const changePcr = Math.round((pcrValue - prevPcr) * 10000) / 10000;

        currentPcr[symbol] = { pcr: pcrValue };

        io.emit('pcr_update', {
          underlying: symbol,
          pcr: pcrValue,
          change_pcr: changePcr,
          spot: matrix.spot_price,
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      console.error('[Engine] 7-Strike update error:', err);
    }
  }, 5000);

  console.log('[Engine] Simulation started - generating ticks every 1 second');
}

// ============ Start Server ============

httpServer.listen(PORT, () => {
  console.log(`[TradingEngine] Service running on port ${PORT}`);
  console.log(`[TradingEngine] REST API: http://localhost:${PORT}/api/health`);
  console.log(`[TradingEngine] Socket.io: ws://localhost:${PORT}/socket.io/`);

  // Start simulation immediately
  startSimulation();
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('[TradingEngine] Shutting down...');
  if (tickInterval) clearInterval(tickInterval);
  if (sevenStrikeInterval) clearInterval(sevenStrikeInterval);
  io.close();
  httpServer.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[TradingEngine] Shutting down...');
  if (tickInterval) clearInterval(tickInterval);
  if (sevenStrikeInterval) clearInterval(sevenStrikeInterval);
  io.close();
  httpServer.close();
  process.exit(0);
});
