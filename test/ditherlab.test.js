// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
['core', 'ascii', 'dither', 'halftone'].forEach((m) => require(path.join('..', 'js', m + '.js')));
const AD = globalThis.AD;

const approx = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${a} ~ ${b} (±${tol})`);
const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;

// A horizontal gradient 0..255, used by several tests.
function gradient(w, h) {
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = (x / (w - 1)) * 255;
  return g;
}

test('core: luma weights and RGBA conversion', () => {
  approx(AD.luma(255, 255, 255), 255, 0.01);
  approx(AD.luma(255, 0, 0), 76.245, 0.01);
  const f = AD.rgbaToFloat(new Uint8ClampedArray([10, 20, 30, 255, 0, 0, 0, 0]), 2, 1);
  assert.deepEqual(Array.from(f), [10, 20, 30, 255, 255, 255]); // transparent -> white
});

test('core: adjust brightness, contrast, gamma, invert', () => {
  const up = AD.adjust(new Float32Array([100, 100, 100]), { brightness: 20 });
  approx(up[0], 151, 0.01);
  const inv = AD.adjust(new Float32Array([0, 100, 255]), { invert: true });
  assert.deepEqual(Array.from(inv), [255, 155, 0]);
  const flat = AD.adjust(new Float32Array([128, 128, 128]), { contrast: 80 });
  approx(flat[0], 128, 0.01, 'mid grey unchanged by contrast');
  const g = AD.adjust(new Float32Array([64, 64, 64]), { gamma: 2 });
  assert.ok(g[0] > 64, 'gamma > 1 brightens midtones');
});

test('core: autoLevels stretches a narrow range', () => {
  const f = new Float32Array(300);
  for (let i = 0; i < 100; i++) { f[i * 3] = f[i * 3 + 1] = f[i * 3 + 2] = 100 + i * 0.5; }
  AD.autoLevels(f);
  const g = AD.toGray(f, 100, 1);
  assert.ok(Math.min(...g) < 10 && Math.max(...g) > 245);
});

test('core: summed-area table matches brute force', () => {
  const w = 17, h = 11, plane = new Float32Array(w * h).map((_, i) => (i * 37) % 101);
  const sat = AD.makeSAT(plane, w, h);
  for (const [x0, y0, x1, y1] of [[0, 0, 17, 11], [3, 2, 9, 7], [-5, -5, 4, 4], [10, 8, 40, 40]]) {
    let sum = 0, n = 0;
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) { sum += plane[y * w + x]; n++; }
    approx(AD.boxMean(sat, w, h, x0, y0, x1, y1), n ? sum / n : 0, 1e-9);
  }
});

test('core: hex helpers', () => {
  assert.deepEqual(AD.hexToRgb('#ff8000'), [255, 128, 0]);
  assert.deepEqual(AD.hexToRgb('#fff'), [255, 255, 255]);
  assert.deepEqual(AD.hexToRgb('nope'), [0, 0, 0]);
  assert.equal(AD.rgbToHex(255, 128, 0), '#ff8000');
});

test('ascii: grid size compensates for tall characters', () => {
  assert.deepEqual(AD.gridSize(100, 800, 800, 0.5), { cols: 100, rows: 50 });
  assert.equal(AD.gridSize(100, 800, 400, 0.5).rows, 25);
  assert.equal(AD.gridSize(5, 1000, 10, 0.5).rows, 1, 'never zero rows');
});

test('ascii: ramps map dark/light correctly and can be flipped', () => {
  const chars = AD.rampChars('standard');
  const gray = new Float32Array([0, 255]);
  assert.equal(AD.mapToChars(gray, 2, 1, chars, false).text, '@ ');
  assert.equal(AD.mapToChars(gray, 2, 1, chars, true).text, ' @');
  assert.deepEqual(AD.rampChars('custom', 'x'), Array.from(AD.RAMPS.standard), 'too-short custom ramp falls back');
  assert.deepEqual(AD.rampChars('custom', 'ab'), ['a', 'b']);
});

test('dither: Bayer matrices are permutations', () => {
  for (const size of [2, 4, 8]) {
    const flat = AD.bayer(size).flat().sort((a, b) => a - b);
    assert.deepEqual(flat, Array.from({ length: size * size }, (_, i) => i));
  }
  assert.deepEqual(AD.bayer(2), [[0, 2], [3, 1]]);
});

test('dither: every algorithm outputs valid level indices and preserves average brightness', () => {
  const w = 64, h = 64, plane = gradient(w, h);
  const target = mean(plane);
  for (const { id } of AD.ALGORITHMS) {
    if (id === 'threshold') continue; // plain rounding is allowed to drift
    const idx = AD.quantize(plane, w, h, 2, id, true);
    assert.ok(idx.every((v) => v === 0 || v === 1), id + ' only 0/1');
    approx(mean(Array.from(idx)) * 255, target, 6, id + ' mean brightness');
  }
});

test('dither: 4 levels use all four indices on a gradient', () => {
  const idx = AD.quantize(gradient(128, 8), 128, 8, 4, 'floyd', false);
  assert.deepEqual([...new Set(idx)].sort(), [0, 1, 2, 3]);
});

test('dither: threshold is plain rounding', () => {
  const idx = AD.quantize(new Float32Array([0, 100, 127, 129, 255]), 5, 1, 2, 'threshold', false);
  assert.deepEqual(Array.from(idx), [0, 0, 0, 1, 1]);
});

test('dither: noise is deterministic', () => {
  const p = gradient(32, 32);
  assert.deepEqual(AD.quantize(p, 32, 32, 2, 'noise'), AD.quantize(p, 32, 32, 2, 'noise'));
});

test('dither: tone mode only emits palette colours', () => {
  const colors = ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'];
  const out = AD.ditherTone(gradient(40, 10), 40, 10, colors, 'floyd', true);
  const allowed = new Set(colors.map((c) => AD.hexToRgb(c).join(',')));
  for (let i = 0; i < 400; i++) assert.ok(allowed.has([...out.data.slice(i * 4, i * 4 + 3)].join(',')));
});

test('dither: colour mode produces the requested number of levels per channel', () => {
  const f = new Float32Array(32 * 32 * 3).map((_, i) => (i % 97) * 2.6);
  const out = AD.ditherColour(f, 32, 32, 3, 'bayer4', false);
  const vals = new Set();
  for (let i = 0; i < 32 * 32; i++) vals.add(out.data[i * 4]);
  assert.ok([...vals].every((v) => [0, 128, 255].includes(v)), [...vals].join());
});

test('halftone: CMYK conversion of key colours', () => {
  const f = new Float32Array([255, 255, 255, 0, 0, 0, 255, 0, 0]);
  const p = AD.cmykPlanes(f, 3, 1);
  assert.deepEqual([p.c[0], p.m[0], p.y[0], p.k[0]], [0, 0, 0, 0]); // white = no ink
  assert.deepEqual([p.c[1], p.m[1], p.y[1], p.k[1]], [0, 0, 0, 1]); // black = K only
  assert.deepEqual([p.c[2], p.m[2], p.y[2], p.k[2]], [0, 1, 1, 0]); // red = M + Y
});

test('halftone: dot size grows with coverage and a full circle covers its cell', () => {
  for (const shape of ['circle', 'square', 'line']) {
    let prev = -1;
    for (let c = 0; c <= 1.0001; c += 0.1) { const s = AD.shapeSize(c, 10, shape, 0); assert.ok(s >= prev); prev = s; }
  }
  approx(AD.shapeSize(1, 10, 'circle', 0), 10 / Math.SQRT2, 1e-9);
  assert.ok(AD.shapeSize(0.5, 10, 'circle', 50) > AD.shapeSize(0.5, 10, 'circle', 0), 'positive gain grows dots');
  assert.equal(AD.shapeSize(0, 10, 'circle', 0), 0);
});

test('halftone: grid visits roughly (w/cell)*(h/cell) cells at any angle', () => {
  for (const angle of [0, 15, 45, 90]) {
    let n = 0;
    AD.forEachCell(200, 100, 10, angle, () => n++);
    assert.ok(n >= 200, `angle ${angle}: ${n} cells`);
    assert.ok(n <= 300, `angle ${angle}: ${n} cells`);
  }
});
