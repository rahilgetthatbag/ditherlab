/*
 * ditherlab / core.js
 * Shared helpers with no DOM access: pixel conversion, tone adjustments,
 * summed-area tables, colour helpers and presets. Everything here is a pure
 * function, which is why it can be unit-tested in Node (see /test).
 *
 * All scripts attach to one shared namespace, AD, so the project works as
 * plain <script> tags (no bundler, no ES-module server needed).
 */
(function (root) {
  'use strict';
  const AD = (root.AD = root.AD || {});

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  // Rec. 601 luma: how bright a colour looks to the human eye (0..255).
  const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

  /** RGBA bytes -> Float32 RGB (3 values per pixel). Transparent pixels are
   *  blended onto white so a transparent PNG does not turn black. */
  function rgbaToFloat(rgba, w, h) {
    const n = w * h;
    const f = new Float32Array(n * 3);
    for (let i = 0, j = 0, k = 0; i < n; i++, j += 4, k += 3) {
      const a = rgba[j + 3] / 255;
      f[k] = rgba[j] * a + 255 * (1 - a);
      f[k + 1] = rgba[j + 1] * a + 255 * (1 - a);
      f[k + 2] = rgba[j + 2] * a + 255 * (1 - a);
    }
    return f;
  }

  /** Float RGB -> one brightness value per pixel. */
  function toGray(f, w, h) {
    const n = w * h;
    const g = new Float32Array(n);
    for (let i = 0, k = 0; i < n; i++, k += 3) g[i] = luma(f[k], f[k + 1], f[k + 2]);
    return g;
  }

  /**
   * Brightness / contrast / gamma / invert, applied in place.
   *  brightness, contrast: -100..100   gamma: 0.2..3 (>1 brightens midtones)
   */
  function adjust(f, o) {
    const b = (o.brightness || 0) * 2.55;
    const c = (o.contrast || 0) * 2.55;
    const cf = (259 * (c + 255)) / (255 * (259 - c)); // classic contrast factor
    const inv = 1 / (o.gamma || 1);
    const useGamma = Math.abs(inv - 1) > 1e-6;
    for (let i = 0; i < f.length; i++) {
      let v = f[i] + b;
      v = cf * (v - 128) + 128;
      v = clamp(v, 0, 255);
      if (useGamma) v = 255 * Math.pow(v / 255, inv);
      if (o.invert) v = 255 - v;
      f[i] = v;
    }
    return f;
  }

  /** Stretch the tonal range so the 2nd..98th percentile fills 0..255. */
  function autoLevels(f, lowPct = 2, highPct = 98) {
    const n = f.length / 3;
    const hist = new Uint32Array(256);
    for (let i = 0, k = 0; i < n; i++, k += 3) {
      hist[clamp(Math.round(luma(f[k], f[k + 1], f[k + 2])), 0, 255)]++;
    }
    let acc = 0, lo = 0, hi = 255;
    const loT = (n * lowPct) / 100, hiT = (n * highPct) / 100;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= loT) { lo = v; break; } }
    acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= hiT) { hi = v; break; } }
    if (hi - lo < 8) return f; // nearly flat image: nothing sensible to stretch
    const scale = 255 / (hi - lo);
    for (let i = 0; i < f.length; i++) f[i] = clamp((f[i] - lo) * scale, 0, 255);
    return f;
  }

  /**
   * Summed-area table (integral image). Lets us get the average of any
   * rectangle in O(1), which the halftone mode needs for every dot.
   * Layout: (w+1) x (h+1), first row/column are zeros.
   */
  function makeSAT(plane, w, h) {
    const W = w + 1;
    const s = new Float64Array(W * (h + 1));
    for (let y = 0; y < h; y++) {
      let rowSum = 0;
      for (let x = 0; x < w; x++) {
        rowSum += plane[y * w + x];
        s[(y + 1) * W + (x + 1)] = s[y * W + (x + 1)] + rowSum;
      }
    }
    return s;
  }

  /** Mean of plane values inside [x0,x1) x [y0,y1), clamped to the image. */
  function boxMean(sat, w, h, x0, y0, x1, y1) {
    x0 = clamp(x0, 0, w); x1 = clamp(x1, 0, w);
    y0 = clamp(y0, 0, h); y1 = clamp(y1, 0, h);
    if (x1 <= x0 || y1 <= y0) return 0;
    const W = w + 1;
    const sum = sat[y1 * W + x1] - sat[y0 * W + x1] - sat[y1 * W + x0] + sat[y0 * W + x0];
    return sum / ((x1 - x0) * (y1 - y0));
  }

  function hexToRgb(hex) {
    let s = String(hex).trim().replace('#', '');
    if (s.length === 3) s = s.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(s)) return [0, 0, 0];
    const n = parseInt(s, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgbToHex = (r, g, b) =>
    '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

  // Tone palettes, ordered dark -> light (index 0 is used for the darkest tone).
  const PALETTES = [
    { id: 'bw', name: 'Black and white', colors: ['#000000', '#ffffff'] },
    { id: 'paper', name: 'Ink on paper', colors: ['#16171a', '#f1f0ec'] },
    { id: 'terminal', name: 'Terminal green', colors: ['#000a03', '#00ff41'] },
    { id: 'amber', name: 'Amber', colors: ['#120a00', '#ff9f1c'] },
    { id: 'neon', name: 'Neon red', colors: ['#0a0205', '#ff2d46', '#19f3ff'] },
    { id: 'signal', name: 'Signal', colors: ['#141416', '#ff4a1c', '#e4e4e1'] },
    { id: 'gameboy', name: 'Handheld green', colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'] },
    { id: 'cga', name: 'CGA', colors: ['#000000', '#ff55ff', '#55ffff', '#ffffff'] },
  ];

  // Foreground/background pairs for ASCII and halftone. `dark` = light-on-dark.
  const LOOKS = [
    { id: 'paper', name: 'Ink on paper', fg: '#16171a', bg: '#f1f0ec', dark: false },
    { id: 'ink', name: 'White on black', fg: '#f4f4f1', bg: '#0c0c0d', dark: true },
    { id: 'terminal', name: 'Terminal green', fg: '#00ff41', bg: '#000a03', dark: true },
    { id: 'amber', name: 'Amber', fg: '#ff9f1c', bg: '#120a00', dark: true },
    { id: 'neon', name: 'Neon red', fg: '#ff2d46', bg: '#070204', dark: true },
  ];

  Object.assign(AD, {
    clamp, luma, rgbaToFloat, toGray, adjust, autoLevels,
    makeSAT, boxMean, hexToRgb, rgbToHex, PALETTES, LOOKS,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = AD;
})(typeof window !== 'undefined' ? window : globalThis);
