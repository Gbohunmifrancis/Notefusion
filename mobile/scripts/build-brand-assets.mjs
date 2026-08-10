/**
 * Derives the shipped brand assets from the design renders in `assets/`.
 *
 * The mark is a stylised "5" whose bowl is an oversized open ring. Hand-authoring
 * that as SVG paths never landed on the real artwork, so it is lifted straight
 * out of `Notefusion-splash-screen.png` instead: the mark is pure white there on
 * a known blue field, which makes it recoverable as a transparent, tintable
 * silhouette. One source of truth, and no glyph drawn twice by eye.
 *
 * Outputs (all 8-bit RGBA, non-interlaced):
 *   brand/mark.png      tight transparent mark, white — tinted per surface
 *   icon.png            1024² launcher icon, mark on the brand-blue field
 *   adaptive-icon.png   1024² Android foreground, transparent, inset for the mask
 *   splash-icon.png     1024² transparent mark for the native splash
 *
 * Re-run with `npm run build:brand` after changing the source render.
 *
 * Pure Node — no sharp, no ImageMagick, neither of which is installed here.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), "..", "assets");

// ─── PNG codec ──────────────────────────────────────────────────────────────
// Only what these files actually are: bit depth 8, colour type 2 or 6, no
// interlacing. Anything else throws rather than decoding to quiet nonsense.

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

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Reverses one scanline filter in place. `bpp` is bytes per pixel. */
function unfilter(type, row, prev, bpp) {
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let i = 0; i < row.length; i++) {
    const a = i >= bpp ? row[i - bpp] : 0;
    const b = prev ? prev[i] : 0;
    const c = i >= bpp && prev ? prev[i - bpp] : 0;
    if (type === 1) row[i] = (row[i] + a) & 0xff;
    else if (type === 2) row[i] = (row[i] + b) & 0xff;
    else if (type === 3) row[i] = (row[i] + ((a + b) >> 1)) & 0xff;
    else if (type === 4) row[i] = (row[i] + paeth(a, b, c)) & 0xff;
    else if (type !== 0) throw new Error(`bad filter ${type}`);
  }
}

/** → { width, height, data } where data is RGBA, 4 bytes per pixel. */
function decodePng(buf) {
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const [depth, colour, , , interlace] = [data[8], data[9], data[10], data[11], data[12]];
      if (depth !== 8 || interlace !== 0 || (colour !== 2 && colour !== 6)) {
        throw new Error(`unsupported PNG: depth=${depth} colour=${colour} interlace=${interlace}`);
      }
      channels = colour === 6 ? 4 : 3;
    } else if (type === "IDAT") idat.push(Buffer.from(data));
    else if (type === "IEND") break;
    pos += 12 + len;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4, 255);
  let prev = null;

  for (let y = 0; y < height; y++) {
    const at = y * (stride + 1);
    const row = raw.subarray(at + 1, at + 1 + stride);
    unfilter(raw[at], row, prev, channels);
    for (let x = 0; x < width; x++) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      out[d] = row[s];
      out[d + 1] = row[s + 1];
      out[d + 2] = row[s + 2];
      out[d + 3] = channels === 4 ? row[s + 3] : 255;
    }
    prev = row;
  }
  return { width, height, data: out };
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none — deflate handles these fine
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
// ─── Sampling helpers ───────────────────────────────────────────────────────

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Area-averaged resample of a sub-rect of `src` into a dw×dh image.
 *
 * Alpha is premultiplied before averaging, so fully transparent pixels can't
 * bleed their meaningless colour into the edges of the mark.
 */
function resample(src, sx, sy, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const y0 = sy + (y * sh) / dh;
    const y1 = sy + ((y + 1) * sh) / dh;
    const yA = Math.floor(y0);
    const yB = Math.max(Math.ceil(y1), yA + 1);
    for (let x = 0; x < dw; x++) {
      const x0 = sx + (x * sw) / dw;
      const x1 = sx + ((x + 1) * sw) / dw;
      const xA = Math.floor(x0);
      const xB = Math.max(Math.ceil(x1), xA + 1);

      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = yA; yy < yB; yy++) {
        if (yy < 0 || yy >= src.height) continue;
        for (let xx = xA; xx < xB; xx++) {
          if (xx < 0 || xx >= src.width) continue;
          const i = (yy * src.width + xx) * 4;
          const al = src.data[i + 3] / 255;
          r += src.data[i] * al;
          g += src.data[i + 1] * al;
          b += src.data[i + 2] * al;
          a += al;
          n++;
        }
      }
      const d = (y * dw + x) * 4;
      if (n === 0 || a === 0) continue; // leaves 0,0,0,0
      out[d] = Math.round(r / a);
      out[d + 1] = Math.round(g / a);
      out[d + 2] = Math.round(b / a);
      out[d + 3] = Math.round((a / n) * 255);
    }
  }
  return { width: dw, height: dh, data: out };
}

/** Draws `src` into `dst` at (dx, dy), source-over. */
function compose(dst, src, dx, dy) {
  for (let y = 0; y < src.height; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dst.width) continue;
      const s = (y * src.width + x) * 4;
      const d = (ty * dst.width + tx) * 4;
      const sa = src.data[s + 3] / 255;
      if (sa === 0) continue;
      const da = dst.data[d + 3] / 255;
      const oa = sa + da * (1 - sa);
      for (let k = 0; k < 3; k++) {
        dst.data[d + k] = Math.round(
          (src.data[s + k] * sa + dst.data[d + k] * da * (1 - sa)) / oa,
        );
      }
      dst.data[d + 3] = Math.round(oa * 255);
    }
  }
}

/** A dw×dh image filled with one opaque colour. */
function solid(dw, dh, [r, g, b]) {
  const data = Buffer.alloc(dw * dh * 4);
  for (let i = 0; i < dw * dh; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return { width: dw, height: dh, data };
}

/**
 * Labels 8-connected runs of `mask` (a Float32Array of coverage) above `cut`.
 * Returns one entry per blob with its area and bounding box, largest first.
 */
function components(mask, width, height, cut) {
  const seen = new Uint8Array(width * height);
  const blobs = [];
  const stack = [];
  for (let start = 0; start < mask.length; start++) {
    if (seen[start] || mask[start] <= cut) continue;
    let area = 0;
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop();
      const px = p % width;
      const py = (p - px) / width;
      area++;
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          if (seen[q] || mask[q] <= cut) continue;
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    blobs.push({ area, x0, y0, x1, y1 });
  }
  return blobs.sort((a, b) => b.area - a.area);
}

// ─── Step 1: lift the mark out of the splash render ─────────────────────────

/**
 * The splash paints a pure-white mark over a blue vertical gradient. For a
 * white foreground, observed = a·255 + (1-a)·bg, so coverage falls straight out
 * of the RED channel — the one where white and the brand blue are furthest
 * apart (≈47 vs 255; the blue channel's ~10-point spread is all noise).
 *
 * The background is sampled per row from the left margin, which tracks the
 * gradient without hard-coding it. The mark's drop shadow reads darker than the
 * background, so it lands below zero and clamps away.
 */
function extractMark() {
  const img = decodePng(readFileSync(resolve(ASSETS, "Notefusion-splash-screen.png")));
  const { width, height } = img;
  const cover = new Float32Array(width * height);

  // Only the top of the canvas: below this sit the wordmark, the tagline and
  // the translucent staff ribbon, none of which belong to the mark.
  const limit = Math.floor(height * 0.55);

  for (let y = 0; y < limit; y++) {
    const margin = [];
    for (let x = 4; x < 26; x++) margin.push(img.data[(y * width + x) * 4]);
    const bg = median(margin);
    const span = 255 - bg;
    if (span < 40) continue; // row is already near-white; nothing to key
    for (let x = 0; x < width; x++) {
      cover[y * width + x] = clamp01((img.data[(y * width + x) * 4] - bg) / span);
    }
  }

  // The glyph is one connected outline — the open ring plus the stem that rises
  // out of its gap. Everything that belongs to the logo (the dot, the three
  // bars) sits inside that outline's box; the flanking waveform bars sit
  // outside it, and BrandMark still draws those itself.
  const blobs = components(cover, width, limit, 0.5);
  const glyph = blobs[0];
  if (!glyph) throw new Error("no mark found in the splash render");

  const w = glyph.x1 - glyph.x0 + 1;
  const h = glyph.y1 - glyph.y0 + 1;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = cover[(glyph.y0 + y) * width + (glyph.x0 + x)];
      const d = (y * w + x) * 4;
      out[d] = out[d + 1] = out[d + 2] = 255; // white; tinted at the call site
      out[d + 3] = Math.round(a * 255);
    }
  }

  console.log(
    `  mark      ${w}×${h} at (${glyph.x0},${glyph.y0})  ` +
      `blob=${glyph.area}px  next-largest=${blobs[1]?.area ?? 0}px`,
  );
  return { width: w, height: h, data: out };
}

// ─── Build ──────────────────────────────────────────────────────────────────
//
// The launcher icon is composed here rather than cropped out of
// `Notefusion-logo.png`. That render puts its artwork on a dark backdrop behind
// a wide blue glow, and the glow — not the artwork — is what any brightness cut
// actually finds, so a crop cannot be trusted. Composing the extracted mark on
// the flat brand blue gives the same result the design sheet specifies, from the
// one source already verified above.

const BRAND_BLUE = [0x25, 0x63, 0xeb]; // #2563EB — the design sheet's primary
const SIZE = 1024;

console.log("building brand assets…");
mkdirSync(resolve(ASSETS, "brand"), { recursive: true });

const mark = extractMark();
writeFileSync(
  resolve(ASSETS, "brand", "mark.png"),
  encodePng(mark.width, mark.height, mark.data),
);

/** Centres the white mark on a SIZE² canvas, fitted to `fraction` of its width. */
function markCanvas(fraction, background) {
  const boxW = Math.round(SIZE * fraction);
  const scale = Math.min(boxW / mark.width, boxW / mark.height);
  const w = Math.round(mark.width * scale);
  const h = Math.round(mark.height * scale);
  const canvas = background
    ? solid(SIZE, SIZE, background)
    : { width: SIZE, height: SIZE, data: Buffer.alloc(SIZE * SIZE * 4) };
  compose(
    canvas,
    resample(mark, 0, 0, mark.width, mark.height, w, h),
    Math.round((SIZE - w) / 2),
    Math.round((SIZE - h) / 2),
  );
  return canvas;
}

// Launcher icon: the mark on the brand-blue field. iOS masks the corners itself,
// so this ships square and full-bleed.
writeFileSync(
  resolve(ASSETS, "icon.png"),
  encodePng(SIZE, SIZE, markCanvas(0.66, BRAND_BLUE).data),
);

// Android adaptive foreground. The launcher masks this to a circle/squircle and
// may parallax it, so the art has to stay inside the middle ~66%.
writeFileSync(
  resolve(ASSETS, "adaptive-icon.png"),
  encodePng(SIZE, SIZE, markCanvas(0.6, null).data),
);

// Native splash art, shown over the blue splash background in app.json.
writeFileSync(
  resolve(ASSETS, "splash-icon.png"),
  encodePng(SIZE, SIZE, markCanvas(0.72, null).data),
);

console.log("wrote brand/mark.png, icon.png, adaptive-icon.png, splash-icon.png");
