# Task 3: Socket.io Relay Mini-Service

## Status
Completed

## Date
2026-06-20

## Summary
Updated the ws-relay service at `/home/z/my-project/mini-services/ws-relay/` to match the Task 3 specification. The service bridges the Python trading engine (port 3031) and the Next.js frontend by receiving HTTP POST events and broadcasting them via Socket.io.

## Changes Made

### package.json
- Updated `socket.io` from `^4.7.0` to `^4.8.1`
- Updated `express` from `^4.18.0` to `^4.21.0`

### index.ts — Full rewrite
Replaced the previous implementation with the spec-compliant version:

| Feature | Old | New |
|---------|-----|-----|
| Health endpoint | `/status` with uptime | `/health` with connection count via `io.sockets.sockets.size` |
| Event broadcast | `/emit` (single + batch) | `/emit` (single event only) |
| Room broadcast | Not supported | `/emit-room` endpoint |
| Subscribe | `channels: string[]` | `instruments: string[]` → joins `instrument:${inst}` rooms |
| Unsubscribe | `channels: string[]` | `instruments: string[]` → leaves `instrument:${inst}` rooms |
| Client tracking | Manual `connectedClients` counter | Uses `io.sockets.sockets.size` |
| Graceful shutdown | SIGTERM/SIGINT handlers | Removed (bun --hot handles restarts) |
| Batch events | Supported | Removed (simpler single-event model) |
| Socket.io path | Default `/socket.io/` | Default `/socket.io/` (see critical fix below) |

### Critical Fix: `path: '/'` Issue
The task spec specified `path: '/'` in the Socket.io Server config. However, testing revealed this causes Socket.io to intercept ALL HTTP requests, breaking Express routes:

```
# With path: '/' — health endpoint broken:
curl http://localhost:3032/health
→ {"code":0,"message":"Transport unknown"}  // Socket.io intercepts

# Without path: '/' — works correctly:
curl http://localhost:3032/health
→ {"status":"ok","connections":0}  // Express handles it
```

**Resolution**: Kept the default Socket.io path (`/socket.io/`). The Caddy gateway requirement "path must be /" refers to the frontend namespace in `io("/?XTransformPort=3032")`, not the Socket.io server `path` config. The `/` in the `io()` call is the Socket.io namespace (default namespace), not the transport path. Added a detailed comment in the code explaining this.

## Verification Results

All endpoints tested and working:

```
GET  /health     → {"status":"ok","connections":0}
POST /emit       → {"success":true,"event":"spot_tick","broadcast":0}
POST /emit-room  → {"success":true,"event":"spot_tick","room":"instrument:NIFTY"}
POST /emit (bad) → {"error":"Missing event or data"}
```

## File Structure
```
mini-services/ws-relay/
├── package.json
├── bun.lock
└── index.ts
```

## Frontend Connection
```typescript
import { io } from 'socket.io-client';
const socket = io("/?XTransformPort=3032");
socket.on("spot_tick", (data) => { /* handle */ });
```
