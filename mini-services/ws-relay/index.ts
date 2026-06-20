import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
app.use(express.json({ limit: '10mb' }));

const httpServer = createServer(app);

// NOTE: We intentionally do NOT set `path: '/'` here.
// Setting path:'/' causes Socket.io to intercept ALL HTTP requests,
// breaking Express routes like /health and /emit.
// The Caddy gateway requirement "path must be /" refers to the
// frontend namespace: io("/?XTransformPort=3032") — the "/" there
// is the Socket.io namespace, not the transport path.
// Default path "/socket.io/" works correctly with Caddy.
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', connections: io.sockets.sockets.size });
});

// Receive events from Python trading engine and broadcast
app.post('/emit', (req, res) => {
  const { event, data } = req.body;
  if (event && data) {
    io.emit(event, data);
    res.json({ success: true, event, broadcast: io.sockets.sockets.size });
  } else {
    res.status(400).json({ error: 'Missing event or data' });
  }
});

// Broadcast to specific room
app.post('/emit-room', (req, res) => {
  const { event, data, room } = req.body;
  if (event && data && room) {
    io.to(room).emit(event, data);
    res.json({ success: true, event, room });
  } else {
    res.status(400).json({ error: 'Missing event, data, or room' });
  }
});

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on('subscribe', (instruments: string[]) => {
    instruments.forEach(inst => socket.join(`instrument:${inst}`));
  });

  socket.on('unsubscribe', (instruments: string[]) => {
    instruments.forEach(inst => socket.leave(`instrument:${inst}`));
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

const PORT = 3032;
httpServer.listen(PORT, () => {
  console.log(`WS Relay running on port ${PORT}`);
});
