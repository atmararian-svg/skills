// End-to-end check of the particle morph system in a real (headless) browser.
//
//   npm run dev                 # in one terminal
//   npm run test:e2e            # in another (optional: URL as first argument)
//
// Steps the simulation deterministically (fixed dt) and reads the GPU position
// texture back to verify behaviour numerically. Screenshots of every model and
// of every transition at 25 / 50 / 75 % go to tests/output/.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL_ = process.argv[2] || 'http://localhost:5173/?nogui';
const OUT = new URL('./output/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const SETTLE_ERR = 0.01; // mean distance (world units) to the target once settled; grain jitter is ~0.0025
let failures = 0;
const check = (ok, label, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
};

const browser = await chromium.launch({
  // software GL so the test also runs on machines / CI without a GPU
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(URL_);
await page.waitForFunction(() => window.__pms?.ready, null, { timeout: 180000 });

await page.evaluate(() => {
  const s = window.__pms;
  s.stop(); // drive the simulation manually with a fixed time step
  window.__step = (n) => { for (let i = 0; i < n; i++) s.update(1 / 60); s.render(); };
  window.__read = () => {
    const sim = s.simulation, rt = sim.gpu.getCurrentRenderTarget(sim.posVar);
    const buf = new Float32Array(rt.width * rt.height * 4);
    s.renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, buf);
    return buf;
  };
  window.__errTo = (k) => {
    const buf = window.__read(), n = s.morph.count, t = s.morph.targetData[k];
    let e = 0, nan = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(buf[i * 4] - t[i * 4], buf[i * 4 + 1] - t[i * 4 + 1], buf[i * 4 + 2] - t[i * 4 + 2]);
      if (!Number.isFinite(d)) nan++; else e += d / n;
    }
    return { err: +e.toFixed(4), nan };
  };
  window.__ramp = (from, to, steps) => {
    let prev = window.__read(); const n = s.morph.count; let maxB = 0, maxO = 0, nan = 0;
    for (let j = 1; j <= steps; j++) {
      s.setMorphProgress(from + ((to - from) * j) / steps); s.update(1 / 60);
      const cur = window.__read(); let m = 0;
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(cur[i * 4] - prev[i * 4], cur[i * 4 + 1] - prev[i * 4 + 1], cur[i * 4 + 2] - prev[i * 4 + 2]);
        if (!Number.isFinite(d)) nan++; else if (d > m) m = d;
      }
      const P = s.sequencePosition, r = Math.round(P);
      if (Math.abs(P - r) < 0.02 && r > 0 && r < s.modelCount - 1) maxB = Math.max(maxB, m); else maxO = Math.max(maxO, m);
      prev = cur;
    }
    return { boundary: +maxB.toFixed(4), elsewhere: +maxO.toFixed(4), nan };
  };
  window.__findHover = () => {
    const c = s.cursor, r = s.renderer.domElement.getBoundingClientRect();
    for (let gy = 0.15; gy < 0.9; gy += 0.03) for (let gx = 0.15; gx < 0.85; gx += 0.02) {
      c.ndc.set(gx * 2 - 1, -(gy * 2 - 1)); c.raycaster.setFromCamera(c.ndc, s.camera);
      for (const [i, m] of c.proxies.entries()) {
        if (1 - Math.abs(s.sequencePosition - i) < 0.2) continue;
        if (c.raycaster.intersectObject(m, false).length) return { x: r.left + gx * r.width, y: r.top + gy * r.height };
      }
    }
    return null;
  };
});
const ev = (f, a) => page.evaluate(f, a);
const step = (n) => ev((n) => window.__step(n), n);

const info = await ev(() => ({ n: window.__pms.modelCount, names: window.__pms.config.models.map((m) => m.name), stats: window.__pms.stats }));
console.log('models:', info.names.join(' → '), '| stats:', JSON.stringify(info.stats));
const N = info.n;
const last = N - 1;

// 1) every model forms and is captured
for (let k = 0; k < N; k++) {
  await ev((p) => window.__pms.setMorphProgress(p, { immediate: true }), k / last);
  await step(360);
  await page.screenshot({ path: `${OUT}model-${k}.png` });
  const r = await ev((k) => window.__errTo(k), k);
  check(r.err < SETTLE_ERR && r.nan === 0, `model ${k} (${info.names[k]}) forms`, r);
}

// 2) every transition, forward and reverse: continuous, no NaN, no jump at segment boundaries
for (const [from, to, label] of [[0, 1, 'forward'], [1, 0, 'reverse']]) {
  await ev((p) => window.__pms.setMorphProgress(p, { immediate: true }), from);
  await step(300);
  const r = await ev(([a, b]) => window.__ramp(a, b, 480), [from, to]);
  check(r.nan === 0 && r.boundary <= r.elsewhere * 1.5 + 1e-3, `full sequence ${label}: no jumps at model boundaries`, r);
  await step(300);
  const e = await ev((k) => window.__errTo(k), to * last);
  check(e.err < SETTLE_ERR, `full sequence ${label}: settles on model ${to * last}`, e);
}

// 3) transition snapshots (25 / 50 / 75 %)
for (let s = 0; s < last; s++) {
  await ev((p) => window.__pms.setMorphProgress(p, { immediate: true }), s / last);
  await step(200);
  for (const l of [0.25, 0.5, 0.75]) {
    const hold = await ev(() => window.__pms.config.morphHold);
    await ev((p) => window.__pms.setMorphProgress(p), (s + hold + l * (1 - 2 * hold)) / last);
    await step(70);
    await page.screenshot({ path: `${OUT}transition-${s}-${s + 1}-${l * 100}.png` });
  }
}

// 4) hover + look-at on every model and mid-transition; reconstruction to the active shape
for (let j = 0; j <= last * 2; j++) {
  const p = j / (last * 2);
  const exact = j % 2 === 0;
  await ev((p) => window.__pms.setMorphProgress(p, { immediate: true }), p);
  await step(exact ? 300 : 40);
  const h = await ev(() => window.__findHover());
  check(!!h, `p=${p.toFixed(3)}: cursor can reach the formation`);
  if (!h) continue;
  await page.mouse.move(h.x, h.y);
  await step(6);
  const strength = await ev(() => +window.__pms.cursor.strength.toFixed(2));
  await step(24); // the look-at spring has inertia: give it half a second
  const st = { strength, rotation: await ev(() => { const r = window.__pms.formation.rotation; return +(Math.abs(r.x) + Math.abs(r.y)).toFixed(3); }) };
  check(st.strength > 0.5 && st.rotation > 0.01, `p=${p.toFixed(3)}: hover dispersion + look-at active`, st);
  for (let i = 0; i < 10; i++) { await page.mouse.move(h.x + i * 5, h.y + (i % 3) * 4); await step(1); }
  await page.mouse.move(2, 2);
  await step(420);
  if (exact) {
    const e = await ev((k) => window.__errTo(k), j / 2);
    check(e.err < SETTLE_ERR, `p=${p.toFixed(3)}: reconstructs model ${j / 2} after the cursor leaves`, e);
  }
}

// 5) hover during a running transition, then leave → the NEW active shape forms
for (let s = 0; s < last; s++) {
  await ev((p) => window.__pms.setMorphProgress(p, { immediate: true }), s / last);
  await step(300);
  const h = await ev(() => window.__findHover());
  await page.mouse.move(h.x, h.y);
  await ev((p) => window.__pms.setMorphProgress(p), (s + 1) / last);
  for (let i = 0; i < 50; i++) { await page.mouse.move(h.x + (i % 20) * 8, h.y + (i % 7) * 4); await step(1); }
  await page.mouse.move(2, 2);
  await step(420);
  const e = await ev((k) => window.__errTo(k), s + 1);
  check(e.err < SETTLE_ERR, `hover during ${info.names[s]} → ${info.names[s + 1]}: reconstructs ${info.names[s + 1]}`, e);
}

// 6) fast scrolling with direction changes
for (const p of [1, 0, 0.8, 0.1, 0.55, 0.95, 0.3, 0.75]) { await ev((p) => window.__pms.setMorphProgress(p), p); await step(6); }
await step(500);
const fast = await ev((k) => window.__errTo(k), 0.75 * last);
check(fast.err < SETTLE_ERR && fast.nan === 0, 'rapid direction changes: simulation stays stable and settles', fast);

check(errors.length === 0, 'no console / page errors', errors.slice(0, 3));
await browser.close();
console.log(`\n${failures ? failures + ' check(s) failed' : 'all checks passed'} — screenshots in ${OUT}`);
process.exit(failures ? 1 : 0);
