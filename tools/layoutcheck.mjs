// Headless layout check of the in-race controls and HUD at phone/tablet viewports (needs Playwright; see tests/layout.test.mjs).
export const VIEWPORTS = [[360, 640], [390, 844], [412, 915], [844, 390], [915, 412], [1024, 768], [1180, 820]];
const SEL = {
  'wheel': '#steer-pad', 'btn-brake': '[data-touch="brake"]', 'btn-turbo': '[data-touch="turbo"]', 'btn-punch': '[data-touch="attack"]',
  'minimap': '#minimap-card', 'rank': '#p1-rank', 'lap': '#p1-lap', 'speed': '#p1-speed', 'item': '#p1-item', 'turbo-bar': '#hud-p1 .energy-bar',
  'bar-gas': '#btn-auto-gas', 'bar-comfort': '#btn-comfort', 'bar-sound': '#btn-sound', 'bar-menu': '#btn-menu-return',
};
export async function checkLayout(page, w, h, { touch = true } = {}) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(250);
  return page.evaluate(({ SEL, w, h }) => {
    const out = { problems: [], boxes: {} };
    const els = {};
    for (const [k, sel] of Object.entries(SEL)) {
      const e = document.querySelector(sel);
      if (!e) continue;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = e.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      els[k] = r; out.boxes[k] = [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)];
      if (r.left < -0.5 || r.top < -0.5 || r.right > w + 0.5 || r.bottom > h + 0.5) out.problems.push(`${k} outside viewport ${JSON.stringify(out.boxes[k])}`);
    }
    const ks = Object.keys(els);
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
      const a = els[ks[i]]; const b = els[ks[j]];
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left); const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 1 && oy > 1) out.problems.push(`${ks[i]} overlaps ${ks[j]} (${Math.round(ox)}x${Math.round(oy)})`);
    }
    if (document.documentElement.scrollWidth > w + 1 || document.body.scrollWidth > w + 1) out.problems.push(`horizontal scroll ${document.documentElement.scrollWidth} > ${w}`);
    if (document.documentElement.scrollHeight > h + 1) out.problems.push(`vertical scroll ${document.documentElement.scrollHeight} > ${h}`);
    return out;
  }, { SEL, w, h });
}
