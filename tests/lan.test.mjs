import test from 'node:test';
import assert from 'node:assert/strict';
import { createLanServer } from '../server.mjs';

test('LAN server creates room, lists rooms on /api/lan-info, syncs race snapshots, and handles mid-race disconnect', async () => {
  const srv = await createLanServer({ port: 0, host: '127.0.0.1', quiet: true });
  try {
    const ws1 = srv.createTestWsClient();
    const ws2 = srv.createTestWsClient();

    const waitMsg = (ws, type) => new Promise((resolve) => {
      const handler = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === type) {
          ws.removeEventListener('message', handler);
          resolve(msg);
        }
      };
      ws.addEventListener('message', handler);
    });

    await Promise.all([
      new Promise((r) => ws1.addEventListener('open', r, { once: true })),
      new Promise((r) => ws2.addEventListener('open', r, { once: true })),
    ]);

    const roomCreatedP = waitMsg(ws1, 'room_state');
    ws1.send(JSON.stringify({ type: 'create_room', name: 'HostWildan', driverId: 'rufus', trackId: 'canyon' }));
    const created = await roomCreatedP;
    assert.equal(created.room.code.length, 4);

    // Check LAN info exposes the room for one-tap join on same Wi-Fi
    const info = srv.getLanInfo();
    assert.equal(info.rooms.length, 1);
    assert.equal(info.rooms[0].code, created.room.code);

    // Player 2 joins room
    const joinedP = waitMsg(ws2, 'room_state');
    ws2.send(JSON.stringify({ type: 'join_room', code: created.room.code, name: 'Guest2', driverId: 'jet' }));
    const joined = await joinedP;
    assert.equal(joined.room.players.length, 2);

    // Start race and verify snapshots stream at 30 Hz
    const snapP = waitMsg(ws2, 'race_snapshot');
    ws1.send(JSON.stringify({ type: 'start_race', fillAI: true }));
    const snap = await snapP;
    assert.equal(snap.snapshot.karts.length, 4);

    // Guest disconnects mid-race; host still receives snapshots without server crash
    ws2.close();
    const nextSnap = await waitMsg(ws1, 'race_snapshot');
    assert.equal(nextSnap.snapshot.karts.length, 4);
    ws1.close();
  } finally {
    await srv.close();
  }
});

test('LAN room settings: default Normal/3 laps, host sets difficulty+laps, players pick their own racer (no duplicates), non-host cannot change settings, race uses them', async () => {
  const srv = await createLanServer({ port: 0, host: '127.0.0.1', quiet: true });
  try {
    const host = srv.createTestWsClient();
    const guest = srv.createTestWsClient();
    await Promise.all([host, guest].map((w) => new Promise((r) => w.addEventListener('open', r, { once: true }))));
    const next = (ws, pred) => new Promise((resolve) => {
      const h = (ev) => { const m = JSON.parse(ev.data); if (pred(m)) { ws.removeEventListener('message', h); resolve(m); } };
      ws.addEventListener('message', h);
    });
    const send = (ws, o) => ws.send(JSON.stringify(o));

    let p = next(host, (m) => m.type === 'room_state');
    send(host, { type: 'create_room', name: 'Host', driverId: 'rufus', trackId: 'temple' });
    const created = (await p).room;
    assert.equal(created.difficulty, 'normal');
    assert.equal(created.laps, 3);
    assert.equal(created.trackId, 'temple');
    const code = created.code;

    p = next(guest, (m) => m.type === 'room_state');
    send(guest, { type: 'join_room', code, name: 'Guest', driverId: 'rufus' });
    const joined = (await p).room;
    assert.notEqual(joined.players[1].driverId, 'rufus', 'duplicate racer is refused at join');

    // guest picks a free racer
    p = next(host, (m) => m.type === 'room_state' && m.room.players[1].driverId === 'volt');
    send(guest, { type: 'select_driver', driverId: 'volt' });
    await p;
    // guest cannot take the host's racer
    const err = next(guest, (m) => m.type === 'error');
    send(guest, { type: 'select_driver', driverId: 'rufus' });
    assert.match((await err).message, /taken/);

    // host options
    p = next(guest, (m) => m.type === 'room_state' && m.room.difficulty === 'pro' && m.room.laps === 1);
    send(host, { type: 'set_options', difficulty: 'pro', laps: 1 });
    await p;
    // guest cannot change them; garbage from the host falls back to a sane value
    send(guest, { type: 'set_options', difficulty: 'santai', laps: 5 });
    p = next(host, (m) => m.type === 'room_state' && m.room.difficulty === 'normal');
    send(host, { type: 'set_options', difficulty: 'impossible', laps: 99 });
    const room = (await p).room;
    assert.equal(room.laps, 1, 'invalid laps ignored');
    assert.equal(room.trackId, 'temple');

    // a race started from the room uses laps and difficulty, and each picked racer is on the grid
    p = next(host, (m) => m.type === 'room_state' && m.room.laps === 5);
    send(host, { type: 'set_options', difficulty: 'santai', laps: 5 });
    await p;
    const snapP = next(guest, (m) => m.type === 'race_snapshot');
    send(host, { type: 'start_race', fillAI: true });
    const snap = (await snapP).snapshot;
    assert.equal(snap.totalLaps, 5);
    assert.equal(snap.trackId, 'temple');
    const humanDrivers = snap.karts.filter((k) => !k.isAI).map((k) => k.driverId).sort();
    assert.deepEqual(humanDrivers, ['rufus', 'volt']);
    assert.equal(new Set(snap.karts.map((k) => k.driverId)).size, 4, 'every kart on the grid is a different racer');
    host.close(); guest.close();
  } finally {
    await srv.close();
  }
});

test('The room list only shows rooms a friend can still join (lobby, free seat), so old rooms never fill the Wi-Fi join screen', async () => {
  const srv = await createLanServer({ port: 0, host: '127.0.0.1', quiet: true });
  try {
    const open = async () => {
      const ws = srv.createTestWsClient();
      const inbox = [];
      ws.on?.('message', () => {});
      return { ws, inbox };
    };
    const waitMsg = (ws, type) => new Promise((resolve) => {
      const handler = (ev) => {
        const m = JSON.parse(typeof ev === 'string' ? ev : ev.data);
        if (m.type === type) { ws.removeEventListener?.('message', handler); resolve(m); }
      };
      ws.addEventListener('message', handler);
    });
    const hostA = (await open()).ws; const hostB = (await open()).ws; const hostC = (await open()).ws;
    const guest = (await open()).ws; const g2 = (await open()).ws; const g3 = (await open()).ws;
    const created = [];
    for (const h of [hostA, hostB, hostC]) {
      const p = waitMsg(h, 'room_state');
      h.send(JSON.stringify({ type: 'create_room', name: 'Host', driverId: 'rufus', trackId: 'island' }));
      created.push((await p).room.code);
    }
    const [codeA, codeB, codeC] = created;
    assert.equal(srv.getLanInfo().rooms.length, 3, 'three open lobbies are listed');

    // B starts racing: no longer joinable
    hostB.send(JSON.stringify({ type: 'start_race', fillAI: true }));
    await new Promise((r) => setTimeout(r, 150));
    // C fills up to 4 players
    for (const g of [guest, g2, g3]) {
      const p = waitMsg(g, 'room_state');
      g.send(JSON.stringify({ type: 'join_room', code: codeC, name: 'G' }));
      await p;
    }
    const codes = srv.getLanInfo().rooms.map((r) => r.code);
    assert.ok(codes.includes(codeA), 'a lobby with a free seat is listed');
    assert.ok(!codes.includes(codeB), 'a room that is racing is not listed');
    assert.ok(!codes.includes(codeC), 'a full room is not listed');
  } finally {
    await srv.close();
  }
});
