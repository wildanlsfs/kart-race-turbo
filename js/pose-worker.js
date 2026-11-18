// Classic Web Worker for MediaPipe Pose Landmarker
// Defines CommonJS `self.module` & `self.exports` before `importScripts` (matching jagoan-kotak/js/pose-worker.js)
// Loads local bundle/wasm/model from /js/vendor/mediapipe/ first (instant & offline-ready), with CDN fallback.
/* global self, importScripts */

self.module = { exports: {} };
self.exports = self.module.exports;

const LOCAL_BASE = new URL('./vendor/mediapipe', self.location.href).href;
const CDN_BASE = 'https://unpkg.com/@mediapipe/tasks-vision@0.10.14';
const MODEL_CDN = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

try {
  importScripts(`${LOCAL_BASE}/vision_bundle.cjs`);
} catch (_) {
  try {
    importScripts(`${CDN_BASE}/vision_bundle.cjs`);
  } catch (__) {
    const x = new XMLHttpRequest();
    x.open('GET', 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.cjs', false);
    x.send();
    (0, eval)(x.responseText);
  }
}

const { FilesetResolver, PoseLandmarker } = self.module.exports;
let landmarker = null;
let lastTs = 0;

const plain = (people) => (people || []).map((pts) => pts.map((q) => ({
  x: q.x,
  y: q.y,
  z: q.z,
  visibility: q.visibility,
})));

async function createLandmarker(numPoses = 2) {
  let vision;
  try {
    vision = await FilesetResolver.forVisionTasks(`${LOCAL_BASE}/wasm`);
  } catch (_) {
    vision = await FilesetResolver.forVisionTasks(`${CDN_BASE}/wasm`);
  }

  const tryCreate = async (modelPath, delegate) => PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: modelPath, delegate },
    runningMode: 'VIDEO',
    numPoses,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  for (const modelPath of [`${LOCAL_BASE}/pose_landmarker_lite.task`, MODEL_CDN]) {
    for (const delegate of ['GPU', 'CPU']) {
      try {
        return await tryCreate(modelPath, delegate);
      } catch (_) {}
    }
  }
  throw new Error('Could not initialize PoseLandmarker');
}

self.onmessage = async (e) => {
  const d = e.data;
  if (d.type === 'init') {
    try {
      landmarker = await createLandmarker(d.numPoses || 2);
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', message: String((err && err.message) || err) });
    }
    return;
  }

  if (d.type === 'config') {
    // Solo / LAN only needs one person; 2P needs two. Detecting for fewer people is cheaper per frame.
    if (landmarker && d.numPoses) {
      try { landmarker.setOptions({ numPoses: d.numPoses }); } catch (_) {}
    }
    return;
  }

  if (d.type === 'frame') {
    const bmp = d.bitmap;
    if (!landmarker) {
      if (bmp && bmp.close) bmp.close();
      return;
    }
    const t0 = performance.now();
    const ts = Math.max(lastTs + 1, Math.round(d.ts || t0));
    lastTs = ts;
    let res = null;
    try {
      res = landmarker.detectForVideo(bmp, ts);
    } catch (_) {}
    if (bmp && bmp.close) bmp.close();
    const dt = performance.now() - t0;
    self.postMessage({
      type: 'poses',
      landmarks: res ? plain(res.landmarks) : [],
      worldLandmarks: res ? plain(res.worldLandmarks) : [],
      poseMs: dt,
      frameTs: d.ts, // echoed so the page can measure camera-to-result latency on its own clock
    });
  }
};
