// The faces the 3D Practice art wears, all drawn by design/practice-art so the 3D pieces are always the art the 2D
// ones show:
//
//   emblem-<n>.png      each level emblem (n = 1..8), the face of the 3D coin (emblem.luau)
//   <art>.png           a sticker's colours (the flame, the freeze, the stars, the badges)
//   <art>-normal.png    its surface as if inflated from its outline: height from the silhouette's distance to its edge,
//                       blurred so it rounds, as a normal map (rgb = xyz * 0.5 + 0.5, z towards the viewer) for puffy.luau
//
//   node design/rive/faces.mjs     write them all into design/rive/practice/
//
// and Doh's two poses the reward moments use (design/rive/moments/moments.py):
//
//   node design/rive/faces.mjs moments     doh-wave.png and doh-cheer.png, 300px wide, into design/rive/moments/
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { emblem, LEVELS } from "../practice-art/emblems.mjs";
import { assets } from "../practice-art/build.mjs";

// Playwright as installed beside Chromium (CommonJS, resolved like require, global installs included).
const { chromium } = createRequire(import.meta.url)("playwright");

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "practice");
const EMBLEM_SIZE = 512;
const STICKER_SIZE = 256;

/** The stickers that become puffy 3D pieces: the rewards Practice shows. */
export const STICKERS = [
  "flame-active", "flame-at-risk", "flame-out", "freeze", "stars-1", "stars-2", "stars-3",
  ...assets().map(([n]) => n).filter((n) => n.startsWith("badge-")),
];

// Runs in the page: the sticker's normal map from its alpha. A distance-to-edge field (two-pass chamfer), softened by
// a blur and shaped by a square root so the edge rolls over like a pillow, then differenced into normals.
function normalMap({ size, bulge }) {
  const c = document.querySelector("canvas");
  const g = c.getContext("2d", { willReadFrequently: true });
  const a = g.getImageData(0, 0, size, size).data;
  const n = size * size, INF = 1e9, d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = a[i * 4 + 3] > 127 ? INF : 0;
  const D1 = 1, D2 = Math.SQRT2, at = (x, y) => (x < 0 || y < 0 || x >= size || y >= size ? 0 : d[y * size + x]);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x; if (!d[i]) continue;
    d[i] = Math.min(d[i], at(x - 1, y) + D1, at(x, y - 1) + D1, at(x - 1, y - 1) + D2, at(x + 1, y - 1) + D2);
  }
  for (let y = size - 1; y >= 0; y--) for (let x = size - 1; x >= 0; x--) {
    const i = y * size + x; if (!d[i]) continue;
    d[i] = Math.min(d[i], at(x + 1, y) + D1, at(x, y + 1) + D1, at(x + 1, y + 1) + D2, at(x - 1, y + 1) + D2);
  }
  // A pillow: the height rises over the first `bulge` pixels in from the edge, then levels off.
  const h = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = Math.min(1, d[i] / bulge); h[i] = Math.sqrt(t * (2 - t)) * bulge * 0.55; }
  const blur = (src, r) => {
    const tmp = new Float32Array(n), out = new Float32Array(n);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let s = 0, k = 0; for (let j = -r; j <= r; j++) { const xx = x + j; if (xx >= 0 && xx < size) { s += src[y * size + xx]; k++; } } tmp[y * size + x] = s / k;
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let s = 0, k = 0; for (let j = -r; j <= r; j++) { const yy = y + j; if (yy >= 0 && yy < size) { s += tmp[yy * size + x]; k++; } } out[y * size + x] = s / k;
    }
    return out;
  };
  const hb = blur(h, 2);
  const img = g.createImageData(size, size), o = img.data;
  const H = (x, y) => hb[Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    let nx = -(H(x + 1, y) - H(x - 1, y)) / 2, ny = (H(x, y + 1) - H(x, y - 1)) / 2, nz = 1;
    const L = Math.hypot(nx, ny, nz); nx /= L; ny /= L; nz /= L;
    o[i * 4] = Math.round((nx * 0.5 + 0.5) * 255);
    o[i * 4 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
    o[i * 4 + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    o[i * 4 + 3] = a[i * 4 + 3];
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: EMBLEM_SIZE, height: EMBLEM_SIZE }, deviceScaleFactor: 1 });
const fs = await import("node:fs");

async function shot(svg, size, file) {
  const sized = svg.replace("<svg ", `<svg width="${size}" height="${size}" `);
  await page.setContent(`<html><body style="margin:0;background:transparent">${sized}</body></html>`);
  await page.locator("svg").screenshot({ path: path.join(OUT, file), omitBackground: true });
}

const art = new Map(assets());

if (process.argv[2] === "moments") {
  const MOMENTS = path.join(path.dirname(OUT), "moments");
  for (const pose of ["doh-wave", "doh-cheer"]) {
    const svg = art.get(pose).replace("<svg ", '<svg width="300" height="300" ');
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
    await page.locator("svg").screenshot({ path: path.join(MOMENTS, `${pose}.png`), omitBackground: true });
  }
  await browser.close();
  console.log("Doh's two poses for the moments at 300px");
  process.exit(0);
}

for (let i = 0; i < LEVELS.length; i++) await shot(emblem(i), EMBLEM_SIZE, `emblem-${i + 1}.png`);
for (const name of STICKERS) {
  await shot(art.get(name), STICKER_SIZE, `${name}.png`);
  const png = fs.readFileSync(path.join(OUT, `${name}.png`)).toString("base64");
  await page.setContent(`<html><body style="margin:0"><canvas width="${STICKER_SIZE}" height="${STICKER_SIZE}"></canvas></body></html>`);
  await page.evaluate(async (src) => {
    const im = new Image(); im.src = src; await im.decode();
    document.querySelector("canvas").getContext("2d").drawImage(im, 0, 0);
  }, `data:image/png;base64,${png}`);
  const url = await page.evaluate(normalMap, { size: STICKER_SIZE, bulge: STICKER_SIZE * 0.09 });
  fs.writeFileSync(path.join(OUT, `${name}-normal.png`), Buffer.from(url.split(",")[1], "base64"));
}
await browser.close();
console.log(`${LEVELS.length} emblem faces at ${EMBLEM_SIZE}px, ${STICKERS.length} stickers with normal maps at ${STICKER_SIZE}px`);
