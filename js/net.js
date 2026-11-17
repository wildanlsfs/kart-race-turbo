// Browser LAN WebSocket Client + Same-Tab BroadcastChannel Fallback (so LAN mode even works in 2 browser tabs without Node server)

export class LanClient {
  constructor({ onRoomState, onSnapshot, onError } = {}) {
    this.onRoomState = onRoomState || (() => {});
    this.onSnapshot = onSnapshot || (() => {});
    this.onError = onError || (() => {});
    this.ws = null;
    this.playerId = null;
    this.room = null;
    this.connected = false;
  }

  async fetchLanInfo() {
    try {
      const res = await fetch('/api/lan-info', { cache: 'no-store' });
      if (!res.ok) return { urls: [window.location.origin], rooms: [] };
      return await res.json();
    } catch (_) {
      return { urls: [window.location.origin], rooms: [] };
    }
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      const timer = setTimeout(() => {
        reject(new Error('LAN server connection timed out. Run `npm run server` on the host machine.'));
      }, 3500);

      ws.addEventListener('open', () => {
        clearTimeout(timer);
        this.connected = true;
        resolve();
      }, { once: true });

      ws.addEventListener('error', () => {
        clearTimeout(timer);
        this.connected = false;
        reject(new Error('Could not connect to Wi-Fi/LAN WebSocket server. Run `npm run server` in terminal.'));
      }, { once: true });

      ws.addEventListener('close', () => {
        this.connected = false;
      });

      ws.addEventListener('message', (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'welcome') {
            this.playerId = msg.playerId;
          } else if (msg.type === 'room_state') {
            this.room = msg.room;
            this.onRoomState(msg.room, this.playerId);
          } else if (msg.type === 'race_snapshot') {
            this.onSnapshot(msg.snapshot, this.playerId);
          } else if (msg.type === 'error') {
            this.onError(msg.message);
          }
        } catch (_) {}
      });
    });
  }

  async createRoom({ name, driverId, trackId, difficulty, laps }) {
    await this.connect();
    this.send({ type: 'create_room', name, driverId, trackId, difficulty, laps });
  }

  async joinRoom({ code, name, driverId }) {
    await this.connect();
    this.send({ type: 'join_room', code: String(code || '').toUpperCase(), name, driverId });
  }

  selectTrack(trackId) {
    this.send({ type: 'select_track', trackId });
  }

  setOptions({ difficulty, laps } = {}) {
    this.send({ type: 'set_options', difficulty, laps });
  }

  selectDriver(driverId) {
    this.send({ type: 'select_driver', driverId });
  }

  startRace(fillAI = true) {
    this.send({ type: 'start_race', fillAI });
  }

  sendInput(input) {
    this.send({ type: 'input', input });
  }

  leaveRoom() {
    this.send({ type: 'leave_room' });
    this.room = null;
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }
}
