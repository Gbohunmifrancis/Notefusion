/**
 * One-off: derive web-admin/public/email/logo.png from the app's brand mark, recoloured
 * pure white so it reads on the email header's blue gradient. Run with
 * `node scripts/make-email-logo.mjs`.
 *
 * The branded email (src/NoteFusion.Infrastructure/Email/BrandedEmailTemplate.cs) shows the
 * mark at 46×61; this emits 2× for retina. When Email__AssetBaseUrl is unset the template
 * falls back to a live-text wordmark, so this asset only matters once assets are served.
 *
 * Pure Node, same constraint as make-favicon.mjs — no sharp, no ImageMagick. Handles only
 * what the source is: 8-bit, colour type 6 (RGBA), non-interlaced.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(ROOT, "..", "mobile", "assets", "brand", "mark.png");
const OUT_DIR = resolve(ROOT, "public", "email");
const OUT = resolve(OUT_DIR, "logo.png");
const OUT_W = 92;
const OUT_H = 122;

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

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
    else if (type !== 0) throw new Error(`unsupported filter ${type}`);
  }
}

/** → { width, height, rgba } */
function decodePng(buf) {
  let pos = 8;
  let width = 0;
  let height = 0;
  let colourType = 0;
  const idat = [];

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error("only 8-bit depth supported");
      colourType = data[9];
      if (data[12] !== 0) throw new Error("interlaced PNG not supported");
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }

  if (colourType !== 2 && colourType !== 6) throw new Error(`colour type ${colourType}`);
  const bpp = colourType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const rgba = Buffer.alloc(width * height * 4);
  let prev = null;

  for (let y = 0; y < height; y++) {
    const at = y * (stride + 1);
    const row = Buffer.from(raw.subarray(at + 1, at + 1 + stride));
    unfilter(raw[at], row, prev, bpp);
    for (let x = 0; x < width; x++) {
      const s = x * bpp;
      const d = (y * width + x) * 4;
      rgba[d] = row[s];
      rgba[d + 1] = row[s + 1];
      rgba[d + 2] = row[s + 2];
      rgba[d + 3] = bpp === 4 ? row[s + 3] : 255;
    }
    prev = row;
  }

  return { width, height, rgba };
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
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

/** Box-average downscale, alpha-weighted so the thin stroke survives at small sizes. */
function downscale(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  const fx = sw / dw;
  const fy = sh / dh;

  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor(y * fy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(x * fx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx));
      let a = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          a += src[(sy * sw + sx) * 4 + 3];
          n++;
        }
      }
      const d = (y * dw + x) * 4;
      // Colour is forced white; only the coverage (alpha) needs averaging.
      out[d] = 255;
      out[d + 1] = 255;
      out[d + 2] = 255;
      out[d + 3] = Math.round(a / n);
    }
  }
  return out;
}

const src = decodePng(readFileSync(SRC));
const small = downscale(src.rgba, src.width, src.height, OUT_W, OUT_H);
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, encodePng(OUT_W, OUT_H, small));
console.log(`email/logo.png ${OUT_W}×${OUT_H} (white) written from ${src.width}×${src.height} source`);
