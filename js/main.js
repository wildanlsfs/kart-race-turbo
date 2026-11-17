// Main Application Orchestrator for Kart Race Turbo
// Wires 3D Toon Renderer, Webcam Pose Worker, MotionController, Keyboard/Gamepad/Touch Fallback,
// Live Circuit Mini-Map, Single Player, 2-Player Split-Screen, Wi-Fi/LAN Multiplayer, and window.__game debug hooks.

import { MotionController, makeSyntheticPose } from './motion.js';
import { RaceSimulation, TRACKS, DRIVERS, DIFFICULTIES, DEFAULT_DIFFICULTY, normalizeDifficulty, getTrackById } from './sim.js';
import { RaceRenderer } from './renderer.js';
import { SoundFX } from './audio.js';
import { LanClient } from './net.js';
import { WheelTouch, stepKeyWheel, WHEEL_LIMIT_DEG } from './touchsteer.js';
import { AdaptiveScale } from './perf.js';

const ITEM_LABELS = {
  rocket: '🚀 ROCKET',
  bomb: '💣 BOMB',
  tnt: '🧨 TNT CRATE',
  shield: '🛡️ SHIELD',
};

function ordinal(n) {
  return ['1st', '2nd', '3rd', '4th'][n - 1] || `${n}th`;
}

const state = {
  screen: 'menu', // 'menu' | 'calibrate' | 'lan_lobby' | 'racing' | 'finished'
  mode: '1p', // '1p' | '2p' | 'lan'
  selectedTrackId: 'island',
  selectedDriverId: 'rufus', // Player 1 / solo racer
  p2DriverId: 'jet', // Player 2 racer (2P on one screen)
  previewDriverId: 'rufus', // racer shown in the 3D preview
  difficulty: DEFAULT_DIFFICULTY,
  laps: 3,
  autoGas: true,
  webcamEnabled: false,
  webcamReady: false,
  latestPoses: [],
  syntheticPoses: null,
  poseMs: 0,
  fps: 60,
  sim: null,
  lastSnapshot: null,
  lanPlayerId: null,
  lanPrev: null,
  lanCurr: null,
  paused: false,
};

const canvas = document.getElementById('game-canvas');
const renderer = new RaceRenderer(canvas);
const sfx = new SoundFX();
const motionCtrl = new MotionController({ autoGas: true });

const minimapCanvas = document.getElementById('minimap-canvas');
const minimapCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;

// Keyboard & Touch input state
const keys = new Set();
const touchHeld = new Set();

window.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  keys.add(e.code);
});
window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
});

// Action buttons (brake / turbo / punch). Each press is captured by its pointer, so a finger that
// slides off the button keeps holding it; we only release on pointerup / pointercancel / lost capture.
const touchPointers = new Map(); // pointerId -> action
function releaseTouchPointer(id) {
  const action = touchPointers.get(id);
  if (!action) return;
  touchPointers.delete(id);
  if (![...touchPointers.values()].includes(action)) touchHeld.delete(action);
  for (const btn of document.querySelectorAll(`[data-touch="${action}"]`)) btn.classList.toggle('pressed', touchHeld.has(action));
}
for (const btn of document.querySelectorAll('[data-touch]')) {
  const action = btn.getAttribute('data-touch');
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { btn.setPointerCapture(e.pointerId); } catch (_) {}
    touchPointers.set(e.pointerId, action);
    touchHeld.add(action);
    btn.classList.add('pressed');
  });
  const end = (e) => { e.preventDefault(); releaseTouchPointer(e.pointerId); };
  btn.addEventListener('pointerup', end);
  btn.addEventListener('pointercancel', end);
  btn.addEventListener('lostpointercapture', end);
}

// Touch steering wheel: drag around the wheel centre; the wheel angle (+-60 deg) is the input position and it
// springs back to centre on release. Pointer capture keeps a finger that slides off the wheel steering.
const wheelTouch = new WheelTouch();
const steerPadEl = document.getElementById('steer-pad');
const steerArtEl = document.getElementById('steer-wheel-art');
const steerReadoutEl = document.getElementById('steer-readout');
const wheelCenter = () => { const r = steerPadEl.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; };
if (steerPadEl) {
  steerPadEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (wheelTouch.press(e.pointerId, e.clientX, e.clientY, wheelCenter())) {
      try { steerPadEl.setPointerCapture(e.pointerId); } catch (_) {}
      steerPadEl.classList.add('pressed');
    }
  });
  steerPadEl.addEventListener('pointermove', (e) => { wheelTouch.move(e.pointerId, e.clientX, e.clientY); });
  const padEnd = (e) => { e.preventDefault(); if (wheelTouch.release(e.pointerId)) steerPadEl.classList.remove('pressed'); };
  steerPadEl.addEventListener('pointerup', padEnd);
  steerPadEl.addEventListener('pointercancel', padEnd);
  steerPadEl.addEventListener('lostpointercapture', padEnd);
}
function clearTouchInput() {
  touchHeld.clear(); touchPointers.clear(); wheelTouch.clear();
  if (steerPadEl) steerPadEl.classList.remove('pressed');
  for (const b of document.querySelectorAll('[data-touch]')) b.classList.remove('pressed');
}
// returns the touch wheel angle in degrees (+-60)
function updateTouchSteer(dt) {
  const deg = wheelTouch.update(dt);
  if (steerArtEl) steerArtEl.style.transform = `rotate(${deg}deg)`;
  if (steerReadoutEl) steerReadoutEl.textContent = `${Math.round(deg)}\u00b0`;
  return deg;
}
function setHudWheel(prefix, steer) {
  const el = document.getElementById(`${prefix}-wheel`);
  if (el) el.style.transform = `rotate(${(steer * WHEEL_LIMIT_DEG).toFixed(1)}deg)`;
}

// No long-press menu, text selection, image drag or pinch-zoom on the game surface.
for (const type of ['contextmenu', 'dragstart', 'selectstart', 'gesturestart', 'gesturechange']) {
  window.addEventListener(type, (e) => {
    if (!document.body.classList.contains('touch')) return;
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea, select')) return;
    e.preventDefault();
  }, { passive: false });
}

// Menu preview simulation: the 3D scene behind the start flow shows the racer being picked on the chosen circuit.
let menuPreviewSim = null;
function rebuildMenuPreview() {
  menuPreviewSim = new RaceSimulation({
    trackId: state.selectedTrackId,
    mode: '1p',
    players: [{ id: 'showcase', name: 'Showcase', driverId: state.previewDriverId, isAI: true }],
    totalLaps: 3,
    fillAI: false,
  });
  menuPreviewSim.countdown = 0;
  menuPreviewSim.status = 'racing';
}
rebuildMenuPreview();

// Modal visibility switcher
const modals = {
  menu: document.getElementById('menu-modal'),
  calibrate: document.getElementById('calib-modal'),
  lan_lobby: document.getElementById('lan-modal'),
  racing: document.getElementById('race-hud'),
  finished: document.getElementById('finish-modal'),
};
const splitDividerEl = document.getElementById('split-divider');
const btnMenuReturn = document.getElementById('btn-menu-return');
const minimapCardEl = document.getElementById('minimap-card');

function setScreen(screenName) {
  state.screen = screenName;
  document.body.setAttribute('data-screen', screenName);
  document.body.setAttribute('data-mode', state.mode);
  for (const [k, el] of Object.entries(modals)) {
    el.classList.toggle('hidden', k !== screenName);
  }
  btnMenuReturn.classList.toggle('hidden', screenName === 'menu');
  splitDividerEl.classList.toggle('hidden', !(screenName === 'racing' && state.mode === '2p'));
  document.getElementById('hud-p2').classList.toggle('hidden', !(screenName === 'racing' && state.mode === '2p'));
  if (minimapCardEl) {
    minimapCardEl.classList.toggle('hidden', state.mode === '2p');
  }
}
setScreen('menu');

// ===== Arcade start flow: Mode -> Racer -> Circuit -> Ready =====
const LS_CHOICES = 'krt-choices';
const wizEl = document.getElementById('menu-modal');
const wiz = { step: 'mode', pick: 1 };

function saveChoices() {
  try {
    localStorage.setItem(LS_CHOICES, JSON.stringify({
      mode: state.mode, p1: state.selectedDriverId, p2: state.p2DriverId, track: state.selectedTrackId, difficulty: state.difficulty, laps: state.laps,
    }));
  } catch (_) {}
}
function loadChoices() {
  try {
    const c = JSON.parse(localStorage.getItem(LS_CHOICES) || 'null');
    if (!c || typeof c !== 'object') return;
    if (DRIVERS.some((d) => d.id === c.p1)) state.selectedDriverId = c.p1;
    if (DRIVERS.some((d) => d.id === c.p2)) state.p2DriverId = c.p2;
    if (TRACKS.some((t) => t.id === c.track)) state.selectedTrackId = c.track;
    state.difficulty = normalizeDifficulty(c.difficulty);
    if ([1, 3, 5].includes(Number(c.laps))) state.laps = Number(c.laps);
    if (c.mode === '1p' || c.mode === '2p') state.mode = c.mode;
  } catch (_) {}
}
function ensureP2() {
  if (state.p2DriverId === state.selectedDriverId || !DRIVERS.some((d) => d.id === state.p2DriverId)) {
    state.p2DriverId = (DRIVERS.find((d) => d.id !== state.selectedDriverId) || DRIVERS[0]).id;
  }
}
loadChoices();
ensureP2();
state.previewDriverId = state.selectedDriverId;
rebuildMenuPreview();

// Stat bars: normalised over the roster, from the same numbers the simulation uses.
function statPct(key, value) {
  const vals = DRIVERS.map((d) => d.stats[key]);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  return Math.round(25 + ((value - lo) / Math.max(1e-6, hi - lo)) * 75);
}
const statBars = (d) => [['Speed', 'topSpeed'], ['Accel', 'accel'], ['Grip', 'handling']]
  .map(([label, key]) => `<span class="wz-bar"><i>${label}</i><b><u style="width:${statPct(key, d.stats[key])}%"></u></b></span>`).join('');

// -- racer cards
const wzRacersEl = document.getElementById('wz-racers');
function buildRacerCards() {
  wzRacersEl.innerHTML = '';
  for (const d of DRIVERS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wz-racer wz-item';
    btn.dataset.driver = d.id;
    btn.style.setProperty('--pick', d.color);
    btn.innerHTML = `<strong><span class="swatch-dot" style="background:${d.color}"></span>${d.name}</strong><em>${d.role}</em><span class="wz-bars">${statBars(d)}</span><span class="tag hidden"></span>`;
    btn.addEventListener('click', () => pickRacer(d.id));
    wzRacersEl.appendChild(btn);
  }
}
const currentPickId = () => (wiz.pick === 2 ? state.p2DriverId : state.selectedDriverId);
function pickRacer(id) {
  if (wiz.pick === 2 && id === state.selectedDriverId) return; // the two players cannot drive the same racer
  if (wiz.pick === 2) state.p2DriverId = id; else { state.selectedDriverId = id; ensureP2(); }
  state.previewDriverId = id;
  rebuildMenuPreview();
  updateRacerCards();
  saveChoices();
}
function updateRacerCards() {
  const cur = currentPickId();
  for (const btn of wzRacersEl.children) {
    const id = btn.dataset.driver;
    const taken = wiz.pick === 2 && id === state.selectedDriverId;
    btn.classList.toggle('selected', id === cur);
    btn.classList.toggle('taken', taken);
    btn.setAttribute('aria-pressed', id === cur ? 'true' : 'false');
    btn.setAttribute('aria-disabled', taken ? 'true' : 'false');
    const tag = btn.querySelector('.tag');
    tag.classList.toggle('hidden', !taken);
    tag.textContent = taken ? 'Player 1' : '';
  }
  const d = DRIVERS.find((x) => x.id === cur) || DRIVERS[0];
  document.getElementById('wz-racer-detail').innerHTML = `<span style="color:${d.color}">${d.name}</span> · ${d.role}`;
  const who = state.mode === '2p' ? `Player ${wiz.pick}` : '';
  document.getElementById('wz-t-racer').textContent = state.mode === '2p' ? `${who}: choose your racer` : 'Choose your racer';
  document.getElementById('wz-racer-next-txt').textContent = state.mode === '2p' && wiz.pick === 1 ? 'Next: Player 2' : 'Next: circuit';
}

// -- circuit cards (with the real track shape drawn from the same samples the sim uses)
const wzTracksEl = document.getElementById('wz-tracks');
function drawTrackShape(cv, track) {
  const g = cv.getContext('2d');
  const w = cv.width; const h = cv.height;
  g.clearRect(0, 0, w, h);
  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
  for (const s of track.samples) { minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x); minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z); }
  const pad = 14;
  const sc = Math.min((w - pad * 2) / Math.max(1, maxX - minX), (h - pad * 2) / Math.max(1, maxZ - minZ));
  const ox = (w - (maxX - minX) * sc) / 2 - minX * sc;
  const oz = (h - (maxZ - minZ) * sc) / 2 - minZ * sc;
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath();
  track.samples.forEach((s, i) => { const x = ox + s.x * sc; const y = oz + s.z * sc; if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); });
  g.closePath();
  g.strokeStyle = '#2a1a3a'; g.lineWidth = 11; g.stroke();
  g.strokeStyle = track.theme.road; g.lineWidth = 7; g.stroke();
  const s0 = track.samples[0];
  g.fillStyle = '#fff'; g.strokeStyle = '#2a1a3a'; g.lineWidth = 2;
  g.beginPath(); g.arc(ox + s0.x * sc, oz + s0.z * sc, 6, 0, Math.PI * 2); g.fill(); g.stroke();
}
function buildTrackCards() {
  wzTracksEl.innerHTML = '';
  for (const t of TRACKS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wz-card wz-track wz-item';
    btn.dataset.track = t.id;
    btn.innerHTML = `<canvas width="230" height="172"></canvas><strong>${t.name}</strong>
      <span class="wz-meta"><span class="wz-chip ${t.tag.toLowerCase()}">${t.tag}</span><span class="wz-chip">${Math.round(t.totalLength / 10) * 10} m</span></span>
      <small class="wz-mech">${t.mechanic}</small>`;
    drawTrackShape(btn.querySelector('canvas'), t);
    btn.addEventListener('click', () => {
      state.selectedTrackId = t.id;
      rebuildMenuPreview();
      updateCircuitStep();
      saveChoices();
    });
    wzTracksEl.appendChild(btn);
  }
}
function updateCircuitStep() {
  for (const btn of wzTracksEl.children) {
    const on = btn.dataset.track === state.selectedTrackId;
    btn.classList.toggle('selected', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  for (const b of document.querySelectorAll('#wz-diff .wz-seg-btn')) b.classList.toggle('selected', b.dataset.diff === state.difficulty);
  for (const b of document.querySelectorAll('#wz-laps .wz-seg-btn')) b.classList.toggle('selected', Number(b.dataset.laps) === state.laps);
}
for (const b of document.querySelectorAll('#wz-diff .wz-seg-btn')) b.addEventListener('click', () => { state.difficulty = normalizeDifficulty(b.dataset.diff); updateCircuitStep(); saveChoices(); });
for (const b of document.querySelectorAll('#wz-laps .wz-seg-btn')) b.addEventListener('click', () => { state.laps = Number(b.dataset.laps); updateCircuitStep(); saveChoices(); });

function renderSummary() {
  const d1 = DRIVERS.find((d) => d.id === state.selectedDriverId);
  const d2 = DRIVERS.find((d) => d.id === state.p2DriverId);
  const t = getTrackById(state.selectedTrackId);
  const dot = (d) => `<i class="swatch-dot" style="background:${d.color}"></i>`;
  const rows = [
    ['Mode', state.mode === '2p' ? '2 Players, one screen' : 'Solo vs computer'],
    [state.mode === '2p' ? 'Player 1' : 'Racer', `${dot(d1)}${d1.name}`],
  ];
  if (state.mode === '2p') rows.push(['Player 2', `${dot(d2)}${d2.name}`]);
  rows.push(['Circuit', `${t.name} (${Math.round(t.totalLength / 10) * 10} m)`], ['Computer racers', DIFFICULTIES[state.difficulty].name], ['Laps', String(state.laps)]);
  document.getElementById('wz-summary').innerHTML = rows.map(([k, v]) => `<div class="wz-sum-row"><span>${k}</span><b>${v}</b></div>`).join('');
}

// -- step machine
// Paths: solo = mode > racer > circuit > ready; 2p = mode > multi > racer(P1) > racer(P2) > circuit > ready;
// host = mode > multi > role > racer > circuit > ready (create room) > lobby; join = mode > multi > role > racer > join > lobby.
// Back pops a history stack, so it always returns to exactly where you came from and never keeps stale choices.
const WZ_PATHS = {
  solo: [['mode', 1], ['racer', 1], ['circuit', 1], ['ready', 1]],
  '2p': [['mode', 1], ['multi', 1], ['racer', 1], ['racer', 2], ['circuit', 1], ['ready', 1]],
  host: [['mode', 1], ['multi', 1], ['role', 1], ['racer', 1], ['circuit', 1], ['ready', 1]],
  join: [['mode', 1], ['multi', 1], ['role', 1], ['racer', 1], ['join', 1]],
};
const WZ_DOT_LABEL = { mode: 'Mode', multi: 'Multi', role: 'Role', racer: 'Racer', circuit: 'Circuit', ready: 'Start', join: 'Join' };
wiz.path = 'solo';
wiz.stack = [];
function renderDots() {
  const list = WZ_PATHS[wiz.path];
  const dots = document.getElementById('wz-dots');
  const cur = list.findIndex(([st, pk]) => st === wiz.step && pk === wiz.pick);
  dots.innerHTML = list.map(([st, pk], i) => `<li class="${i === cur ? 'on' : (i < cur ? 'done' : '')}">${st === 'racer' && wiz.path === '2p' ? `P${pk}` : WZ_DOT_LABEL[st]}</li>`).join('');
}
function wizRender(step, pick) {
  wiz.step = step;
  wiz.pick = pick;
  wizEl.dataset.step = step;
  for (const sec of wizEl.querySelectorAll('.wz-step')) sec.classList.toggle('hidden', sec.dataset.step !== step);
  renderDots();
  state.previewDriverId = step === 'racer' ? currentPickId() : state.selectedDriverId;
  if (step === 'racer') updateRacerCards();
  if (step === 'circuit') updateCircuitStep();
  if (step === 'ready') {
    renderSummary();
    const host = wiz.path === 'host';
    document.getElementById('wz-host-name-row').classList.toggle('hidden', !host);
    document.getElementById('wz-host-error').classList.add('hidden');
    document.getElementById('wz-start-sub').textContent = host ? 'Creates the room; friends join with the code' : (state.mode === '2p' ? 'Camera is optional - keyboard works for both' : 'Camera is optional');
    document.querySelector('#wz-start strong').textContent = host ? 'CREATE ROOM' : 'START!';
  }
  if (step === 'join') refreshLanLobby();
  rebuildMenuPreview();
  setTimeout(() => focusStepDefault(), 30);
}
// Go to a step, remembering where we came from. Jumping to a step that is already in the history unwinds to it.
function wizGo(step, pick = 1) {
  const all = [...wiz.stack, { step: wiz.step, pick: wiz.pick }];
  const idx = all.findLastIndex((e) => e.step === step && e.pick === pick);
  wiz.stack = idx >= 0 ? all.slice(0, idx) : all;
  wizRender(step, pick);
}
function wizReset() {
  wiz.stack = [];
  wiz.path = 'solo';
  state.mode = '1p';
  wizRender('mode', 1);
}
function focusStepDefault() {
  if (state.screen !== 'menu') return;
  const sec = wizEl.querySelector(`.wz-step[data-step="${wiz.step}"]`);
  if (!sec) return;
  const target = sec.querySelector('.selected.wz-item') || sec.querySelector('.wz-item');
  if (target) { try { target.focus({ preventScroll: true }); } catch (_) {} }
}
function wizBack() {
  const prev = wiz.stack.pop();
  if (!prev) return;
  wizRender(prev.step, prev.pick);
}
function wizNext() {
  const list = WZ_PATHS[wiz.path];
  const i = list.findIndex(([st, pk]) => st === wiz.step && pk === wiz.pick);
  const n = list[i + 1];
  if (n) wizGo(n[0], n[1]);
}
function choosePath(path) {
  wiz.path = path;
  state.mode = path === '2p' ? '2p' : (path === 'solo' ? '1p' : 'lan');
  ensureP2();
  saveChoices();
  wizNext();
}
for (const b of wizEl.querySelectorAll('[data-step="mode"] [data-pick]')) b.addEventListener('click', () => { if (b.dataset.pick === 'solo') choosePath('solo'); else { wiz.path = '2p'; wizGo('multi'); } });
for (const b of wizEl.querySelectorAll('[data-step="multi"] [data-pick]')) b.addEventListener('click', () => { if (b.dataset.pick === '2p') choosePath('2p'); else { wiz.path = 'host'; wizGo('role'); } });
for (const b of wizEl.querySelectorAll('[data-step="role"] [data-pick]')) b.addEventListener('click', () => choosePath(b.dataset.pick === 'host' ? 'host' : 'join'));
document.getElementById('wz-back').addEventListener('click', wizBack);
document.getElementById('wz-racer-next').addEventListener('click', wizNext);
document.getElementById('wz-circuit-next').addEventListener('click', wizNext);
document.getElementById('wz-start').addEventListener('click', () => {
  saveChoices();
  if (wiz.path === 'host') {
    const name = document.getElementById('lan-player-name-host').value || 'Host';
    lanClient.createRoom({ name, driverId: state.selectedDriverId, trackId: state.selectedTrackId, difficulty: state.difficulty, laps: state.laps })
      .catch((e) => showLanError(e.message));
    return;
  }
  openCalibration(() => startLocalRace(state.mode));
});
buildRacerCards();
buildTrackCards();
updateCircuitStep();

// Keyboard: arrows move between big buttons (and pick racers), Enter confirms, Esc goes back.
window.addEventListener('keydown', (e) => {
  if (state.screen !== 'menu') return;
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  const sec = wizEl.querySelector(`.wz-step[data-step="${wiz.step}"]`);
  const items = [...sec.querySelectorAll('.wz-item')].filter((el) => !el.disabled && !el.classList.contains('taken'));
  const cur = items.indexOf(document.activeElement);
  if (e.code === 'Escape') { e.preventDefault(); wizBack(); return; }
  if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(e.code)) {
    e.preventDefault();
    if (!items.length) return;
    const dir = e.code === 'ArrowLeft' || e.code === 'ArrowUp' ? -1 : 1;
    const base = cur >= 0 ? cur : Math.max(0, items.findIndex((el) => el.classList.contains('selected')));
    const next = items[(base + dir + items.length) % items.length];
    next.focus({ preventScroll: true });
    if (next.classList.contains('wz-racer') || next.classList.contains('wz-track')) next.click();
    return;
  }
  if (e.code === 'Enter' || e.code === 'NumpadEnter') {
    const a = document.activeElement;
    if (a && a.classList && a.classList.contains('wz-racer')) { e.preventDefault(); pickRacer(a.dataset.driver); wizNext(); return; }
    if (a && a.classList && a.classList.contains('wz-track')) { e.preventDefault(); a.click(); wizNext(); return; }
    if (!a || a === document.body || !a.classList.contains('wz-item')) {
      e.preventDefault();
      const primary = sec.querySelector('.wz-next, .wz-start');
      if (primary) primary.click(); else if (items[0]) items[0].click();
    }
  }
});

// Top Utility Buttons
const btnAutoGas = document.getElementById('btn-auto-gas');
btnAutoGas.addEventListener('click', () => {
  state.autoGas = !state.autoGas;
  motionCtrl.setAutoGas(state.autoGas);
  btnAutoGas.querySelector('.lbl').textContent = `Auto-Gas: ${state.autoGas ? 'ON' : 'WHEEL'}`;
  btnAutoGas.classList.toggle('active', state.autoGas);
});

const btnComfort = document.getElementById('btn-comfort');
btnComfort.addEventListener('click', () => {
  renderer.comfortMode = !renderer.comfortMode;
  btnComfort.querySelector('.lbl').textContent = `Comfort: ${renderer.comfortMode ? 'ON' : 'OFF'}`;
  try { localStorage.setItem('krt-comfort', renderer.comfortMode ? '1' : '0'); } catch (_) {}
  btnComfort.classList.toggle('active', renderer.comfortMode);
});

const btnSound = document.getElementById('btn-sound');
btnSound.addEventListener('click', () => {
  const muted = sfx.toggleMute();
  btnSound.querySelector('.ico').textContent = muted ? '🔇' : '🔊';
  btnSound.querySelector('.lbl').textContent = muted ? 'Muted' : 'SFX';
});

// Restore the comfort preference and honour the OS reduce-motion setting (comfort = calmer camera).
try {
  const saved = localStorage.getItem('krt-comfort');
  if (saved !== null) renderer.comfortMode = saved === '1';
  else if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) renderer.comfortMode = true;
} catch (_) {}
btnComfort.querySelector('.lbl').textContent = `Comfort: ${renderer.comfortMode ? 'ON' : 'OFF'}`;
btnComfort.classList.toggle('active', renderer.comfortMode);

// Touch controls only appear on touch devices (or once a touch is seen).
const isTouchDevice = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;
if (isTouchDevice) document.body.classList.add('touch');
window.addEventListener('touchstart', () => document.body.classList.add('touch'), { once: true, passive: true });

const pauseModalEl = document.getElementById('pause-modal');
function setPaused(v) {
  state.paused = Boolean(v) && state.screen === 'racing' && state.mode !== 'lan' && Boolean(state.sim);
  pauseModalEl.classList.toggle('hidden', !state.paused);
  if (state.paused) { clearTouchInput(); keys.clear(); }
}
function leaveToMenu() {
  if (state.mode === 'lan') lanClient.leaveRoom();
  state.sim = null;
  setPaused(false);
  setScreen('menu');
  wizReset();
}
// In a local race the Menu button pauses first (a stray tap must not throw the race away).
btnMenuReturn.addEventListener('click', () => {
  if (state.screen === 'racing' && state.mode !== 'lan' && state.sim && state.sim.status !== 'finished') setPaused(true);
  else leaveToMenu();
});
document.getElementById('btn-pause-resume').addEventListener('click', () => setPaused(false));
document.getElementById('btn-pause-restart').addEventListener('click', () => { setPaused(false); startLocalRace(state.mode); });
document.getElementById('btn-pause-menu').addEventListener('click', leaveToMenu);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (state.screen === 'racing' && state.mode !== 'lan') setPaused(!state.paused);
  }
});
window.addEventListener('blur', () => { keys.clear(); clearTouchInput(); if (state.screen === 'racing' && state.mode !== 'lan') setPaused(true); });

// Webcam & Pose Worker Setup (with Main-Thread fallback matching jagoan-kotak/js/main.js)
const videoEl = document.getElementById('webcam-video');
const pipCanvas = document.getElementById('webcam-overlay');
const pipCtx = pipCanvas.getContext('2d');
const pipStatusEl = document.getElementById('pip-status');
let poseWorker = null;
let mainThreadLandmarker = null;
let workerBusy = false;
let lastVideoTime = -1;
let cameraStartPromise = null;

function initPoseWorker() {
  return new Promise((resolve, reject) => {
    let w;
    try {
      w = new Worker(new URL('./pose-worker.js', import.meta.url));
    } catch (e) {
      reject(e);
      return;
    }
    const timer = setTimeout(() => {
      w.terminate();
      reject(new Error('Pose worker init timeout'));
    }, 15000);

    w.onerror = (err) => {
      clearTimeout(timer);
      w.terminate();
      reject(err);
    };

    w.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'ready') {
        clearTimeout(timer);
        w.onerror = null;
        resolve(w);
      } else if (d.type === 'error') {
        clearTimeout(timer);
        w.terminate();
        reject(new Error(d.message || 'Worker error'));
      } else if (d.type === 'poses') {
        workerBusy = false;
        state.poseMs = d.poseMs || 0;
        state.latestPoses = (d.landmarks || []).map((lm, idx) => ({
          landmarks: lm,
          worldLandmarks: d.worldLandmarks ? d.worldLandmarks[idx] : null,
        }));
      }
    };
    w.postMessage({ type: 'init', numPoses: 2 });
  });
}

async function initMainThreadLandmarker() {
  const visionMod = await import('./vendor/mediapipe/vision_bundle.mjs');
  const { FilesetResolver, PoseLandmarker } = visionMod;
  const files = await FilesetResolver.forVisionTasks(new URL('./vendor/mediapipe/wasm', import.meta.url).href);
  for (const delegate of ['GPU', 'CPU']) {
    try {
      return await PoseLandmarker.createFromOptions(files, {
        baseOptions: {
          modelAssetPath: new URL('./vendor/mediapipe/pose_landmarker_lite.task', import.meta.url).href,
          delegate,
        },
        runningMode: 'VIDEO',
        numPoses: 2,
      });
    } catch (_) {}
  }
  throw new Error('Main-thread PoseLandmarker failed');
}

async function startWebcamAndWorker() {
  if (state.webcamEnabled && state.webcamReady) return true;
  if (cameraStartPromise) return cameraStartPromise;

  cameraStartPromise = (async () => {
    try {
      pipStatusEl.textContent = '📷 Allow Camera...';
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
      videoEl.srcObject = stream;
      await videoEl.play();
      state.webcamEnabled = true;

      pipStatusEl.textContent = '⏳ Loading Pose AI...';
      try {
        poseWorker = await initPoseWorker();
        state.webcamReady = true;
        pipStatusEl.textContent = '📷 Motion Active';
      } catch (workerErr) {
        console.warn('Pose worker fallback to main thread:', workerErr);
        poseWorker = null;
        mainThreadLandmarker = await initMainThreadLandmarker();
        state.webcamReady = true;
        pipStatusEl.textContent = '📷 Motion Active';
      }

      const pumpVideoFrame = async () => {
        if (!state.webcamEnabled) return;
        if (state.webcamReady && videoEl.readyState >= 2 && videoEl.currentTime !== lastVideoTime) {
          lastVideoTime = videoEl.currentTime;
          if (poseWorker) {
            if (!workerBusy) {
              workerBusy = true;
              createImageBitmap(videoEl, { resizeWidth: 480, resizeHeight: 360 })
                .then((bmp) => poseWorker.postMessage({ type: 'frame', bitmap: bmp, ts: performance.now() }, [bmp]))
                .catch(() => { workerBusy = false; });
            }
          } else if (mainThreadLandmarker) {
            const t0 = performance.now();
            try {
              const res = mainThreadLandmarker.detectForVideo(videoEl, t0);
              state.poseMs = performance.now() - t0;
              state.latestPoses = (res.landmarks || []).map((lm, idx) => ({
                landmarks: lm,
                worldLandmarks: res.worldLandmarks ? res.worldLandmarks[idx] : null,
              }));
            } catch (_) {}
          }
        }
        if ('requestVideoFrameCallback' in videoEl) {
          videoEl.requestVideoFrameCallback(pumpVideoFrame);
        } else {
          setTimeout(pumpVideoFrame, 33);
        }
      };
      pumpVideoFrame();
      return true;
    } catch (err) {
      console.warn('Camera unavailable:', err);
      pipStatusEl.textContent = '⌨️ Keyboard Mode';
      cameraStartPromise = null;
      return false;
    }
  })();

  return cameraStartPromise;
}

function syncCameraUi() {
  const on = Boolean(state.webcamEnabled || state.syntheticPoses);
  document.body.classList.toggle('cam-on', on);
}

function drawPipOverlay(motionInputs) {
  if (!document.body.classList.contains('cam-on')) return;
  const w = pipCanvas.width;
  const h = pipCanvas.height;
  pipCtx.clearRect(0, 0, w, h);

  if (state.webcamEnabled && videoEl.readyState >= 2) {
    pipCtx.save();
    pipCtx.translate(w, 0);
    pipCtx.scale(-1, 1);
    pipCtx.drawImage(videoEl, 0, 0, w, h);
    pipCtx.restore();
  } else {
    pipCtx.fillStyle = '#1b2a44';
    pipCtx.fillRect(0, 0, w, h);
  }

  // Draw calibrated neutral center guide line
  if (state.mode === '2p') {
    pipCtx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    pipCtx.lineWidth = 2;
    pipCtx.beginPath();
    pipCtx.moveTo(w * 0.5, 0);
    pipCtx.lineTo(w * 0.5, h);
    pipCtx.stroke();
  } else if (motionCtrl.slots[0].calibrated) {
    const nx = (1 - motionCtrl.slots[0].neutralX) * w;
    pipCtx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    pipCtx.setLineDash([4, 4]);
    pipCtx.lineWidth = 1.5;
    pipCtx.beginPath();
    pipCtx.moveTo(nx, 0);
    pipCtx.lineTo(nx, h);
    pipCtx.stroke();
    pipCtx.setLineDash([]);
  }

  const poses = state.syntheticPoses || state.latestPoses;
  for (let pIdx = 0; pIdx < poses.length; pIdx++) {
    const lm = poses[pIdx].landmarks || poses[pIdx];
    if (!lm || lm.length < 17) continue;
    const color = pIdx === 0 ? '#5bd77a' : '#ffd166';
    pipCtx.strokeStyle = color;
    pipCtx.lineWidth = 3.5;
    pipCtx.lineCap = 'round';

    const pairs = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24]];
    for (const [a, b] of pairs) {
      if (!lm[a] || !lm[b]) continue;
      pipCtx.beginPath();
      pipCtx.moveTo((1 - lm[a].x) * w, lm[a].y * h);
      pipCtx.lineTo((1 - lm[b].x) * w, lm[b].y * h);
      pipCtx.stroke();
    }

    pipCtx.fillStyle = '#ffd166';
    for (const idx of [0, 11, 12, 15, 16]) {
      if (!lm[idx]) continue;
      pipCtx.beginPath();
      pipCtx.arc((1 - lm[idx].x) * w, lm[idx].y * h, 4.5, 0, Math.PI * 2);
      pipCtx.fill();
    }

    if (lm[15] && lm[16]) {
      const x1 = (1 - lm[15].x) * w;
      const y1 = lm[15].y * h;
      const x2 = (1 - lm[16].x) * w;
      const y2 = lm[16].y * h;
      const cx = (x1 + x2) * 0.5;
      const cy = (y1 + y2) * 0.5;
      pipCtx.strokeStyle = '#5ef0ff';
      pipCtx.lineWidth = 2.5;
      pipCtx.beginPath();
      pipCtx.arc(cx, cy, 18, 0, Math.PI * 2);
      pipCtx.moveTo(x1, y1);
      pipCtx.lineTo(x2, y2);
      pipCtx.stroke();
    }
  }

  const inp = motionInputs[0];
  if (inp) {
    pipCtx.fillStyle = 'rgba(42, 26, 58, 0.85)';
    pipCtx.beginPath();
    pipCtx.roundRect(6, 6, 108, 22, 8);
    pipCtx.fill();
    pipCtx.fillStyle = '#ffd166';
    pipCtx.font = '700 11px Fredoka, system-ui, sans-serif';
    pipCtx.fillText(inp.poseLabel || 'READY', 12, 21);
  }
}

function drawMinimap(snapshot) {
  if (!minimapCtx || !snapshot || state.mode === '2p') return;
  const track = getTrackById(snapshot.trackId);
  const w = minimapCanvas.width;
  const h = minimapCanvas.height;
  minimapCtx.clearRect(0, 0, w, h);

  // Compute bounding box of track samples
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of track.samples) {
    if (s.x < minX) minX = s.x;
    if (s.x > maxX) maxX = s.x;
    if (s.z < minZ) minZ = s.z;
    if (s.z > maxZ) maxZ = s.z;
  }
  const pad = 14;
  const spanX = Math.max(1, maxX - minX);
  const spanZ = Math.max(1, maxZ - minZ);
  const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanZ);
  const ox = (w - spanX * scale) * 0.5 - minX * scale;
  const oz = (h - spanZ * scale) * 0.5 - minZ * scale;

  // Draw circuit loop
  minimapCtx.lineCap = 'round';
  minimapCtx.lineJoin = 'round';
  minimapCtx.beginPath();
  track.samples.forEach((s, idx) => {
    const px = ox + s.x * scale;
    const py = oz + s.z * scale;
    if (idx === 0) minimapCtx.moveTo(px, py);
    else minimapCtx.lineTo(px, py);
  });
  minimapCtx.closePath();
  minimapCtx.strokeStyle = '#2a1a3a';
  minimapCtx.lineWidth = 9;
  minimapCtx.stroke();
  minimapCtx.strokeStyle = '#e9c99a';
  minimapCtx.lineWidth = 5;
  minimapCtx.stroke();

  // Draw karts as colored dots
  for (const k of snapshot.karts) {
    const drv = DRIVERS.find((d) => d.id === k.driverId) || DRIVERS[0];
    const px = ox + k.x * scale;
    const py = oz + k.z * scale;
    minimapCtx.fillStyle = drv.color;
    minimapCtx.strokeStyle = '#fff';
    minimapCtx.lineWidth = 2;
    minimapCtx.beginPath();
    minimapCtx.arc(px, py, k.isAI ? 4.5 : 6.5, 0, Math.PI * 2);
    minimapCtx.fill();
    minimapCtx.stroke();
  }
}

// Calibration Flow (waits for AI model + real pose detection before completing countdown)
const calibTimerEl = document.getElementById('calib-timer');
const calibHintEl = document.getElementById('calib-hint');
let pendingAfterCalib = null;
let calibInterval = null;

function stopCalibLoop() {
  if (calibInterval) {
    clearInterval(calibInterval);
    calibInterval = null;
  }
}

function openCalibration(afterCb) {
  stopCalibLoop();
  pendingAfterCalib = afterCb;
  calibTimerEl.textContent = 'Ready';
  calibHintEl.textContent = state.mode === '2p'
    ? 'Player 1 stands on the LEFT, Player 2 stands on the RIGHT.'
    : 'Sit or stand facing the camera so your head and shoulders are visible.';
  setScreen('calibrate');
}

document.getElementById('btn-start-cam').addEventListener('click', async () => {
  stopCalibLoop();
  calibTimerEl.textContent = 'Loading Camera...';
  calibHintEl.textContent = 'Please allow browser webcam access when prompted.';
  const ok = await startWebcamAndWorker();
  if (!ok) {
    calibTimerEl.textContent = 'No Camera';
    if (pendingAfterCalib) pendingAfterCalib();
    return;
  }

  let heldSec = 0;
  let lastBeepSec = 4;
  calibTimerEl.textContent = 'Look at Camera 👀';

  let waitedSec = 0;
  calibInterval = setInterval(() => {
    const poses = state.syntheticPoses || state.latestPoses;
    if (poses.length === 0) {
      waitedSec += 0.2;
      calibTimerEl.textContent = 'Step Into View 👀';
      calibHintEl.textContent = waitedSec > 8
        ? 'Still nobody detected. Check lighting and that your shoulders are in frame, or press "Play Without Camera" below.'
        : 'Make sure your head and shoulders are visible in the camera box (bottom-right).';
      return;
    }

    heldSec += 0.2;
    const rem = Math.max(0, Math.ceil(2.4 - heldSec));
    calibHintEl.textContent = 'Awesome, camera sees you! Hold your neutral center posture... 👍';
    if (rem > 0) {
      calibTimerEl.textContent = `${rem}...`;
      if (rem !== lastBeepSec) {
        lastBeepSec = rem;
        sfx.countdown(rem);
      }
    } else {
      stopCalibLoop();
      motionCtrl.calibrate(poses, state.mode === '2p' ? 2 : 1);
      calibTimerEl.textContent = 'Calibrated! 🏁';
      pipStatusEl.textContent = '📷 Calibrated & Active';
      sfx.countdown(0);
      if (pendingAfterCalib) pendingAfterCalib();
    }
  }, 200);
});

document.getElementById('btn-skip-cam').addEventListener('click', () => {
  stopCalibLoop();
  if (pendingAfterCalib) pendingAfterCalib();
});

document.getElementById('btn-recalibrate').addEventListener('click', async () => {
  if (!state.webcamEnabled) {
    await startWebcamAndWorker();
  }
  const poses = state.syntheticPoses || state.latestPoses;
  if (poses.length > 0) {
    motionCtrl.calibrate(poses, state.mode === '2p' ? 2 : 1);
    pipStatusEl.textContent = '📷 Center Locked! 👍';
    sfx.countdown(0);
  } else {
    pipStatusEl.textContent = '👀 Step in front of cam';
  }
});

// Start Local Race (1P or 2P Split-Screen)
function startLocalRace(mode) {
  state.mode = mode;
  ensureP2();
  const p1Driver = state.selectedDriverId;
  const p2Driver = state.p2DriverId;
  const players = mode === '2p'
    ? [
        { id: 'p1', name: 'Player 1', driverId: p1Driver, isAI: false },
        { id: 'p2', name: 'Player 2', driverId: p2Driver, isAI: false },
      ]
    : [{ id: 'p1', name: 'Player 1', driverId: p1Driver, isAI: false }];

  state.sim = new RaceSimulation({
    trackId: state.selectedTrackId,
    mode,
    players,
    totalLaps: state.laps,
    difficulty: state.difficulty,
    fillAI: true,
  });
  renderer.camStates[0].initialized = false;
  renderer.camStates[1].initialized = false;
  state.paused = false;
  pauseModalEl.classList.add('hidden');
  setScreen('racing');
  if (document.body.classList.contains('touch') && innerHeight > innerWidth && mode !== '2p') showBanner('Turn the tablet sideways for a wider view', 'info', 3000);
}

// Wi-Fi / LAN Multiplayer Wiring
const lanErrorEl = document.getElementById('lan-error');
const lanUrlTextEl = document.getElementById('lan-url-text');
const lanRoomsListEl = document.getElementById('lan-rooms-list');
const roomCodeDisplayEl = document.getElementById('room-code-display');
const roomTrackDisplayEl = document.getElementById('room-track-display');
const roomPlayersListEl = document.getElementById('room-players-list');
const btnLanStart = document.getElementById('btn-lan-start');

function showLanError(msg) {
  for (const el of [lanErrorEl, document.getElementById('wz-host-error')]) {
    if (!el) continue;
    if (!msg) { el.classList.add('hidden'); continue; }
    el.textContent = msg;
    el.classList.remove('hidden');
  }
}

const lanClient = new LanClient({
  onRoomState: (room, myPlayerId) => {
    state.lanPlayerId = myPlayerId;
    showLanError('');
    if (room.status === 'racing') {
      setScreen('racing');
      return;
    }
    if (state.screen === 'menu') setScreen('lan_lobby');
    roomCodeDisplayEl.textContent = room.code;
    roomTrackDisplayEl.textContent = getTrackById(room.trackId).name;
    roomPlayersListEl.innerHTML = '';
    for (const p of room.players) {
      if (!p.connected) continue;
      const row = document.createElement('div');
      row.className = 'room-item';
      row.innerHTML = `
        <strong>${p.name} ${p.id === room.hostId ? '👑 (Host)' : ''} ${p.id === myPlayerId ? '(You)' : ''}</strong>
        <span>${(DRIVERS.find((d) => d.id === p.driverId) || {}).name || p.driverId}</span>
      `;
      roomPlayersListEl.appendChild(row);
    }
    btnLanStart.style.display = room.hostId === myPlayerId ? 'flex' : 'none';
    renderLanPickers(room, myPlayerId);
  },
  onSnapshot: (snapshot, myPlayerId) => {
    state.lanPlayerId = myPlayerId;
    state.lanPrev = state.lanCurr;
    state.lanCurr = { snap: snapshot, t: performance.now() };
    state.lastSnapshot = snapshot;
    handleSimulationEvents(snapshot.events || [], snapshot.totalLaps);
    if (state.screen !== 'racing' && snapshot.status !== 'finished') {
      setScreen('racing');
    }
    if (snapshot.status === 'finished' && state.screen !== 'finished') {
      showFinishModal(snapshot);
    }
  },
  onError: (msg) => showLanError(msg),
});

// Lobby: shows who joined and the host's settings (circuit, difficulty, laps); only the host can start.
function renderLanPickers(room, myId) {
  const isHost = room.hostId === myId;
  const me = room.players.find((p) => p.id === myId);
  if (me && DRIVERS.some((d) => d.id === me.driverId)) state.selectedDriverId = me.driverId;
  const t = getTrackById(room.trackId);
  document.getElementById('lan-room-info').textContent = `${t.name} (${Math.round(t.totalLength / 10) * 10} m) · ${DIFFICULTIES[room.difficulty] ? DIFFICULTIES[room.difficulty].name : 'Normal'} · ${room.laps} laps`;
  document.getElementById('lan-wait-note').textContent = isHost ? 'Press Start when everybody has joined.' : 'Waiting for the host to start the race...';
}

async function refreshLanLobby() {
  showLanError('');
  const info = await lanClient.fetchLanInfo();
  if (info.urls && info.urls.length > 0) {
    lanUrlTextEl.textContent = info.urls[0];
  }
  lanRoomsListEl.innerHTML = '';
  if (!info.rooms || info.rooms.length === 0) {
    lanRoomsListEl.innerHTML = '<p class="muted-note">No rooms yet. Ask the host to create one.</p>';
    return;
  }
  for (const r of info.rooms) {
    const item = document.createElement('div');
    item.className = 'room-item';
    item.innerHTML = `
      <div>
        <strong>Room ${r.code}</strong> — ${getTrackById(r.trackId).name}
        <br/><small>Host: ${r.hostName} (${r.playerCount}/4 players)</small>
      </div>
      <button type="button" class="pip-mini-btn">Join</button>
    `;
    item.querySelector('button').addEventListener('click', () => {
      const name = document.getElementById('lan-player-name').value || 'Guest';
      lanClient.joinRoom({ code: r.code, name, driverId: state.selectedDriverId }).catch((e) => showLanError(e.message));
    });
    lanRoomsListEl.appendChild(item);
  }
}

// Leaving the lobby goes back to the step you came from (host: Ready, joiner: Join), with the room left.
function leaveLobby() {
  lanClient.leaveRoom();
  state.lanCurr = null; state.lanPrev = null;
  setScreen('menu');
  wizRender(wiz.step, wiz.pick);
  if (wiz.path === 'join') refreshLanLobby();
}
document.getElementById('btn-lan-back').addEventListener('click', leaveLobby);
document.getElementById('btn-lan-refresh').addEventListener('click', refreshLanLobby);

document.getElementById('btn-lan-join').addEventListener('click', () => {
  const code = document.getElementById('lan-room-code').value.trim().toUpperCase();
  if (code.length !== 4) {
    showLanError('Enter a 4-letter room code.');
    return;
  }
  const name = document.getElementById('lan-player-name').value || 'Guest Racer';
  lanClient.joinRoom({
    code,
    name,
    driverId: state.selectedDriverId,
  }).catch((e) => showLanError(e.message));
});

document.getElementById('btn-lan-start').addEventListener('click', () => {
  lanClient.startRace(true);
});

document.getElementById('btn-lan-camera').addEventListener('click', () => {
  openCalibration(() => setScreen('lan_lobby'));
});

document.getElementById('btn-lan-leave').addEventListener('click', leaveLobby);

// Combine Webcam Motion Input + Keyboard/Touch Input
let touchSteerValue = 0;
let frameDt = 1 / 60;
const kbWheelDeg = [0, 0]; // keyboard wheel angle per player (degrees)
function buildCombinedInput(playerIdx, motionInput) {
  const isP1 = playerIdx === 0;
  const kbForward = isP1
    ? (keys.has('KeyW') || (state.mode !== '2p' && keys.has('ArrowUp')))
    : keys.has('ArrowUp');
  const kbBrake = isP1
    ? (keys.has('KeyS') || (state.mode !== '2p' && keys.has('ArrowDown')) || touchHeld.has('brake'))
    : keys.has('ArrowDown');
  const kbLeft = isP1
    ? (keys.has('KeyA') || (state.mode !== '2p' && keys.has('ArrowLeft')))
    : keys.has('ArrowLeft');
  const kbRight = isP1
    ? (keys.has('KeyD') || (state.mode !== '2p' && keys.has('ArrowRight')))
    : keys.has('ArrowRight');
  const kbTurbo = isP1
    ? (keys.has('Space') || touchHeld.has('turbo'))
    : (keys.has('ShiftRight') || keys.has('Numpad0'));
  const kbAttack = isP1
    ? (keys.has('KeyF') || keys.has('KeyE') || touchHeld.has('attack'))
    : (keys.has('Enter') || keys.has('KeyK'));

  const kbDir = (kbRight ? 1 : 0) - (kbLeft ? 1 : 0);
  kbWheelDeg[playerIdx] = stepKeyWheel(kbWheelDeg[playerIdx] || 0, kbDir, frameDt);
  const kbSteer = kbWheelDeg[playerIdx] / WHEEL_LIMIT_DEG;
  const padSteer = isP1 && state.mode !== '2p' ? touchSteerValue / WHEEL_LIMIT_DEG : 0;
  const useMotion = motionInput && motionInput.visible;

  const steer = Math.abs(kbSteer) > 0.001 ? kbSteer : (Math.abs(padSteer) > 0.001 || wheelTouch.active ? padSteer : (useMotion ? motionInput.steer : 0));
  const brake = kbBrake || Boolean(useMotion && motionInput.brake);
  const reverse = kbBrake || Boolean(useMotion && motionInput.reverse);
  const throttle = brake ? 0 : ((kbForward || state.autoGas || (useMotion && motionInput.throttle > 0)) ? 1 : 0);
  const turbo = kbTurbo || Boolean(useMotion && motionInput.turbo);
  const attack = kbAttack || Boolean(useMotion && motionInput.attack);
  const hop = Boolean(useMotion && motionInput.hop);

  let poseLabel = useMotion ? motionInput.poseLabel : (state.autoGas ? 'AUTO-GAS' : 'READY');
  if (kbAttack) poseLabel = 'PUNCH! 💥';
  else if (kbTurbo) poseLabel = 'TURBO! 🚀';
  else if (kbBrake) poseLabel = 'BRAKE 🛑';
  else if (kbLeft || padSteer < -0.3) poseLabel = 'LEFT ⬅️';
  else if (kbRight || padSteer > 0.3) poseLabel = 'RIGHT ➡️';

  return { throttle, brake, reverse, steer, turbo, attack, hop, poseLabel };
}

const bannerEl = document.getElementById('event-banner');
let bannerTimer = null;
function showBanner(text, kind = '', ms = 1400) {
  if (!bannerEl) return;
  bannerEl.textContent = text;
  bannerEl.className = `event-banner ${kind}`;
  void bannerEl.offsetWidth; // restart the pop animation
  bannerEl.classList.add('pop');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => bannerEl.classList.add('hidden'), ms);
}

function myKartIds() {
  if (state.mode === 'lan') return state.lanPlayerId ? [state.lanPlayerId] : [];
  return state.mode === '2p' ? ['p1', 'p2'] : ['p1'];
}

function handleSimulationEvents(events, totalLaps = 3) {
  const mine = new Set(myKartIds());
  const solo = mine.size === 1; // in split-screen, banners would be ambiguous
  for (const ev of events) {
    const isMine = mine.has(ev.kartId);
    if (ev.type === 'countdown') {
      sfx.countdown(ev.count);
      if (ev.count === 0) showBanner('GO!', 'lap', 700);
    } else if (ev.type === 'closing') showBanner(`Race ends in ${ev.secs} s`, 'bad', 1800);
    else if (ev.type === 'reset' && isMine && solo) showBanner('Back on the road', 'good', 1100);
    else if (ev.type === 'crate_smash') {
      if (isMine || !solo) sfx.crateSmash();
      if (isMine && solo && ev.item) showBanner(`${ITEM_LABELS[ev.item]} — ${useHint('p1')} to use`, 'item', 1500);
      renderer.spawnBurst(ev.x, 1, ev.z, '#ffb84d', 0.9);
    } else if (ev.type === 'fruit_pickup') { if (isMine) sfx.fruitPickup(); }
    else if (ev.type === 'turbo' || ev.type === 'pad_boost') { if (isMine) sfx.turbo(); }
    else if (ev.type === 'hop' || ev.type === 'ramp_jump') { if (isMine) sfx.hop(); }
    else if (ev.type === 'attack') sfx.attack();
    else if (ev.type === 'explosion') {
      sfx.explosion();
      renderer.spawnBurst(ev.x, 1, ev.z, '#ff5d73', 1.6);
      if (isMine && solo) showBanner('HIT! Spin-out', 'bad', 1100);
    } else if (ev.type === 'shield_block') {
      sfx.shieldBlock();
      renderer.spawnBurst(ev.x, 1.2, ev.z, '#5ef0ff', 1.2);
      if (isMine && solo) showBanner('Shield blocked it!', 'good', 1100);
    } else if (ev.type === 'wall') {
      if (isMine) sfx.thud();
    } else if (ev.type === 'lap') {
      if (isMine) {
        sfx.lap();
        if (solo && ev.lap <= totalLaps) showBanner(ev.lap === totalLaps ? 'FINAL LAP!' : `LAP ${ev.lap}/${totalLaps}`, 'lap', 1500);
      }
    } else if (ev.type === 'finish') {
      if (isMine) {
        sfx.victory();
        if (solo) showBanner('FINISH!', 'lap', 3000);
      }
    }
  }
}

// LAN snapshots arrive at ~30 Hz; render at display rate by blending the last two.
function interpolateLanSnapshot(nowMs) {
  const cur = state.lanCurr;
  const prev = state.lanPrev;
  if (!prev || prev.snap.trackId !== cur.snap.trackId) return cur.snap;
  const span = Math.max(16, cur.t - prev.t);
  const a = Math.min(1, Math.max(0, (nowMs - cur.t) / span));
  const byId = new Map(prev.snap.karts.map((k) => [k.id, k]));
  const lerpAngle = (x, y) => {
    let d = y - x;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return x + d * a;
  };
  const karts = cur.snap.karts.map((k) => {
    const p = byId.get(k.id);
    if (!p) return k;
    return {
      ...k,
      x: p.x + (k.x - p.x) * a,
      y: p.y + (k.y - p.y) * a,
      z: p.z + (k.z - p.z) * a,
      speed: p.speed + (k.speed - p.speed) * a,
      heading: lerpAngle(p.heading, k.heading),
    };
  });
  return { ...cur.snap, karts };
}

// What to press to fire the held item, for the input device actually in use.
function useHint(prefix) {
  if (prefix === 'p2') return 'Enter / punch';
  if (document.body.classList.contains('touch')) return 'tap PUNCH';
  return state.webcamEnabled ? 'punch / F' : 'press F';
}

function updateHudCard(prefix, kart, totalLaps, poseLabel) {
  if (!kart) return;
  document.getElementById(`${prefix}-rank`).textContent = ordinal(kart.rank);
  document.getElementById(`${prefix}-lap`).textContent = `LAP ${kart.lap}/${totalLaps}`;
  document.getElementById(`${prefix}-mango`).textContent = `🟠 ${kart.mango}/10`;
  document.getElementById(`${prefix}-item`).textContent = kart.heldItem ? `${ITEM_LABELS[kart.heldItem]} (${useHint(prefix)})` : '📦 No Item';
  document.getElementById(`${prefix}-speed`).textContent = Math.max(0, Math.round(kart.speed * 3.2));
  document.getElementById(`${prefix}-turbo-pct`).textContent = `${kart.turboCharge}%`;
  document.getElementById(`${prefix}-turbo-fill`).style.width = `${kart.turboCharge}%`;
  document.getElementById(`${prefix}-pose-pill`).textContent = poseLabel || 'DRIVE';
  setHudWheel(prefix, kart.steerAngle || 0);
}

function showFinishModal(snapshot) {
  setScreen('finished');
  const listEl = document.getElementById('finish-standings');
  listEl.innerHTML = '';
  const mine = new Set(myKartIds());
  const sorted = [...snapshot.karts].sort((a, b) => a.rank - b.rank);
  for (const k of sorted) {
    const row = document.createElement('div');
    row.className = `standing-row${mine.has(k.id) ? ' me' : ''}`;
    const t = k.finishTimeSec ? `${k.finishTimeSec.toFixed(1)}s` : 'did not finish';
    row.innerHTML = `<strong>${ordinal(k.rank)} — ${k.name}${mine.has(k.id) ? ' (you)' : ''}</strong><span>${t}</span>`;
    listEl.appendChild(row);
  }
  const me = snapshot.karts.find((k) => mine.has(k.id)) || snapshot.karts[0];
  const title = document.getElementById('finish-title');
  if (title && me) title.textContent = me.rank === 1 ? '🏆 You Win!' : me.rank <= 3 ? `🏅 ${ordinal(me.rank)} Place!` : `🏁 ${ordinal(me.rank)} Place`;
  const st = me?.statsSummary || { cratesSmashed: 0, turbosUsed: 0, attacksFired: 0, hitsLanded: 0 };
  document.getElementById('finish-activity').textContent =
    `Crates: ${st.cratesSmashed} · Turbos: ${st.turbosUsed} · Items fired: ${st.attacksFired} · Direct hits: ${st.hitsLanded}`;
}

document.getElementById('btn-race-again').addEventListener('click', () => {
  if (state.mode === 'lan') {
    setScreen('lan_lobby');
  } else {
    // Race Again: back to the circuit step with the same racer(s)
    state.sim = null;
    setScreen('menu');
    if (wiz.path === 'solo' || wiz.path === '2p') wizGo('circuit');
    else wizReset();
  }
});

document.getElementById('btn-finish-menu').addEventListener('click', leaveToMenu);

const isDebug = new URLSearchParams(window.location.search).has('debug');
const debugPanelEl = document.getElementById('debug-panel');
if (isDebug) debugPanelEl.classList.remove('hidden');

let lastFrameMs = performance.now();
let fpsFrames = 0;
let lastFpsCheckMs = performance.now();
const adaptiveRes = new AdaptiveScale();
let lastRacingMs = 0;

function animate(nowMs) {
  requestAnimationFrame(animate);

  const rawDt = (nowMs - lastFrameMs) * 0.001;
  if (state.screen !== 'racing' && rawDt < (1 / 31)) {
    return;
  }
  lastFrameMs = nowMs;
  const dt = Math.min(0.05, Math.max(0.001, rawDt));
  frameDt = dt;

  // Displayed FPS: frames per second over the last half second (true rate, no 1/dt averaging).
  fpsFrames += 1;
  if (nowMs - lastFpsCheckMs > 500) {
    state.fps = Math.round(fpsFrames * 1000 / (nowMs - lastFpsCheckMs));
    fpsFrames = 0;
    lastFpsCheckMs = nowMs;
  }
  // Dynamic resolution: only while actually racing; restart the window after menu/pause time.
  if (state.screen === 'racing' && !state.paused) {
    if (nowMs - lastRacingMs > 250) adaptiveRes.reset();
    lastRacingMs = nowMs;
    const next = adaptiveRes.update(rawDt * 1000, nowMs);
    if (next !== null) renderer.setAdaptiveScale(next);
  }

  const activePoses = state.syntheticPoses || state.latestPoses;
  const playerCount = state.mode === '2p' ? 2 : 1;
  const motionInputs = (state.webcamEnabled || state.syntheticPoses)
    ? motionCtrl.update(activePoses, nowMs, playerCount)
    : [];

  syncCameraUi();
  drawPipOverlay(motionInputs);

  touchSteerValue = state.screen === 'racing' && !state.paused ? updateTouchSteer(dt) : 0;
  if (state.screen !== 'racing') { kbWheelDeg[0] = 0; kbWheelDeg[1] = 0; }
  if (state.screen === 'racing') {
    const p1In = buildCombinedInput(0, motionInputs[0]);
    const p2In = buildCombinedInput(1, motionInputs[1]);

    if (state.mode === 'lan') {
      lanClient.sendInput(p1In);
      if (state.lanCurr) {
        const snap = interpolateLanSnapshot(nowMs);
        const myId = state.lanPlayerId || snap.karts[0]?.id;
        const myKart = snap.karts.find((k) => k.id === myId) || snap.karts[0];
        const countdownEl = document.getElementById('countdown-banner');
        if (snap.status === 'countdown') {
          countdownEl.classList.remove('hidden');
          countdownEl.textContent = Math.max(1, Math.ceil(snap.countdown));
        } else {
          countdownEl.classList.add('hidden');
        }
        renderer.render(snap, { mode: 'lan', focusKartIds: [myKart.id], dt, isMenuShowcase: false });
        updateHudCard('p1', myKart, snap.totalLaps, p1In.poseLabel);
        sfx.engineTick(myKart.speed / 38);
        drawMinimap(snap);
      }
    } else if (state.sim) {
      const snap = state.paused ? (state.lastSnapshot || state.sim.getSnapshot()) : state.sim.step(dt, { p1: p1In, p2: p2In });
      state.lastSnapshot = snap;
      if (!state.paused) handleSimulationEvents(snap.events, snap.totalLaps);

      const countdownEl = document.getElementById('countdown-banner');
      if (snap.status === 'countdown') {
        countdownEl.classList.remove('hidden');
        countdownEl.textContent = Math.ceil(snap.countdown);
      } else {
        countdownEl.classList.add('hidden');
      }

      const focusIds = state.mode === '2p' ? ['p1', 'p2'] : ['p1'];
      renderer.render(snap, { mode: state.mode, focusKartIds: focusIds, dt, isMenuShowcase: false });

      const k1 = snap.karts.find((k) => k.id === 'p1');
      updateHudCard('p1', k1, snap.totalLaps, p1In.poseLabel);
      if (k1 && !state.paused) sfx.engineTick(k1.speed / 38);

      if (state.mode === '2p') {
        const k2 = snap.karts.find((k) => k.id === 'p2');
        updateHudCard('p2', k2, snap.totalLaps, p2In.poseLabel);
      } else {
        drawMinimap(snap);
      }

      if (snap.status === 'finished' && !state.paused) {
        showFinishModal(snap);
      }
    }
  } else {
    const snap = menuPreviewSim.step(dt * 0.65, {});
    renderer.render(snap, { mode: '1p', focusKartIds: ['showcase'], dt, isMenuShowcase: true });
  }

  if (isDebug) {
    debugPanelEl.textContent =
      `FPS: ${state.fps} | Pose: ${state.poseMs.toFixed(1)}ms | Pixels: ${(renderer.pixelCount / 1e6).toFixed(2)}M | Mode: ${state.mode.toUpperCase()} (${state.screen})`;
  }
}

requestAnimationFrame(animate);

// Debug-only handle on the renderer (scene, info) for perf probes: only with ?debug in the URL.
if (isDebug) window.__r = renderer;

window.__game = {
  // Debug only (?debug): park the local race kart at lap fraction s / lateral offset and freeze the sim, for screenshots.
  placeKart: (sFrac, lateral = 0, behindMeters = 0) => {
    if (!isDebug || !state.sim) return false;
    const k = state.sim.karts.find((q) => q.id === 'p1');
    const tr = state.sim.track;
    const pt = tr.getPointAt(sFrac - behindMeters / tr.totalLength);
    k.x = pt.x + pt.rx * lateral; k.z = pt.z + pt.rz * lateral; k.heading = Math.atan2(pt.tx, pt.tz); k.speed = 0; k.y = 0;
    state.sim.status = 'racing'; state.sim.countdown = 0;
    state.paused = true;
    state.lastSnapshot = state.sim.getSnapshot();
    renderer.camStates[0].initialized = false;
    return true;
  },
  getMetrics: () => ({
    fps: state.fps,
    poseMs: state.poseMs,
    pixelCount: renderer.pixelCount,
    maxPixelBudget: 2_200_000,
    adaptiveScale: renderer.adaptiveScale,
    ...renderer.getInfo(),
  }),
  getState: () => ({
    screen: state.screen,
    mode: state.mode,
    selectedTrackId: state.selectedTrackId,
    selectedDriverId: state.selectedDriverId,
    p2DriverId: state.p2DriverId,
    difficulty: state.difficulty,
    laps: state.laps,
    wizard: { step: wiz.step, pick: wiz.pick },
    lanPlayerId: state.lanPlayerId,
    wheel: { touchDeg: wheelTouch.deg, kb: [...kbWheelDeg], hudRot: [0, 1].map((i) => (document.getElementById(`p${i + 1}-wheel`) || {}).style?.transform || '') },
    autoGas: state.autoGas,
    snapshot: state.lastSnapshot,
    paused: state.paused,
    meshDrivers: Object.fromEntries([...renderer.kartMeshes].filter(([, m]) => m.root.visible).map(([id, m]) => [id, m.driverId])),
  }),
  startMode: (mode = '1p', trackId = 'island', driverId = 'rufus') => {
    state.selectedTrackId = trackId;
    state.selectedDriverId = driverId;
    ensureP2();
    startLocalRace(mode);
    if (state.sim) {
      state.sim.countdown = 0;
      state.sim.status = 'racing';
    }
    return window.__game.getState();
  },
  injectPose: (poseOptsOrArray, playerCount = 1) => {
    const arr = Array.isArray(poseOptsOrArray)
      ? poseOptsOrArray.map((p) => (p.landmarks ? p : makeSyntheticPose(p)))
      : [poseOptsOrArray.landmarks ? poseOptsOrArray : makeSyntheticPose(poseOptsOrArray)];
    state.syntheticPoses = arr;
    if (!motionCtrl.slots[0].calibrated || (playerCount === 2 && !motionCtrl.slots[1].calibrated)) {
      motionCtrl.calibrate(arr, playerCount);
    }
    return motionCtrl.update(arr, performance.now(), playerCount);
  },
  clearSyntheticPose: () => {
    state.syntheticPoses = null;
  },
  setAutoGas: (v) => {
    state.autoGas = Boolean(v);
    motionCtrl.setAutoGas(state.autoGas);
  },
};
