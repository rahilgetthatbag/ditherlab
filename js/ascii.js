/*
 * ditherlab / ascii.js
 * Turns brightness into characters. The working image is shrunk to
 * (columns x rows), so one pixel = one character cell.
 */
(function (root) {
  'use strict';
  const AD = (root.AD = root.AD || {});

  // Every ramp runs from the DENSEST glyph to the sparsest.
  const RAMPS = {
    standard: '@%#*+=-:. ',
    detailed: '$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/|()1{}[]?-_+~<>i!lI;:,^`\'. ',
    blocks: '\u2588\u2593\u2592\u2591 ',
    minimal: '#+-. ',
    binary: '10 ',
  };

  /**
   * How many rows for a given column count? Characters are taller than they
   * are wide, so rows = cols * (imageH / imageW) * (charWidth / lineHeight).
   * `aspect` is charWidth / lineHeight (about 0.5 for most monospace fonts).
   */
  function gridSize(cols, iw, ih, aspect) {
    return { cols, rows: Math.max(1, Math.round(cols * (ih / iw) * aspect)) };
  }

  function rampChars(name, custom) {
    const src = name === 'custom' ? custom : RAMPS[name] || RAMPS.standard;
    const chars = Array.from(src || '');
    return chars.length >= 2 ? chars : Array.from(RAMPS.standard);
  }

  /**
   * gray: one value (0..255) per cell.
   * lightOnDark=false: dark pixels get dense glyphs (for dark text on paper).
   * lightOnDark=true : bright pixels get dense glyphs (for glowing text).
   */
  function mapToChars(gray, w, h, chars, lightOnDark) {
    const n = chars.length;
    const lines = [];
    for (let y = 0; y < h; y++) {
      let s = '';
      for (let x = 0; x < w; x++) {
        let k = Math.floor((gray[y * w + x] / 256) * n);
        if (k >= n) k = n - 1;
        if (lightOnDark) k = n - 1 - k;
        s += chars[k];
      }
      lines.push(s);
    }
    return { lines, text: lines.join('\n') };
  }

  // Block-element glyphs and how much of the cell they cover. Fonts rarely
  // fill the cell exactly, which leaves thin seams, so we draw these four as
  // rectangles instead of text.
  const SHADES = { '\u2588': 1, '\u2593': 0.75, '\u2592': 0.5, '\u2591': 0.25 };

  /**
   * Draw the text grid on a canvas context. Needs the DOM, so it is not unit
   * tested. o: { lines, rgb (Float32Array|null), cols, rows, cw, lh, fs,
   *              fg, bg, scale, font }
   */
  function drawAscii(ctx, o) {
    const w = Math.round(o.cols * o.cw), h = o.rows * o.lh;
    ctx.save();
    ctx.setTransform(o.scale, 0, 0, o.scale, 0, 0);
    ctx.fillStyle = o.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.font = o.fs + 'px ' + o.font;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const hasBlocks = /[\u2588\u2593\u2592\u2591]/.test(o.lines.join(''));
    if (!o.rgb && !hasBlocks) {
      // Fast path: one fillText per row.
      ctx.fillStyle = o.fg;
      o.lines.forEach((line, y) => ctx.fillText(line, 0, y * o.lh + o.lh / 2));
    } else {
      // One draw per visible character (needed for per-character colour and for blocks).
      if (!o.rgb) ctx.fillStyle = o.fg;
      for (let y = 0; y < o.rows; y++) {
        const chars = Array.from(o.lines[y]);
        for (let x = 0; x < chars.length; x++) {
          const ch = chars[x];
          if (ch === ' ') continue;
          if (o.rgb) {
            const k = (y * o.cols + x) * 3;
            ctx.fillStyle = 'rgb(' + (o.rgb[k] | 0) + ',' + (o.rgb[k + 1] | 0) + ',' + (o.rgb[k + 2] | 0) + ')';
          }
          const shade = SHADES[ch];
          if (shade) {
            ctx.globalAlpha = shade;
            ctx.fillRect(x * o.cw, y * o.lh, o.cw + 0.6, o.lh + 0.6);
            ctx.globalAlpha = 1;
          } else {
            ctx.fillText(ch, x * o.cw, y * o.lh + o.lh / 2);
          }
        }
      }
    }
    ctx.restore();
  }

  Object.assign(AD, { RAMPS, gridSize, rampChars, mapToChars, drawAscii });
  if (typeof module !== 'undefined' && module.exports) module.exports = AD;
})(typeof window !== 'undefined' ? window : globalThis);
