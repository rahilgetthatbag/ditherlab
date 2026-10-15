ditherlab: technical specification
Version 1.0. Last updated 15 October 2026.
Verification status. The 17 unit tests pass in Node. The whole page was also run in a simulated browser (jsdom with a real canvas) that rendered every mode, switched options, and exported a 2x PNG without errors. It has not been tried in real Chrome, Firefox or Safari, and it has not been checked with a screen reader. Timings below come from that simulated environment (software canvas) and are only indicative.
1. Purpose and scope
ditherlab converts a picture into one of three stylised forms, entirely in the browser:
• ASCII: the picture drawn with text characters.
• Dither: the picture reduced to a few tones or colours, with the missing shades faked by patterns.
• Halftone: the picture drawn as a screen of dots, squares or lines, like newspaper print.
In scope: loading an image, tone adjustment, the three conversions with their options, live preview, and export to PNG (plus text for ASCII). Out of scope: video, batch processing, accounts, server code, and saving settings between visits.
2. Requirements
Functional
1. Load an image by file picker, drag and drop, or clipboard paste, and offer a built-in sample.
2. Adjust brightness, contrast, gamma, invert, and auto levels before conversion.
3. ASCII: choose a character ramp or a custom one, choose colours, optionally use the image colours, export PNG, copy text, download .txt.
4. Dither: choose from 10 algorithms, a palette or full colour, and a resolution.
5. Halftone: choose shape, cell size, angle, dot gain, single ink or CMYK.
6. Update the preview live while controls move.
7. Export PNG at 1x to 8x.
Non-functional
• Plain HTML, CSS and JavaScript. No libraries, no build step needed to run.
• Works when index.html is opened from disk and when served from a GitHub Pages subfolder (all paths relative).
• The algorithm code is separate from the page code so it can be tested in Node.
• Nothing leaves the device. The only network requests are the font stylesheet and the font files.
• Keyboard operable, with labelled controls, a live status message, and light and dark appearance.
3. System overview
 image file --> source canvas (capped at 2400 px)
                    |
   control values --+--> prepare(): resize -> float RGB -> auto levels -> adjust
                    |
          +---------+-----------+--------------------+
          |                     |                    |
     renderAscii           renderDither        renderHalftone
   (gray -> characters)   (quantise -> pixels) (dots on rotated grid)
          |                     |                    |
          +---------+-----------+--------------------+
                    |
               preview canvas  (scale 1)
               export canvas   (scale 1..8, then PNG)
One rule runs through the design: a renderer takes a canvas and an integer scale and draws the final result into it. The preview calls it with scale 1. Export calls it again with a larger scale on a fresh canvas. There is no separate export code path, so what you see is what you get.
4. Repository layout
File
Responsibility
Needs the DOM?
index.html
Page structure and every control
yes
css/style.css
Look, layout, light and dark mode
yes
js/core.js
Pixel conversion, tone adjustments, summed-area table, colour helpers, presets
no
js/ascii.js
Brightness to characters, character grid size, text drawing
drawing only
js/dither.js
Error diffusion, ordered dithering, palette and colour output
no
js/halftone.js
Rotated dot grid, shape sizing, CMYK separation, drawing
drawing only
js/app.js
Reading controls, loading, rendering pipeline, export
yes
test/ditherlab.test.js
Unit tests for the DOM-free code
no
tools/build.js
Inlines everything into dist/ditherlab.html
no
4.1 Why classic scripts and a shared namespace
ES modules do not load from a file opened on disk, which would make the project need a local server just to open it. So each script is wrapped in an immediately invoked function, attaches its functions to one shared object called AD, and (when running in Node) also exports it. The page loads the scripts in order: core, ascii, dither, halftone, app. The tests load the same four logic files with require.
4.2 Data conventions
• Image data inside the pipeline is a Float32Array of RGB triples (3 values per pixel, range 0 to 255), not the 4-byte RGBA the canvas gives. Floats let tone adjustments and error diffusion carry fractions without rounding at every step.
• A grayscale image is a Float32Array with one value per pixel.
• Quantisers return a Uint8Array of level indices. Turning indices into colours is a separate step.
• Output pixels are a Uint8ClampedArray in RGBA order, ready for ImageData.
5. Module specifications
5.1 core.js
rgbaToFloat(rgba, w, h). Converts canvas bytes to float RGB. Each pixel is blended onto white by its alpha, so transparent PNG areas become white rather than black.
toGray(f, w, h). Brightness uses Rec. 601 luma: 0.299 R + 0.587 G + 0.114 B. This weights green most, matching how bright a colour looks to the eye.
adjust(f, options). Works in place, per channel value v, in this order:
1. Brightness: v = v + b, where b = slider x 2.55.
2. Contrast: v = F x (v - 128) + 128, where F = 259 (c + 255) / (255 (259 - c)) and c = slider x 2.55. At slider 0, F = 1.
3. Clamp to 0..255.
4. Gamma: v = 255 x (v / 255) ^ (1 / gamma). Gamma above 1 brightens midtones.
5. Invert (optional): v = 255 - v.
autoLevels(f, 2, 98). Builds a 256-bin histogram of luma, finds the values below which 2 percent and 98 percent of pixels fall (lo and hi), and stretches every channel linearly so lo maps to 0 and hi to 255. If hi - lo is under 8 the image is nearly flat and is left alone.
makeSAT(plane, w, h) and boxMean(...). A summed-area table (integral image) of size (w+1) x (h+1) in a Float64Array. Each cell holds the sum of everything above and to the left. The mean of any rectangle then costs four lookups: S(x1,y1) - S(x0,y1) - S(x1,y0) + S(x0,y0), divided by the area. Rectangles are clamped to the image. This is what makes halftone fast, because every dot needs an average over its cell.
Presets.
• PALETTES (tone palettes, dark to light): black and white, ink on paper, terminal green, amber, neon red (3 colours), signal (3), handheld green (4), CGA (4).
• LOOKS (foreground, background and a dark flag, used by ASCII and halftone): ink on paper, white on black, terminal green, amber, neon red.
Colour helpers. hexToRgb accepts 3 or 6 digit hex and returns black for invalid input. rgbToHex is the reverse.
5.2 ascii.js
Ramps. Strings ordered from the densest glyph to the sparsest: standard (@%#*+=-:. ), detailed (about 70 glyphs), blocks, minimal, binary, or a custom string typed by the user. A custom ramp with fewer than 2 characters falls back to standard. Characters are split with Array.from so multi-unit characters count once.
gridSize(cols, iw, ih, aspect). Characters are taller than wide, so the row count is rows = round(cols x (ih / iw) x aspect), at least 1, where aspect = character width / line height. The app measures the width of the letter M in the real font at 16 px and uses a line height of round(16 x 1.2) = 19 px, giving an aspect of about 0.5. Without this correction the art looks stretched vertically.
mapToChars(gray, w, h, chars, lightOnDark). For each cell, index k = floor(gray / 256 x n), clamped to n - 1. If lightOnDark is true the index is reversed (k = n - 1 - k). Dark text on a light background wants dark pixels to become dense glyphs. Light text on a dark background wants the opposite, because the glyphs are the bright part of the picture.
The app decides lightOnDark from the background colour: true when its luma is under 128, or when the use-image-colours option is on (that mode always draws on near-black).
drawAscii(ctx, options). Two paths:
• Fast path: one fillText call per row. Used when there are no per-character colours and no block glyphs.
• Per-character path: one draw per visible character. Used for image colours or when the text contains block glyphs. The four block characters (full block and the three shades) are drawn as rectangles with alpha 1, 0.75, 0.5 and 0.25 instead of as text, because fonts rarely fill the cell exactly and the result showed thin seams between rows.
The canvas size is columns x character width by rows x line height, times the export scale. The text itself is kept in memory so Copy text and Download .txt work without re-rendering.
5.3 dither.js
Idea. Reducing an image to few levels causes banding. Dithering hides it by arranging the available levels so that, at a distance, the average matches the original.
Level quantisation. For L levels the step is 255 / (L - 1). A value v maps to the nearest level index round(v / step). For two levels that means 0 or 255.
Error diffusion (5 kernels). Scan pixels in order. For each one: round it to the nearest level, compute the error (the old value minus the new one), and add fractions of that error to neighbours that have not been visited yet. The working copy is a Float32Array, so errors can push a value below 0 or above 255 before it is clamped for rounding. Zero errors are skipped.
Kernel
Taps
Divisor
Character
Floyd-Steinberg
4
16
The standard. Smooth, slightly noisy.
Atkinson
6
8
Spreads only 6/8 of the error, so highlights and shadows clip. High contrast, classic early-Mac look.
Jarvis-Judice-Ninke
12
48
Wide spread, very smooth, slower.
Burkes
7
32
A lighter cousin of the above.
Sierra Lite
3
4
Fastest, a little coarse.
Kernels are compiled once into typed arrays (dx, dy, weight already divided) so the inner loop has no array-of-array lookups.
Serpentine scan. When on, odd rows are scanned right to left and the kernel is mirrored horizontally. This removes the diagonal streaks that a fixed direction creates.
Ordered dithering (Bayer). No error is carried. Each pixel is compared with a repeating threshold matrix. The matrix of size 2n is built recursively from size n: M(2n) = 4 x M(n) + [[0,2],[3,1]] laid out in four quadrants. The threshold for a cell is (m + 0.5) / (size x size). With s = v / step and base = floor(s), the output level is base + 1 if (s - base) is greater than the threshold, otherwise base (clamped to the top level). This works for more than two levels. Sizes 2, 4 and 8 are offered. The output has a regular crosshatch texture and is fast.
Threshold and noise. Threshold is plain rounding, with no dithering, shown for comparison. Noise compares against random values from a small seeded generator (mulberry32, seed 1234) so the preview does not flicker between renders.
Two output modes.
• Tone (palette): the image becomes grayscale, is quantised to N levels where N is the number of palette colours, and each index is replaced by the palette colour at that position. Palettes must therefore run from dark to light. A custom palette is two colours.
• Full colour: each of R, G and B is quantised independently to 2 to 8 levels. Two levels gives 8 colours. Because the channels are handled separately, colours can shift slightly, which is part of the look.
Cost. One pass over the pixels, so work grows with width x height. Error diffusion touches 3 to 12 neighbours per pixel.
5.4 halftone.js
Idea. Print cannot make grey ink. It prints dots whose size encodes darkness. From a distance the eye averages them.
Per dot:
1. Walk a rotated grid. Cell centres are at (i x cell, j x cell), rotated by the chosen angle around the image centre. Only centres within half a cell of the image are used.
2. Measure coverage. Average the ink amount under the cell using the summed-area table. Ink amount is 1 minus brightness (or brightness itself for light-on-dark).
3. Size the mark. With coverage c (0 to 1), first apply dot gain: c' = c ^ (1 / (1 + gain / 100)), so positive gain grows dots faster. Then: circle radius = cell x sqrt(1/2) x sqrt(c'), square half-side = cell x 0.5 x sqrt(c'), line half-thickness = cell x 0.5 x c'. A circle of radius cell / sqrt 2 exactly covers its cell, so full coverage prints solid. The square root makes the dot area, not its width, proportional to coverage.
4. Add it to the current path. Circles use arc. Squares and lines are rotated rectangles (four corners rotated by the same angle). Dots below 0.4 percent coverage are skipped.
Batching (a measured fix). The first version added every dot to one path and filled once. In testing, 8,000 circles took about 9.8 seconds that way. Filling per dot took 31 ms, and batches of about 50 took 70 ms. The code now fills every 64 shapes. Batches are also safe because one ink is drawn in an opaque colour, so overlapping dots of the same ink do not change the result.
Single ink. Paper colour fills the canvas, then one layer in the ink colour. The Look presets set both. Dark looks switch coverage to follow brightness, so light dots appear on a dark paper.
CMYK. RGB converts to four planes: K = 1 - max(R, G, B) and each of C, M, Y = (1 - channel - K) / (1 - K), or 0 when K is 1. Each plane is drawn at a classic screen angle (cyan 15, magenta 75, yellow 0, black 45, all shifted by the angle slider minus 45) so the four screens interleave into a rosette instead of clashing. Inks are #00aeef, #ec008c, #fff200 and #1a1a1a on #fbfaf6 paper. Each ink is drawn on its own transparent layer and then multiplied onto the paper once. An earlier version multiplied every batch separately, which darkened the places where dots of the same ink overlap. CMYK ignores the Look setting. The conversion is a naive formula with no colour profile.
5.5 app.js
State. One small object: the source canvas, the file name, the current mode, the last ASCII text, and a queued flag.
Loading. A file, dropped file or pasted image becomes an object URL, loads into an Image, and is drawn once onto a source canvas whose longest side is capped at 2400 px (to bound memory). The sample is drawn with canvas gradients: a shaded sphere, a ring, and a black-to-white ramp that makes dither quality easy to judge.
prepare(w, h). Draws the source to a w x h canvas with high-quality smoothing, reads the pixels, converts to float RGB, applies auto levels if enabled, then applies the tone controls. Every mode starts from this.
Renderers. renderDither works at the chosen resolution and enlarges with smoothing off (hard pixels). renderAscii works at columns x rows. renderHalftone works at a detail width and draws vectors under a scale transform, so exports are sharp at any size. Each returns a short description for the info line.
Scheduling. Controls call schedule(), which sets a flag and asks the browser for one animation frame. If many slider events arrive in one frame, only one render runs. The render time is shown in the status line.
Scale limit. The export scale is reduced when needed so the longest canvas side stays at or under 8192 px.
Controls. Anything marked with the class ctl re-renders on change (on input for sliders and text). Slider read-outs are updated from each slider. The mode buttons show or hide the matching panels. Look menus set a foreground and background pair; editing either colour switches the menu to Custom. Dependent rows (custom ramp, custom palette, levels, mono-ink rows) show and hide as options change.
Fonts. Inter (text) and JetBrains Mono (data and ASCII) load from Google Fonts. After the mono font loads the page re-renders once, so ASCII measurements use the real font.
Export.
• PNG: render into a fresh canvas at the chosen scale, call toBlob, then save.
• Text: a Blob of the stored ASCII string.
• Copy: the clipboard API, with a hidden textarea and the old copy command as a fallback.
• save(): inside the Claude artifact viewer, normal download links are blocked, so the function first asks for the downloads capability and calls its save method. Anywhere else it creates a temporary link and clicks it.
5.6 Page and styles
Two columns: a sticky preview on the left and a 360 px control panel on the right. Under 800 px wide they stack and the preview stays pinned at the top. Colours are CSS variables with a dark variant under prefers-color-scheme. Focus rings are visible, buttons are real buttons, sliders have labels and linked output elements, the status line is a polite live region, and the preview area can be focused.
5.7 tools/build.js
Reads index.html, replaces the stylesheet link with a style element and each script tag with an inline script (failing if any script contains a closing script tag), and writes dist/ditherlab.html. This single file is what was published as the live demo.
6. Control reference
Mode
Control
Range
Default
All
Brightness, Contrast
-100 to 100
0
All
Gamma
0.3 to 3, step 0.05
1
All
Auto levels, Invert
on or off
off
ASCII
Columns
20 to 300
110
ASCII
Characters
standard, detailed, blocks, minimal, binary, custom
standard
ASCII
Look
5 presets or custom
ink on paper
ASCII
Use image colours
on or off
off
Dither
Resolution (px wide)
64 to 1200, step 8
480
Dither
Algorithm
10
Floyd-Steinberg
Dither
Colour
palette or full colour
palette
Dither
Palette
8 presets or custom
black and white
Dither
Levels (full colour)
2 to 8
2
Dither
Serpentine scan
on or off
on
Halftone
Detail (px wide)
200 to 1400, step 10
800
Halftone
Shape
circles, squares, lines
circles
Halftone
Cell size
3 to 40
10
Halftone
Angle
0 to 90
45
Halftone
Dot gain
-50 to 50
0
Halftone
Ink
single or CMYK
single
Export
Scale
1, 2, 3, 4, 6, 8
2
7. Performance
Measured on the 800 x 1000 sample in the simulated browser (software canvas, so a real browser should be as fast or faster):
Operation
Time
Dither, 480 x 600
about 100 to 220 ms
ASCII, 110 columns
about 10 to 55 ms (about 140 ms with image colours)
Halftone, single ink, 8,000 dots
about 250 ms
Halftone, CMYK
about 680 ms
Techniques used: one render per animation frame, typed arrays everywhere, the summed-area table for O(1) averages, compiled kernels, batched path fills, and a working-resolution cap so the cost is set by the Resolution slider and not by the photo size. Larger photos are first reduced to 2400 px.
If it feels slow: lower Resolution or Detail, raise the halftone cell size, or avoid the Jarvis kernel. The natural next step is a Web Worker for the pixel work.
8. Testing
Unit tests (node --test, 17 passing) cover: luma weights and alpha blending; each tone adjustment; auto levels stretching a narrow range; the summed-area table against brute force over several rectangles including out-of-bounds ones; hex helpers; ASCII grid size and ramp direction and the custom-ramp fallback; Bayer matrices being permutations; every dither algorithm producing only valid levels and preserving average brightness within 6 on a gradient; four levels using all four indices; threshold being plain rounding; noise being repeatable; tone output containing only palette colours; full-colour output containing only the allowed levels; CMYK conversion of white, black and red; dot size growing with coverage and a full circle covering its cell; and the rotated grid visiting roughly the expected number of cells at four angles.
Smoke test. The whole page was loaded in jsdom with a real canvas. It loaded the sample, rendered nine variants across all three modes, exported a 2x PNG (1600 x 2000 for the sample), and confirmed no script errors.
Not covered: real browsers, touch devices, large photographs, the clipboard and drag-and-drop paths (they are simple but unexercised), visual regression, and screen readers.
9. Limitations and known issues
• ASCII alignment assumes a true monospace font. In the test environment the generic monospace name mapped to a proportional font, which made the output ragged until a real monospace font was registered. Browsers normally do not do this.
• Full-colour dither treats channels independently, so hues can shift. CMYK halftone uses a simple formula without a colour profile.
• Exports are limited to 8192 px on the longest side, and photos are reduced to 2400 px on load.
• The Look setting does not affect CMYK. Custom ASCII ramps must be ordered densest to sparsest by the user.
• Settings are not saved between visits.
• Fonts need a connection to look exactly as designed.
• Animated images use their first frame.
10. Extending the project
• Add a dither kernel: add an entry to KERNELS in dither.js with its taps and divisor. It appears in the menu automatically because the menu is built from the list.
• Add a palette or look: add an object to PALETTES or LOOKS in core.js (dark to light for palettes).
• Add an ASCII ramp: add a string to RAMPS in ascii.js and an option to the select in index.html.
• Add a halftone shape: add a case to shapeSize and to the drawing branch in drawLayer (halftone.js), then an option in index.html.
• Add a mode: write a renderX(canvas, scale) function in app.js, add it to renderTo, add a chip and a section with a data-mode attribute in index.html.
• Remember settings: gather the control ids into one object and store it with localStorage inside try and catch; restore on load.
• Web Worker: move prepare and the quantisers into a worker and post typed arrays back (transfer the buffers). Because those functions have no DOM dependency, the move is mostly wiring.
• Video or webcam: draw each frame to the working canvas and run the same pipeline per frame. Prefer ordered dithering and low resolution for speed.
• SVG export for halftone: the dot positions and sizes are already computed in drawLayer. Collect them into an SVG string instead of drawing to a canvas.
• Move to Vite and TypeScript: switch the scripts to ES modules and keep the file split. The logic files need only their wrapper removed.
11. Build, run and deploy
• Run: open index.html, or serve the folder (for example python3 -m http.server 8000).
• Test: node --test (Node 18 or newer).
• Single file: node tools/build.js writes dist/ditherlab.html.
• GitHub Pages: push the folder, then Settings, Pages, branch main, folder root. Paths are relative, so a project subfolder works.
12. How it was built, and what was learned
The order of work was: logic first, then the page, then checking.
1. Logic modules with tests. The four DOM-free files and the 17 tests were written and run before any page existed. This caught the shape of the data early (float RGB, level indices) and meant the algorithms could be trusted when the page was added.
2. Page and wiring. The controls, the preview and the renderers were added on top, reusing the loopline look.
3. Real rendering check. Instead of relying on the unit tests alone, the page was run end to end in a simulated browser and every mode was rendered to images and looked at. That found four problems that the unit tests could not:
    ◦ Halftone was very slow (about 10 seconds for circles) because of one giant path. Fixed by filling in batches of 64: about 250 ms.
    ◦ CMYK overlap artefacts. Multiplying each batch darkened overlaps of the same ink. Fixed by drawing each ink on its own layer and multiplying it once.
    ◦ Block characters left seams. Fixed by drawing the four block glyphs as rectangles.
    ◦ ASCII looked broken in the test environment because the generic monospace font there was proportional. This was an environment issue, confirmed by measuring glyph widths, and not a code bug, but it is documented in the limitations because the layout does depend on a true monospace font.
4. Packaging. README, licence, package file, a single-file build, and a published demo.
The main lesson: for drawing code, measure and look at real output. The unit tests proved the maths was correct, and only the rendered images and timings showed the usability problems.
