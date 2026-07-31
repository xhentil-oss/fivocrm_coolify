#!/usr/bin/env node
/**
 * Generates the iOS AppIcon + SplashScreen images from the FivoCRM brand mark.
 *
 * The Capacitor template ships the generic Capacitor logo, and there is no
 * high-res logo file in the repo — the Android icon is built from the vector
 * path in `android/app/src/main/res/drawable/ic_stat_notify.xml`. That same path
 * is inlined here, so the iOS icon is rasterised at full 1024x1024 from the
 * vector instead of upscaling the 192px Android PNG.
 *
 * Pure Node (zlib only) — no native image deps, so it runs on Windows/macOS/CI.
 *
 * Usage: node scripts/ios-brand-assets.cjs [--force]
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Brand mark: the "X" from ic_stat_notify.xml, in its 24x24 viewport.
const MARK_POLYGON = [
  [6.8, 4.2], [12, 9.4], [17.2, 4.2], [19.8, 6.8],
  [14.6, 12], [19.8, 17.2], [17.2, 19.8], [12, 14.6],
  [6.8, 19.8], [4.2, 17.2], [9.4, 12], [4.2, 6.8],
];
// The path only occupies 4.2..19.8 of its viewport, so `markFraction` is applied
// to the mark's own bounding box — it means "the X fills N% of the canvas".
const MARK_MIN = 4.2;
const MARK_SPAN = 19.8 - 4.2;

// Same palette as Android (ic_launcher_background = #FFFFFF, mark = #0EA5E9)
// and the Capacitor SplashScreen backgroundColor (#09090B).
const WHITE = [0xff, 0xff, 0xff];
const CYAN = [0x0e, 0xa5, 0xe9];
const DARK = [0x09, 0x09, 0x0b];

// ── PNG encoding (truecolour, 8-bit, no alpha — iOS icons must be opaque) ─────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (None)
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Rasterisation ────────────────────────────────────────────────────────────
/**
 * Scanline-fills the mark polygon into a coverage buffer with `SUB` sub-rows per
 * pixel row and analytic horizontal coverage, i.e. antialiased edges without
 * brute-forcing every subpixel (a 2732x2732 splash would be too slow that way).
 */
const SUB = 4;

function renderSquare(size, bg, fg, markFraction) {
  const markSize = size * markFraction;
  const offset = (size - markSize) / 2;
  const scale = markSize / MARK_SPAN;
  const poly = MARK_POLYGON.map(([x, y]) => [
    offset + (x - MARK_MIN) * scale,
    offset + (y - MARK_MIN) * scale,
  ]);

  const cov = new Float32Array(size * size);
  const xs = [];

  for (let sy = 0; sy < size * SUB; sy++) {
    const y = (sy + 0.5) / SUB;
    xs.length = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    const row = Math.floor(sy / SUB) * size;
    for (let i = 0; i + 1 < xs.length; i += 2) {
      addSpan(cov, row, size, xs[i], xs[i + 1], 1 / SUB);
    }
  }

  const rgb = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    const a = cov[i] > 1 ? 1 : cov[i];
    rgb[i * 3] = Math.round(bg[0] + (fg[0] - bg[0]) * a);
    rgb[i * 3 + 1] = Math.round(bg[1] + (fg[1] - bg[1]) * a);
    rgb[i * 3 + 2] = Math.round(bg[2] + (fg[2] - bg[2]) * a);
  }
  return encodePng(size, size, rgb);
}

function addSpan(cov, rowOffset, size, xStart, xEnd, weight) {
  if (xEnd <= 0 || xStart >= size) return;
  const x0 = Math.max(xStart, 0);
  const x1 = Math.min(xEnd, size);
  const first = Math.floor(x0);
  const last = Math.min(Math.ceil(x1) - 1, size - 1);
  for (let px = first; px <= last; px++) {
    const covered = Math.min(px + 1, x1) - Math.max(px, x0);
    if (covered > 0) cov[rowOffset + px] += covered * weight;
  }
}

// ── Output ───────────────────────────────────────────────────────────────────
function generate(iosDir, log = console.log) {
  const assets = path.join(iosDir, 'App', 'App', 'Assets.xcassets');
  if (!fs.existsSync(assets)) {
    throw new Error(`Assets.xcassets not found at ${assets} — run "npx cap add ios" first.`);
  }

  // App icon: white ground + cyan mark, matching the Android launcher icon.
  // 1024x1024, opaque, square — iOS applies the rounded mask itself.
  const icon = renderSquare(1024, WHITE, CYAN, 0.60);
  const iconPath = path.join(assets, 'AppIcon.appiconset', 'AppIcon-512@2x.png');
  fs.writeFileSync(iconPath, icon);
  log(`  icon    ${path.relative(iosDir, iconPath)} (1024x1024)`);

  // Splash: dark ground (#09090B, same as SplashScreen.backgroundColor) so there
  // is no white flash before the WebView paints. One image for all three scales —
  // the imageset is a single centred artwork, not a per-density bitmap.
  const splash = renderSquare(2732, DARK, CYAN, 0.20);
  for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
    fs.writeFileSync(path.join(assets, 'Splash.imageset', name), splash);
  }
  log(`  splash  Splash.imageset/*.png (2732x2732 x3)`);
}

module.exports = { generate };

if (require.main === module) {
  const iosDir = path.resolve(__dirname, '..', 'ios');
  console.log('Generating iOS brand assets…');
  generate(iosDir);
  console.log('Done.');
}
