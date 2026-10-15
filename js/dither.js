/*
 * ditherlab / dither.js
 * Reduces an image to a few tones or colours while faking the missing shades.
 *
 *  - Error diffusion (Floyd-Steinberg, Atkinson, ...): round each pixel, then
 *    push the rounding error onto neighbours that are not processed yet.
 *  - Ordered dithering (Bayer): compare each pixel with a repeating
 *    threshold pattern. No error is carried between pixels.
 *
 * Every quantiser returns an array of LEVEL INDICES (0..levels-1). Turning an
 * index into a colour is a separate step, so the same code serves both the
 * "tone" mode (palette lookup) and the "colour" mode (per-channel levels).
 */
(function (root) {
  'use strict';
  const AD = (root.AD = root.AD || {});

  // Each tap is [dx, dy, weight]; weights are divided by `div`.
  // Taps only point at pixels that have not been visited yet.
  const KERNELS = {
    floyd: { name: 'Floyd-Steinberg', div: 16, taps: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] },
    atkinson: { name: 'Atkinson', div: 8, taps: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] },
    jarvis: {
      name: 'Jarvis-Judice-Ninke', div: 48,
      taps: [[1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3],
        [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]],
    },
    burkes: { name: 'Burkes', div: 32, taps: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2]] },
    sierralite: { name: 'Sierra Lite', div: 4, taps: [[1, 0, 2], [-1, 1, 1], [0, 1, 1]] },
  };

  const ALGORITHMS = [
    ...Object.keys(KERNELS).map((id) => ({ id, name: KERNELS[id].name })),
    { id: 'bayer2', name: 'Bayer 2x2' },
    { id: 'bayer4', name: 'Bayer 4x4' },
    { id: 'bayer8', name: 'Bayer 8x8' },
    { id: 'threshold', name: 'Threshold (no dither)' },
    { id: 'noise', name: 'Random noise' },
  ];

  // Precompute typed arrays so the hot loop avoids array-of-array lookups.
  const compiled = {};
  function kernelFor(id) {
    if (compiled[id]) return compiled[id];
    const k = KERNELS[id];
    compiled[id] = {
      n: k.taps.length,
      dx: Int8Array.from(k.taps, (t) => t[0]),
      dy: Int8Array.from(k.taps, (t) => t[1]),
      wt: Float32Array.from(k.taps, (t) => t[2] / k.div),
    };
    return compiled[id];
  }

  /** Bayer matrix of size 2^k, built recursively: M(2n) = 4*M(n) + [[0,2],[3,1]]. */
  function bayer(size) {
    let m = [[0]];
    const q = [[0, 2], [3, 1]];
    while (m.length < size) {
      const n = m.length, next = [];
      for (let y = 0; y < 2 * n; y++) {
        const row = [];
        for (let x = 0; x < 2 * n; x++) {
          row.push(4 * m[y % n][x % n] + q[Math.floor(y / n)][Math.floor(x / n)]);
        }
        next.push(row);
      }
      m = next;
    }
    return m;
  }

  // Small deterministic random generator so the "noise" preview does not flicker.
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function diffuse(plane, w, h, levels, kernelId, serpentine) {
    const k = kernelFor(kernelId);
    const out = new Uint8Array(w * h);
    const src = Float32Array.from(plane); // working copy that receives errors
    const step = 255 / (levels - 1);
    for (let y = 0; y < h; y++) {
      const rev = serpentine && (y & 1) === 1; // zig-zag scan hides directional streaks
      for (let i = 0; i < w; i++) {
        const x = rev ? w - 1 - i : i;
        const p = y * w + x;
        const old = src[p];
        const v = old < 0 ? 0 : old > 255 ? 255 : old;
        const q = Math.round(v / step);
        out[p] = q;
        const err = old - q * step;
        if (err === 0) continue;
        for (let t = 0; t < k.n; t++) {
          const nx = x + (rev ? -k.dx[t] : k.dx[t]);
          const ny = y + k.dy[t];
          if (nx < 0 || nx >= w || ny >= h) continue;
          src[ny * w + nx] += err * k.wt[t];
        }
      }
    }
    return out;
  }

  function ordered(plane, w, h, levels, size) {
    const m = bayer(size), n = size * size;
    const out = new Uint8Array(w * h);
    const step = 255 / (levels - 1);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = Math.min(Math.max(plane[y * w + x], 0), 255) / step;
        const base = Math.floor(s);
        const thr = (m[y % size][x % size] + 0.5) / n;
        out[y * w + x] = Math.min(levels - 1, base + (s - base > thr ? 1 : 0));
      }
    }
    return out;
  }

  function simple(plane, w, h, levels, noise) {
    const out = new Uint8Array(w * h);
    const step = 255 / (levels - 1);
    const rnd = noise ? mulberry32(1234) : null;
    for (let i = 0; i < w * h; i++) {
      const s = Math.min(Math.max(plane[i], 0), 255) / step;
      if (rnd) {
        const base = Math.floor(s);
        out[i] = Math.min(levels - 1, base + (s - base > rnd() ? 1 : 0));
      } else out[i] = Math.min(levels - 1, Math.round(s));
    }
    return out;
  }

  /** plane: Float32Array 0..255. Returns Uint8Array of level indices. */
  function quantize(plane, w, h, levels, algo, serpentine) {
    if (KERNELS[algo]) return diffuse(plane, w, h, levels, algo, serpentine);
    if (algo.indexOf('bayer') === 0) return ordered(plane, w, h, levels, parseInt(algo.slice(5), 10));
    return simple(plane, w, h, levels, algo === 'noise');
  }

  /** Tone mode: grayscale in, palette colours out. `colors` runs dark -> light. */
  function ditherTone(gray, w, h, colors, algo, serpentine) {
    const idx = quantize(gray, w, h, colors.length, algo, serpentine);
    const pal = colors.map(AD.hexToRgb);
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const c = pal[idx[i]];
      data[i * 4] = c[0]; data[i * 4 + 1] = c[1]; data[i * 4 + 2] = c[2]; data[i * 4 + 3] = 255;
    }
    return { data, indices: idx };
  }

  /** Colour mode: each of R, G, B is reduced to `levels` values independently. */
  function ditherColour(f, w, h, levels, algo, serpentine) {
    const n = w * h;
    const data = new Uint8ClampedArray(n * 4);
    const plane = new Float32Array(n);
    for (let c = 0; c < 3; c++) {
      for (let i = 0; i < n; i++) plane[i] = f[i * 3 + c];
      const idx = quantize(plane, w, h, levels, algo, serpentine);
      for (let i = 0; i < n; i++) data[i * 4 + c] = Math.round((idx[i] * 255) / (levels - 1));
    }
    for (let i = 0; i < n; i++) data[i * 4 + 3] = 255;
    return { data };
  }

  Object.assign(AD, { KERNELS, ALGORITHMS, bayer, quantize, ditherTone, ditherColour });
  if (typeof module !== 'undefined' && module.exports) module.exports = AD;
})(typeof window !== 'undefined' ? window : globalThis);
