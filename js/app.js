/*
 * ditherlab / app.js
 * UI wiring. Everything algorithmic lives in core/ascii/dither/halftone.js;
 * this file only reads the controls, runs the right renderer and exports.
 *
 * Flow:  controls change -> schedule() -> render() -> renderTo(canvas, scale)
 */
(function () {
  'use strict';
  const AD = window.AD;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const val = (id) => $('#' + id).value;
  const num = (id) => +$('#' + id).value;
  const chk = (id) => $('#' + id).checked;

  const FONT = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';
  const MAX_SOURCE = 2400; // longest side of the stored source image
  const MAX_OUTPUT = 8192; // longest side of any canvas we create

  const S = { source: null, name: 'ditherlab', mode: 'dither', text: '', queued: false };
  const out = $('#out');
  const say = (m) => { $('#status').textContent = m; };

  // ---------------------------------------------------------------- loading
  function setSource(img, name) {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const k = Math.min(1, MAX_SOURCE / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k));
    c.height = Math.max(1, Math.round(h * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    S.source = c;
    S.name = (name || 'ditherlab').replace(/\.[^.]+$/, '');
    $('#empty').hidden = true;
    out.hidden = false;
    $('#png').disabled = false;
    $('#copy').disabled = $('#txt').disabled = false;
    say('');
    schedule();
  }

  function loadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { setSource(img, name); URL.revokeObjectURL(url); };
    img.onerror = () => { say('Could not read that file as an image.'); URL.revokeObjectURL(url); };
    img.src = url;
  }

  // A built-in picture so the app is usable with no files: shaded sphere,
  // red ring and a black-to-white ramp (handy for judging dither quality).
  function sampleCanvas() {
    const c = document.createElement('canvas');
    c.width = 800; c.height = 1000;
    const x = c.getContext('2d');
    const sky = x.createLinearGradient(0, 0, 0, 1000);
    sky.addColorStop(0, '#2b2d42'); sky.addColorStop(1, '#edf2f4');
    x.fillStyle = sky; x.fillRect(0, 0, 800, 1000);
    const ball = x.createRadialGradient(330, 360, 30, 400, 430, 270);
    ball.addColorStop(0, '#ffffff'); ball.addColorStop(0.55, '#8d99ae'); ball.addColorStop(1, '#1d1e2c');
    x.fillStyle = ball; x.beginPath(); x.arc(400, 430, 270, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#ef233c'; x.lineWidth = 28;
    x.beginPath(); x.ellipse(400, 440, 360, 80, -0.35, 0, Math.PI * 2); x.stroke();
    const ramp = x.createLinearGradient(60, 0, 740, 0);
    ramp.addColorStop(0, '#000'); ramp.addColorStop(1, '#fff');
    x.fillStyle = ramp; x.fillRect(60, 860, 680, 70);
    return c;
  }

  // ---------------------------------------------------------------- pipeline
  /** Resize the source to w x h and return Float32 RGB with the tone controls applied. */
  function prepare(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.drawImage(S.source, 0, 0, w, h);
    const f = AD.rgbaToFloat(x.getImageData(0, 0, w, h).data, w, h);
    if (chk('auto')) AD.autoLevels(f);
    AD.adjust(f, { brightness: num('brightness'), contrast: num('contrast'), gamma: num('gamma'), invert: chk('invert') });
    return f;
  }

  /** Never let an export exceed the browser's canvas size limit. */
  const fit = (w, h, s) => Math.max(1, Math.min(s, Math.floor(MAX_OUTPUT / Math.max(w, h))));
  const sizeFor = (W) => ({ W, H: Math.max(1, Math.round((W * S.source.height) / S.source.width)) });

  function renderDither(cv, s) {
    const { W, H } = sizeFor(num('res'));
    const f = prepare(W, H);
    const algo = val('algo'), serp = chk('serp');
    let result;
    if (val('space') === 'colour') {
      result = AD.ditherColour(f, W, H, num('levels'), algo, serp);
    } else {
      const id = val('pal');
      const colors = id === 'custom' ? [val('pdark'), val('plight')] : AD.PALETTES.find((p) => p.id === id).colors;
      result = AD.ditherTone(AD.toGray(f, W, H), W, H, colors, algo, serp);
    }
    const tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = H;
    tmp.getContext('2d').putImageData(new ImageData(result.data, W, H), 0, 0);
    const k = fit(W, H, s);
    cv.width = W * k; cv.height = H * k;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false; // keep hard pixel edges when enlarging
    ctx.drawImage(tmp, 0, 0, W * k, H * k);
    return `${W}×${H}px, ${algo}`;
  }

  function renderAscii(cv, s) {
    const cols = num('cols');
    const FS = 16, LH = Math.round(FS * 1.2);
    const m = document.createElement('canvas').getContext('2d');
    m.font = FS + 'px ' + FONT;
    const CW = m.measureText('M').width;
    const { rows } = AD.gridSize(cols, S.source.width, S.source.height, CW / LH);
    const f = prepare(cols, rows);
    // Dark background -> bright pixels should get the dense glyphs.
    const dark = chk('acolor') || AD.luma(...AD.hexToRgb(val('abg'))) < 128;
    const res = AD.mapToChars(AD.toGray(f, cols, rows), cols, rows, AD.rampChars(val('ramp'), val('customRamp')), dark);
    S.text = res.text;
    const k = fit(cols * CW, rows * LH, s);
    cv.width = Math.round(cols * CW * k); cv.height = rows * LH * k;
    AD.drawAscii(cv.getContext('2d'), {
      lines: res.lines, rgb: chk('acolor') ? f : null, cols, rows, cw: CW, lh: LH, fs: FS,
      fg: val('afg'), bg: chk('acolor') ? '#0c0c0d' : val('abg'), scale: k, font: FONT,
    });
    return `${cols}×${rows} characters`;
  }

  function renderHalftone(cv, s) {
    const { W, H } = sizeFor(num('hres'));
    const f = prepare(W, H);
    const k = fit(W, H, s);
    cv.width = W * k; cv.height = H * k;
    const ctx = cv.getContext('2d');
    ctx.setTransform(k, 0, 0, k, 0, 0); // draw in working pixels, output is vector-sharp at any scale
    const o = { cell: num('cell'), angle: num('angle'), gain: num('gain'), shape: val('shape') };
    if (val('hmode') === 'cmyk') {
      const newLayer = () => { const l = document.createElement('canvas'); l.width = cv.width; l.height = cv.height; return l; };
      AD.drawHalftoneCMYK(ctx, f, W, H, Object.assign(o, { scale: k, newLayer }));
    } else {
      const look = AD.LOOKS.find((l) => l.id === val('hlook'));
      const follow = look ? look.dark : AD.luma(...AD.hexToRgb(val('hpaper'))) < 128;
      AD.drawHalftoneMono(ctx, AD.toGray(f, W, H), W, H, Object.assign(o, { ink: val('hink'), paper: val('hpaper'), follow }));
    }
    return `${W}×${H}px, ${o.shape}s, cell ${o.cell}`;
  }

  /** Render the current settings into `cv` at integer scale `s`. Returns a short description. */
  function renderTo(cv, s) {
    if (S.mode === 'ascii') return renderAscii(cv, s);
    if (S.mode === 'halftone') return renderHalftone(cv, s);
    return renderDither(cv, s);
  }

  function render() {
    if (!S.source) return;
    const t0 = performance.now();
    try {
      const info = renderTo(out, 1);
      out.style.imageRendering = S.mode === 'dither' ? 'pixelated' : 'auto';
      $('#info').textContent = `${S.source.width}×${S.source.height} → ${info}`;
      say(`${Math.round(performance.now() - t0)} ms`);
    } catch (e) {
      say('Something went wrong: ' + e.message);
    }
  }

  // Coalesce bursts of slider input into one render per animation frame.
  function schedule() {
    if (S.queued) return;
    S.queued = true;
    requestAnimationFrame(() => { S.queued = false; render(); });
  }

  // ---------------------------------------------------------------- export
  async function save(blob, filename) {
    // Inside Claude's artifact viewer a normal download link is blocked; there a
    // "downloads" capability exists. Anywhere else we fall back to a plain link.
    let dl = null;
    try { dl = await (window.claude && window.claude.use && window.claude.use('downloads')); } catch (e) { dl = null; }
    if (dl) {
      try { await dl.save({ filename, data: blob }); say('Saved.'); }
      catch (e) { say(e && e.code === 'declined' ? 'Save cancelled.' : 'Could not save the file.'); }
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function exportPng() {
    if (!S.source) return;
    const c = document.createElement('canvas');
    say('Rendering…');
    setTimeout(() => {
      renderTo(c, num('scale'));
      c.toBlob((b) => (b ? save(b, `${S.name}-${S.mode}.png`) : say('Export failed.')), 'image/png');
    }, 20);
  }

  function copyText() {
    if (!S.text) return;
    const fallback = () => {
      const t = document.createElement('textarea');
      t.value = S.text; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); say('Copied.'); } catch (e) { say('Copy is blocked here. Use Download .txt.'); }
      t.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(S.text).then(() => say('Copied.'), fallback);
    } else fallback();
  }

  // ---------------------------------------------------------------- controls
  function setMode(m) {
    S.mode = m;
    $$('#modes .chip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    $$('[data-mode]').forEach((el) => { if (!el.classList.contains('chip')) el.hidden = el.dataset.mode !== m; });
    schedule();
  }

  function fillSelect(sel, items, value) {
    items.forEach((it) => { const o = document.createElement('option'); o.value = it.id; o.textContent = it.name; sel.appendChild(o); });
    if (value) sel.value = value;
  }

  function init() {
    fillSelect($('#algo'), AD.ALGORITHMS, 'floyd');
    fillSelect($('#pal'), AD.PALETTES.concat([{ id: 'custom', name: 'Custom (2 colours)' }]), 'bw');
    fillSelect($('#alook'), AD.LOOKS.concat([{ id: 'custom', name: 'Custom colours' }]), 'paper');
    fillSelect($('#hlook'), AD.LOOKS.concat([{ id: 'custom', name: 'Custom colours' }]), 'paper');

    // Slider read-outs
    $$('input[type=range]').forEach((r) => {
      const o = r.parentElement.querySelector('output');
      const sync = () => { if (o) o.textContent = r.value; };
      r.addEventListener('input', sync); sync();
    });

    // Anything marked .ctl re-renders on change
    $$('.ctl').forEach((el) => el.addEventListener(el.type === 'range' || el.type === 'text' ? 'input' : 'change', schedule));
    $$('.ctl[type=color]').forEach((el) => el.addEventListener('input', schedule));

    $$('#modes .chip').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

    // Looks: a preset sets both colours; editing a colour switches the preset to "custom".
    const bindLook = (selId, fgId, bgId) => {
      $('#' + selId).addEventListener('change', () => {
        const l = AD.LOOKS.find((x) => x.id === val(selId));
        if (l) { $('#' + fgId).value = l.fg; $('#' + bgId).value = l.bg; }
        schedule();
      });
      [fgId, bgId].forEach((id) => $('#' + id).addEventListener('input', () => { $('#' + selId).value = 'custom'; }));
    };
    bindLook('alook', 'afg', 'abg');
    bindLook('hlook', 'hink', 'hpaper');

    // Show/hide dependent rows
    const sync = () => {
      $('#customRow').hidden = $('#customHelp').hidden = val('ramp') !== 'custom';
      const colour = val('space') === 'colour';
      $('#palRow').hidden = colour;
      $('#customPal').hidden = colour || val('pal') !== 'custom';
      $('#lvRow').hidden = !colour;
      $('#monoRows').hidden = val('hmode') === 'cmyk';
    };
    ['ramp', 'space', 'pal', 'hmode'].forEach((id) => $('#' + id).addEventListener('change', sync));
    $('#acolor').addEventListener('change', () => { $('#afg').disabled = chk('acolor'); });
    sync();

    // Files, drag and drop, paste
    $('#file').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) loadBlob(f, f.name); });
    $('#sample').addEventListener('click', () => { setSource(sampleCanvas(), 'sample'); });
    const stage = $('#stage');
    ['dragenter', 'dragover'].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); stage.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); stage.classList.remove('over'); }));
    document.addEventListener('drop', (e) => {
      const f = Array.from(e.dataTransfer.files).find((x) => x.type.indexOf('image/') === 0);
      if (f) loadBlob(f, f.name); else say('That was not an image file.');
    });
    document.addEventListener('paste', (e) => {
      const item = Array.from(e.clipboardData ? e.clipboardData.items : []).find((i) => i.type.indexOf('image/') === 0);
      if (item) loadBlob(item.getAsFile(), 'pasted');
    });

    $('#png').addEventListener('click', exportPng);
    $('#copy').addEventListener('click', copyText);
    $('#txt').addEventListener('click', () => {
      if (S.text) save(new Blob([S.text], { type: 'text/plain' }), `${S.name}-ascii.txt`);
    });

    setMode('dither');
    // Re-render once web fonts arrive so ASCII measurements use the real font.
    if (document.fonts && document.fonts.load) document.fonts.load('16px "JetBrains Mono"').then(schedule);
  }

  init();
})();
