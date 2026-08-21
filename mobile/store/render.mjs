/**
 * Renders the store screenshots.
 *
 *   node mobile/store/render.mjs
 *
 * Two sets come out of one pass:
 *
 *   out/device/*.png       1236×2745 — the bare screen on a Pixel-class window
 *                          (412×915dp at 3×). SOURCE ONLY. Google Play rejects an
 *                          image whose long edge is more than twice its short
 *                          edge, and 2745 > 2×1236, so these can't be uploaded.
 *   out/screenshots/*.png  1080×1920 — the same screens framed in a device
 *                          mock-up with a caption, at the 9:16 Play asks for.
 *                          THESE are the uploads.
 *
 * The frame scales the live page in the browser instead of downscaling a finished
 * PNG, so every glyph is re-rasterised at the size it ends up: no resampling mush.
 */

import { mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { homedir } from "node:os";

import { home, library, DEVICE_W, DEVICE_H } from "./lib/screens.mjs";
import { record } from "./lib/record.mjs";
import { result } from "./lib/result.mjs";
import { TAKE } from "./lib/sample.mjs";

// ─── Where the browser comes from ────────────────────────────────────────────

/**
 * patchright ships inside the CodeGPT VS Code extension, which is the only copy
 * on this machine. Resolved by glob so a version bump doesn't break the script.
 */
function loadChromium() {
  const extRoot = join(homedir(), ".vscode", "extensions");
  const candidates = readdirSync(extRoot)
    .filter((d) => d.startsWith("danielsanmedium.dscodegpt-"))
    .sort();
  for (const dir of candidates.reverse()) {
    try {
      const req = createRequire(join(extRoot, dir, "standalone") + "/");
      return req("patchright").chromium;
    } catch {
      /* try the next one */
    }
  }
  throw new Error(
    `no patchright found. Looked for danielsanmedium.dscodegpt-*/standalone in ${extRoot}`,
  );
}

// ─── The set ─────────────────────────────────────────────────────────────────

/**
 * Order is the order they appear in the listing, so the first two carry the
 * pitch: what the app makes, then how little it asks of you to make it.
 */
const SCREENS = [
  { name: "home", caption: "Hear it. See it. Notate it.", html: home(), scroll: true },
  {
    name: "record",
    caption: "Sing, hum, or play — the mic does the rest",
    html: record(),
    scroll: false, // RecordScreen has no ScrollView: it must fit, or it clips
  },
  {
    name: "solfa",
    caption: "Movable-do Tonic Solfa, ready to sing",
    html: result({ view: "solfa" }),
    scroll: true,
  },
  {
    name: "staff",
    caption: "The same take, engraved on a stave",
    html: result({ view: "staff" }),
    scroll: true,
  },
  {
    name: "rekey",
    caption: "Change the key. The notes stay put.",
    html: result({ view: "solfa", keyPicker: true, keyText: TAKE.rekey }),
    scroll: true,
  },
  { name: "library", caption: "Every take saved, searchable, yours", html: library(), scroll: true },
];

// ─── Frame geometry ──────────────────────────────────────────────────────────

const TILE_W = 360;
const TILE_H = 640; // ×3 = 1080×1920, the 9:16 Play recommends
const BEZEL = 7;
const PHONE_TOP = 88;
const PHONE_INNER_H = 532;
const SCALE = PHONE_INNER_H / DEVICE_H;
const PHONE_INNER_W = DEVICE_W * SCALE;
const PHONE_X = (TILE_W - (PHONE_INNER_W + BEZEL * 2)) / 2;

const framePage = (screenUrl, caption) => `<!doctype html><html><head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${TILE_W}px; height: ${TILE_H}px; overflow: hidden; }
  body {
    background: linear-gradient(165deg, #EAF2FE 0%, #F8FAFF 46%, #E4EEFC 100%);
    font-family: Poppins, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  /* Brand wash behind the device, so the tile reads as part of the app. */
  .glow {
    position: absolute; left: 50%; top: 150px; width: 420px; height: 420px;
    margin-left: -210px; border-radius: 50%;
    background: radial-gradient(circle, rgba(37,99,235,0.16) 0%, rgba(37,99,235,0) 68%);
  }
  /* Caption and rule flow, so a two-line caption pushes the rule down instead
     of striking through it. */
  .head {
    position: absolute; left: 24px; right: 24px; top: 22px;
    display: flex; flex-direction: column; align-items: center; gap: 9px;
  }
  .cap {
    font-size: 19px; font-weight: 700; line-height: 26px; letter-spacing: -0.3px;
    color: #0F172A; text-align: center;
  }
  .rule { width: 36px; height: 3px; border-radius: 2px; background: #2563EB; opacity: 0.85; }
  .phone {
    position: absolute; left: ${PHONE_X}px; top: ${PHONE_TOP}px;
    padding: ${BEZEL}px; border-radius: 26px; background: #0F172A;
    box-shadow: 0 18px 40px rgba(29,78,216,0.22), 0 2px 6px rgba(15,23,42,0.14);
  }
  .glass { width: ${PHONE_INNER_W}px; height: ${PHONE_INNER_H}px; border-radius: 20px; overflow: hidden; }
  /* The screen is rendered live at ${DEVICE_W}×${DEVICE_H} and scaled here, so the
     text is re-rasterised at its final size rather than resampled from a big PNG. */
  iframe {
    width: ${DEVICE_W}px; height: ${DEVICE_H}px; border: 0; display: block;
    transform: scale(${SCALE}); transform-origin: top left;
  }
</style></head>
<body>
  <div class="glow"></div>
  <div class="head"><div class="cap">${caption}</div><div class="rule"></div></div>
  <div class="phone"><div class="glass"><iframe src="${screenUrl}" scrolling="no"></iframe></div></div>
</body></html>`;

// ─── Render ──────────────────────────────────────────────────────────────────

const STORE = import.meta.dirname;
const BUILD = join(STORE, ".build");
const OUT_DEVICE = join(STORE, "out", "device");
const OUT_SHOTS = join(STORE, "out", "screenshots");

for (const d of [BUILD, OUT_DEVICE, OUT_SHOTS]) mkdirSync(d, { recursive: true });

const chromium = loadChromium();
const browser = await chromium.launch({
  headless: true,
  channel: "chromium",
  // file:// pages load the Poppins TTFs and the framed page iframes another
  // file:// page; both need this.
  args: ["--no-sandbox", "--allow-file-access-from-files", "--font-render-hinting=none"],
});

const problems = [];

for (const [i, screen] of SCREENS.entries()) {
  const n = String(i + 1).padStart(2, "0");
  const screenPath = join(BUILD, `${n}-${screen.name}.html`);
  const framePath = join(BUILD, `${n}-${screen.name}.frame.html`);
  writeFileSync(screenPath, screen.html, "utf8");
  writeFileSync(framePath, framePage(pathToFileURL(screenPath).href, screen.caption), "utf8");

  // ── Bare device capture, and the layout check ──
  const page = await browser.newPage({
    viewport: { width: DEVICE_W, height: DEVICE_H },
    deviceScaleFactor: 3,
  });
  await page.goto(pathToFileURL(screenPath).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready.then(() => true));

  const check = await page.evaluate(() => {
    const lines = [...document.querySelectorAll(".solfaLine")].map((el) => ({
      h: el.offsetHeight,
      lh: parseFloat(getComputedStyle(el).lineHeight),
      w: el.scrollWidth,
      cw: el.clientWidth,
    }));
    // Leaf elements whose bottom edge falls past the viewport: on a screen with
    // no ScrollView that is a clip, on a scrolling one it is just the fold.
    const below = [...document.querySelectorAll(".safe *")]
      .filter((el) => !el.querySelector("*"))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.height > 0 && r.bottom > window.innerHeight + 0.5;
      })
      .map((el) => `${el.className || el.tagName}@${Math.round(el.getBoundingClientRect().bottom)}`);
    const contentBottom = Math.max(
      0,
      ...[...document.querySelectorAll(".content > *")].map((el) =>
        Math.round(el.getBoundingClientRect().bottom),
      ),
    );
    return { contentBottom, viewH: window.innerHeight, lines, below };
  });

  console.log(
    `  ${n}-${screen.name}  content ends at ${check.contentBottom}dp of ${check.viewH}dp` +
      (check.below.length ? `  (${check.below.length} below the fold)` : ""),
  );

  // A screen with no ScrollView that doesn't fit is broken on a device too.
  if (!screen.scroll && check.below.length) {
    problems.push(`${screen.name}: no ScrollView, yet clipped — ${check.below.slice(0, 4).join(", ")}`);
  }
  for (const [j, l] of check.lines.entries()) {
    if (l.h > l.lh + 1) problems.push(`${screen.name}: solfa line ${j + 1} wrapped (${l.h}px / ${l.lh}px)`);
    if (l.w > l.cw + 1) problems.push(`${screen.name}: solfa line ${j + 1} overflows (${l.w} > ${l.cw})`);
  }

  await page.screenshot({ path: join(OUT_DEVICE, `${n}-${screen.name}.png`) });
  await page.close();

  // ── Framed 9:16 upload ──
  const tile = await browser.newPage({
    viewport: { width: TILE_W, height: TILE_H },
    deviceScaleFactor: 3,
  });
  await tile.goto(pathToFileURL(framePath).href, { waitUntil: "load" });
  await tile.evaluate(() => document.fonts.ready.then(() => true));
  await tile.waitForTimeout(600); // the iframe's own webfonts
  await tile.screenshot({ path: join(OUT_SHOTS, `${n}-${screen.name}.png`) });
  await tile.close();
}

await browser.close();

// The pages are inputs to the capture, not deliverables — but keep them when
// something is wrong, so the markup can be opened and poked at.
if (problems.length === 0) rmSync(BUILD, { recursive: true, force: true });

console.log(
  problems.length
    ? `\nLAYOUT PROBLEMS (${problems.length}) — pages kept in .build/ :\n  ${problems.join("\n  ")}`
    : "\nLayout checks clean: nothing overflows, no solfa line wraps.",
);
