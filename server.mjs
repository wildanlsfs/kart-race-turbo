// Zero-dependency Node.js HTTP + RFC 6455 WebSocket Server for Kart Race Turbo Wi-Fi/LAN Multiplayer
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { RaceSimulation, DRIVERS } from './js/sim.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function getLanUrls(port) {
  const nets = os.networkInterfaces();
  const urls = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        urls.push(`http://${net.address}:${port}`);
      }
    }
  }
  if (urls.length === 0) urls.push(`http://localhost:${port}`);
  return urls;
}

function encodeWsFrame(obj) {
  const payload = Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text frame
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function attachWsConnection(socket, onMessage, onClose) {
  let buffer = Buffer.alloc(0);
  let closed = false;

  const send = (data) => {
    if (closed || socket.destroyed) return;
    try {
      socket.write(encodeWsFrame(data));
    } catch (_) {}
  };

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const firstByte = buffer[0];
      const secondByte = buffer[1];
      const opcode = firstByte & 0x0f;
      const isMasked = (secondByte & 0x80) !== 0;
      let payloadLen = secondByte & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (buffer.length < 4) return;
        payloadLen = buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (buffer.length < 10) return;
        payloadLen = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }

      const maskLen = isMasked ? 4 : 0;
      if (buffer.length < offset + maskLen + payloadLen) return;

      const mask = isMasked ? buffer.subarray(offset, offset + 4) : null;
      offset += maskLen;
      const data = Buffer.from(buffer.subarray(offset, offset + payloadLen));
      buffer = buffer.subarray(offset + payloadLen);

      if (opcode === 0x8) {
        // Close frame
        closed = true;
        socket.end();
        return;
      }
      if (opcode === 0x9) {
        // Ping -> Pong
        if (!socket.destroyed) socket.write(Buffer.from([0x8a, 0x00]));
        continue;
      }
      if (opcode === 0x1) {
        if (isMasked && mask) {
          for (let i = 0; i < data.length; i++) {
            data[i] ^= mask[i & 3];
          }
        }
        try {
          const parsed = JSON.parse(data.toString('utf8'));
          onMessage(parsed);
        } catch (_) {}
      }
    }
  });

  const handleClose = () => {
    if (closed) return;
    closed = true;
    onClose();
  };

  socket.on('close', handleClose);
  socket.on('end', handleClose);
  socket.on('error', handleClose);

  return { send, socket };
}

function makeRoomCode(existingRooms) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    if (!existingRooms.has(code)) return code;
  }
  return 'KART';
}

export async function createLanServer({ port = Number(process.env.PORT || 3000), host = '0.0.0.0', quiet = false } = {}) {
  const rooms = new Map();
  const clients = new Set();

  const serializeRoom = (room) => ({
    code: room.code,
    trackId: room.trackId,
    status: room.status,
    hostId: room.hostId,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      driverId: p.driverId,
      connected: p.connected,
    })),
  });

  const broadcastRoom = (room, msg) => {
    const frame = encodeWsFrame(msg);
    for (const p of room.players) {
      if (p.connected && p.client && !p.client.socket.destroyed) {
        try {
          p.client.socket.write(frame);
        } catch (_) {}
      }
    }
  };

  // 30 Hz simulation tick for active LAN rooms
  const tickInterval = setInterval(() => {
    for (const [code, room] of rooms.entries()) {
      if (room.status === 'racing' && room.sim) {
        const snapshot = room.sim.step(1 / 30, room.inputs);
        broadcastRoom(room, { type: 'race_snapshot', code, snapshot });
        if (snapshot.status === 'finished') {
          room.status = 'finished';
          broadcastRoom(room, { type: 'room_state', room: serializeRoom(room) });
        }
      }
    }
  }, 33);

  const server = http.createServer((req, res) => {
    const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (urlObj.pathname === '/api/lan-info') {
      const actualPort = server.address()?.port || port;
      const activeRooms = [];
      for (const room of rooms.values()) {
        activeRooms.push({
          code: room.code,
          trackId: room.trackId,
          hostName: room.players[0]?.name || 'Host',
          playerCount: room.players.filter((p) => p.connected).length,
          status: room.status,
        });
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ urls: getLanUrls(actualPort), rooms: activeRooms }));
      return;
    }

    let reqPath = decodeURIComponent(urlObj.pathname);
    if (reqPath === '/') reqPath = '/index.html';
    const safePath = path.normalize(reqPath).replace(/^(\.\.(\/|\\|$))+/, '');
    const fullPath = path.join(__dirname, safePath);

    if (!fullPath.startsWith(__dirname)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.stat(fullPath, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }
      const ext = path.extname(fullPath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(fullPath).pipe(res);
    });
  });

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(key + WS_MAGIC).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );

    const clientId = `p_${crypto.randomBytes(4).toString('hex')}`;
    let currentRoom = null;

    const leaveCurrentRoom = () => {
      if (!currentRoom) return;
      const room = currentRoom;
      currentRoom = null;
      const player = room.players.find((p) => p.id === clientId);
      if (player) {
        player.connected = false;
        player.client = null;
        // If racing, mark kart as AI fallback so the race continues smoothly
        if (room.sim) {
          const kart = room.sim.karts.find((k) => k.id === clientId);
          if (kart) kart.isAI = true;
        }
      }
      const anyConnected = room.players.some((p) => p.connected);
      if (!anyConnected) {
        rooms.delete(room.code);
      } else {
        if (room.hostId === clientId) {
          const nextHost = room.players.find((p) => p.connected);
          if (nextHost) room.hostId = nextHost.id;
        }
        broadcastRoom(room, { type: 'room_state', room: serializeRoom(room) });
      }
    };

    const client = attachWsConnection(
      socket,
      (msg) => {
        if (!msg || typeof msg.type !== 'string') return;

        if (msg.type === 'create_room') {
          leaveCurrentRoom();
          const code = makeRoomCode(rooms);
          const driverId = DRIVERS.some((d) => d.id === msg.driverId) ? msg.driverId : 'rufus';
          const room = {
            code,
            trackId: msg.trackId || 'island',
            status: 'lobby',
            hostId: clientId,
            players: [{
              id: clientId,
              name: String(msg.name || 'Player 1').slice(0, 18),
              driverId,
              connected: true,
              client,
            }],
            inputs: {},
            sim: null,
          };
          rooms.set(code, room);
          currentRoom = room;
          client.send({ type: 'welcome', playerId: clientId });
          broadcastRoom(room, { type: 'room_state', room: serializeRoom(room) });
          return;
        }

        if (msg.type === 'join_room') {
          const code = String(msg.code || '').trim().toUpperCase();
          const room = rooms.get(code);
          if (!room) {
            client.send({ type: 'error', message: `Room ${code} not found on this Wi-Fi/LAN.` });
            return;
          }
          if (room.players.filter((p) => p.connected).length >= 4) {
            client.send({ type: 'error', message: `Room ${code} is full (4/4 players).` });
            return;
          }
          leaveCurrentRoom();
          const used = new Set(room.players.map((p) => p.driverId));
          const fallbackDriver = DRIVERS.find((d) => !used.has(d.id))?.id || 'jet';
          const wanted = DRIVERS.some((d) => d.id === msg.driverId) ? msg.driverId : fallbackDriver;
          // two racers must not share a driver (identical karts are indistinguishable)
          const driverId = used.has(wanted) ? fallbackDriver : wanted;

          room.players.push({
            id: clientId,
            name: String(msg.name || `Player ${room.players.length + 1}`).slice(0, 18),
            driverId,
            connected: true,
            client,
          });
          currentRoom = room;
          client.send({ type: 'welcome', playerId: clientId });
          broadcastRoom(room, { type: 'room_state', room: serializeRoom(room) });
          return;
        }

        if (msg.type === 'select_track' && currentRoom && currentRoom.hostId === clientId) {
          currentRoom.trackId = msg.trackId || currentRoom.trackId;
          broadcastRoom(currentRoom, { type: 'room_state', room: serializeRoom(currentRoom) });
          return;
        }

        if (msg.type === 'start_race' && currentRoom && currentRoom.hostId === clientId) {
          const activePlayers = currentRoom.players.filter((p) => p.connected).map((p) => ({
            id: p.id,
            name: p.name,
            driverId: p.driverId,
            isAI: false,
          }));
          currentRoom.sim = new RaceSimulation({
            trackId: currentRoom.trackId,
            mode: 'lan',
            players: activePlayers,
            totalLaps: 3,
            fillAI: msg.fillAI !== false,
          });
          currentRoom.status = 'racing';
          broadcastRoom(currentRoom, { type: 'room_state', room: serializeRoom(currentRoom) });
          broadcastRoom(currentRoom, {
            type: 'race_snapshot',
            code: currentRoom.code,
            snapshot: currentRoom.sim.getSnapshot(),
          });
          return;
        }

        if (msg.type === 'input' && currentRoom && currentRoom.status === 'racing') {
          currentRoom.inputs[clientId] = msg.input || {};
          return;
        }

        if (msg.type === 'leave_room') {
          leaveCurrentRoom();
        }
      },
      () => {
        clients.delete(client);
        leaveCurrentRoom();
      }
    );

    clients.add(client);
  });

  await new Promise((resolve, reject) => {
    const tryListen = (p) => {
      const onError = (err) => {
        if (err.code === 'EADDRINUSE' && p !== 0) {
          server.removeListener('error', onError);
          tryListen(p + 1);
        } else {
          reject(err);
        }
      };
      server.once('error', onError);
      server.listen(p, host, () => {
        server.removeListener('error', onError);
        resolve();
      });
    };
    tryListen(port);
  });

  const actualPort = server.address().port;
  const urls = getLanUrls(actualPort);

  if (!quiet) {
    console.log('\n🏁 Kart Race Turbo — Wi-Fi / LAN Multiplayer Server running!');
    console.log(`   Local:   http://localhost:${actualPort}`);
    for (const u of urls) {
      console.log(`   Wi-Fi:   ${u}   <-- Open on other devices on the same network`);
    }
    console.log('');
  }

  return {
    server,
    port: actualPort,
    urls,
    getLanInfo: () => {
      const activeRooms = [];
      for (const room of rooms.values()) {
        activeRooms.push({
          code: room.code,
          trackId: room.trackId,
          hostName: room.players[0]?.name || 'Host',
          playerCount: room.players.filter((p) => p.connected).length,
          status: room.status,
        });
      }
      return { urls: getLanUrls(actualPort), rooms: activeRooms };
    },
    createTestWsClient: () => {
      // Creates an in-process bidirectional stream pair that speaks real RFC 6455 masked frames into server.on('upgrade')
      let serverSide;
      let clientSide;
      const listeners = { message: [], open: [], close: [] };

      serverSide = new Duplex({
        read() {},
        write(chunk, _enc, cb) {
          clientSide.push(chunk);
          cb();
        },
      });
      clientSide = new Duplex({
        read() {},
        write(chunk, _enc, cb) {
          serverSide.push(chunk);
          cb();
        },
      });

      let rxBuf = Buffer.alloc(0);
      let handshakeDone = false;
      clientSide.on('data', (chunk) => {
        rxBuf = Buffer.concat([rxBuf, chunk]);
        if (!handshakeDone) {
          const idx = rxBuf.indexOf('\r\n\r\n');
          if (idx !== -1) {
            handshakeDone = true;
            rxBuf = rxBuf.subarray(idx + 4);
            for (const fn of listeners.open.splice(0)) fn({});
          }
        }
        while (handshakeDone && rxBuf.length >= 2) {
          const b1 = rxBuf[1] & 0x7f;
          let offset = 2;
          let len = b1;
          if (b1 === 126) {
            if (rxBuf.length < 4) break;
            len = rxBuf.readUInt16BE(2);
            offset = 4;
          }
          if (rxBuf.length < offset + len) break;
          const payload = rxBuf.subarray(offset, offset + len).toString('utf8');
          rxBuf = rxBuf.subarray(offset + len);
          for (const fn of [...listeners.message]) fn({ data: payload });
        }
      });

      server.emit('upgrade', { headers: { 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' } }, serverSide);

      return {
        addEventListener(type, fn, opts) {
          if (type === 'open' && handshakeDone) {
            fn({});
            return;
          }
          const wrapped = (ev) => {
            if (opts?.once) this.removeEventListener(type, wrapped);
            fn(ev);
          };
          wrapped._orig = fn;
          listeners[type]?.push(wrapped);
        },
        removeEventListener(type, fn) {
          const arr = listeners[type];
          if (!arr) return;
          const idx = arr.findIndex((f) => f === fn || f._orig === fn);
          if (idx !== -1) arr.splice(idx, 1);
        },
        send(str) {
          const raw = Buffer.from(str, 'utf8');
          const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
          const masked = Buffer.alloc(raw.length);
          for (let i = 0; i < raw.length; i++) masked[i] = raw[i] ^ mask[i & 3];
          const hdr = raw.length < 126
            ? Buffer.from([0x81, 0x80 | raw.length])
            : Buffer.from([0x81, 0x80 | 126, (raw.length >> 8) & 0xff, raw.length & 0xff]);
          clientSide.write(Buffer.concat([hdr, mask, masked]));
        },
        close() {
          serverSide.emit('close');
        },
      };
    },
    close: () => new Promise((resolve) => {
      clearInterval(tickInterval);
      for (const c of clients) {
        try { c.socket.destroy(); } catch (_) {}
      }
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      server.close(() => resolve());
    }),
  };
}

// Start automatically when executed directly (`node server.mjs` or `npm run server`)
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const portArgIdx = process.argv.indexOf('--port');
  const cliPort = portArgIdx !== -1 ? Number(process.argv[portArgIdx + 1]) : Number(process.env.PORT || 3080);
  createLanServer({ port: cliPort });
}
