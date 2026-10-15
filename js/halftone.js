/*
 * ditherlab / halftone.js
 * Draws the image as a screen of dots (or squares / lines) whose size follows
 * the darkness of the picture under them, like newspaper print.
 *
 * Steps for every dot:
 *   1. Walk a grid that is rotated by `angle` degrees.
 *   2. Average the image under the cell using a summed-area table (O(1)).
 *   3. Convert that average (0..1 "ink coverage") to a dot size.
 *   4. Add the shape to one big path; fill once at the end (fast).
 */
(function (root) {
  'use strict';
  const AD = (root.AD = root.AD || {});

  /** RGB (0..255, float) -> four 0..1 ink planes. */
  function cmykPlanes(f, w, h) {
    const n = w * h;
    const c = new Float32Array(n), m = new Float32Array(n), y = new Float32Array(n), k = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = f[i * 3] / 255, g = f[i * 3 + 1] / 255, b = f[i * 3 + 2] / 255;
      const kk = 1 - Math.max(r, g, b);
      k[i] = kk;
      if (kk < 1) {
        c[i] = (1 - r - kk) / (1 - kk);
        m[i] = (1 - g - kk) / (1 - kk);
        y[i] = (1 - b - kk) / (1 - kk);
      }
    }
    return { c, m, y, k };
  }

  /**
   * Coverage (0..1) -> size of the mark.
   *  circle: radius       square: half side       line: half thickness
   * `gain` (-50..50) mimics dot gain: positive makes dots grow faster.
   * A circle of radius cell/sqrt(2) exactly covers its cell, so full ink
   * (coverage 1) produces solid colour.
   */
  function shapeSize(coverage, cell, shape, gain) {
    const c = Math.pow(Math.min(Math.max(coverage, 0), 1), 1 / (1 + (gain || 0) / 100));
    if (shape === 'square') return cell * 0.5 * Math.sqrt(c);
    if (shape === 'line') return cell * 0.5 * c;
    return cell * Math.SQRT1_2 * Math.sqrt(c);
  }

  /** Calls fn(x, y) for the centre of every cell of a rotated grid that touches the image. */
  function forEachCell(w, h, cell, angleDeg, fn) {
    const a = (angleDeg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    const cx = w / 2, cy = h / 2;
    const n = Math.ceil((Math.hypot(w, h) / 2 + cell) / cell);
    for (let j = -n; j <= n; j++) {
      for (let i = -n; i <= n; i++) {
        const u = i * cell, v = j * cell;
        const x = cx + u * ca - v * sa, y = cy + u * sa + v * ca;
        if (x < -cell / 2 || x > w + cell / 2 || y < -cell / 2 || y > h + cell / 2) continue;
        fn(x, y);
      }
    }
  }

  /** One ink layer. `plane` is coverage 0..1 per pixel. */
  function drawLayer(ctx, plane, w, h, o) {
    const sat = AD.makeSAT(plane, w, h);
    const a = (o.angle * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    const half = o.cell / 2;
    ctx.fillStyle = o.color;
    ctx.beginPath();
    // Fill in small batches. One path with thousands of sub-shapes is very slow
    // to rasterise (measured ~10 s for 8,000 dots); batches of 64 take ~70 ms.
    let batch = 0;
    const flush = () => { ctx.fill(); ctx.beginPath(); batch = 0; };
    forEachCell(w, h, o.cell, o.angle, (x, y) => {
      const cov = AD.boxMean(sat, w, h, Math.floor(x - half), Math.floor(y - half), Math.ceil(x + half), Math.ceil(y + half));
      if (cov < 0.004) return;
      const s = shapeSize(cov, o.cell, o.shape, o.gain);
      if (o.shape === 'circle') {
        ctx.moveTo(x + s, y);
        ctx.arc(x, y, s, 0, Math.PI * 2);
        if (++batch === 64) flush();
        return;
      }
      // Rotated rectangle: squares are s x s, lines are cell (+overlap) x s.
      const hw = o.shape === 'square' ? s : o.cell / 2 + 0.5, hh = s;
      const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
      pts.forEach((p, i) => {
        const px = x + p[0] * ca - p[1] * sa, py = y + p[0] * sa + p[1] * ca;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.closePath();
      if (++batch === 64) flush();
    });
    ctx.fill();
  }

  /** Single ink on paper. o: { cell, angle, shape, gain, ink, paper, follow } */
  function drawHalftoneMono(ctx, gray, w, h, o) {
    const cov = new Float32Array(w * h);
    for (let i = 0; i < cov.length; i++) cov[i] = o.follow ? gray[i] / 255 : 1 - gray[i] / 255;
    ctx.fillStyle = o.paper;
    ctx.fillRect(0, 0, w, h);
    drawLayer(ctx, cov, w, h, { cell: o.cell, angle: o.angle, shape: o.shape, gain: o.gain, color: o.ink });
  }

  /**
   * Four screens at classic angles. Each ink is first drawn on its own
   * transparent layer (so overlapping dots of the SAME ink do not darken
   * each other), then the layer is multiplied onto the paper once.
   * o: { cell, angle, shape, gain, scale, newLayer: () => canvas }
   */
  function drawHalftoneCMYK(ctx, f, w, h, o) {
    const planes = cmykPlanes(f, w, h);
    const k = o.scale || 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fbfaf6';
    ctx.fillRect(0, 0, w * k, h * k);
    ctx.restore();
    const screens = [['c', '#00aeef', 15], ['m', '#ec008c', 75], ['y', '#fff200', 0], ['k', '#1a1a1a', 45]];
    screens.forEach(([key, color, base]) => {
      const layer = o.newLayer();
      const lctx = layer.getContext('2d');
      lctx.setTransform(k, 0, 0, k, 0, 0);
      drawLayer(lctx, planes[key], w, h, { cell: o.cell, angle: base + (o.angle - 45), shape: o.shape, gain: o.gain, color });
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(layer, 0, 0);
      ctx.restore();
    });
  }

  Object.assign(AD, { cmykPlanes, shapeSize, forEachCell, drawHalftoneMono, drawHalftoneCMYK });
  if (typeof module !== 'undefined' && module.exports) module.exports = AD;
})(typeof window !== 'undefined' ? window : globalThis);
