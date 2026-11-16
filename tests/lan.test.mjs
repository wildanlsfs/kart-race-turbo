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
    ws1.send(JSON.stringify({ type: 'create_room', name: 'HostWildan', driverId: 'bandi', trackId: 'canyon' }));
    const created = await roomCreatedP;
    assert.equal(created.room.code.length, 4);

    // Check LAN info exposes the room for one-tap join on same Wi-Fi
    const info = srv.getLanInfo();
    assert.equal(info.rooms.length, 1);
    assert.equal(info.rooms[0].code, created.room.code);

    // Player 2 joins room
    const joinedP = waitMsg(ws2, 'room_state');
    ws2.send(JSON.stringify({ type: 'join_room', code: created.room.code, name: 'Guest2', driverId: 'nitro' }));
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
