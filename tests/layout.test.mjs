import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VIEWPORTS, checkLayout } from '../tools/layoutcheck.mjs';

// Headless layout test: the in-race HUD and touch controls must be fully inside the viewport, must not overlap each
// other and the page must not scroll, on phones and tablets in portrait and landscape. Needs Playwright (borrowed from
// a sibling project) and Chrome; skipped, loudly, when they are not installed.
const PW = process.env.PLAYWRIGHT_PATH || '/Users/user/Documents/Development/projects/yolo-dev/ujian-tempur/node_modules/playwright/index.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const havePw = fs.existsSync(PW);

test('Touch controls and HUD fit without overlap at 360x640, 390x844, 412x915, 844x390, 915x412, 1024x768, 1180x820', { skip: havePw ? false : 'Playwright not installed', timeout: 120000 }, async () => {
  const { chromium } = await import(PW);
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.json': 'application/json' };
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const f = path.join(root, p === '/' ? 'index.html' : p);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/?debug`);
    await page.waitForFunction(() => window.__game && window.__game.getState);
    await page.evaluate(() => { window.__game.startMode('1p', 'island', 'rufus'); document.getElementById('debug-panel').classList.add('hidden'); });
    await page.waitForTimeout(600);
    await page.evaluate(() => { document.getElementById('p1-item').textContent = '\u{1F680} ROCKET (tap PUNCH)'; document.getElementById('event-banner').classList.add('hidden'); });
    const bad = [];
    for (const [w, h] of VIEWPORTS) {
      const r = await checkLayout(page, w, h);
      if (r.problems.length) bad.push(`${w}x${h}: ${r.problems.join('; ')}`);
      for (const k of ['wheel', 'btn-brake', 'btn-turbo', 'btn-punch']) assert.ok(r.boxes[k], `${w}x${h}: ${k} must be visible`);
    }
    assert.deepEqual(bad, []);
  } finally { await browser.close(); server.close(); }
});
