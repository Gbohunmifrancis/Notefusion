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
 *   out/parts/*.png        pieces `graphics.py` composites into the feature
 *                          graphic. Not uploads either.
 *
 * The frame scales the live page in the browser instead of downscaling a finished
 * PNG, so every glyph is re-rasterised at the size it ends up: no resampling mush.
 */

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { launch } from "./lib/browser.mjs";
import { inspect, solfaProblems } from "./lib/checks.mjs";
import { home, library, DEVICE_W, DEVICE_H } from "./lib/screens.mjs";
import { record } from "./lib/record.mjs";
import { result, STAFF_W } from "./lib/result.mjs";
import { engrave } from "./lib/score.mjs";
import { TAKE, NOTES } from "./lib/sample.mjs";

// ─── The set ─────────────────────────────────────────────────────────────────

/**
 * Order is the order they appear in the listing, so the first two carry the
 * pitch: what the app makes, then how little it asks of you to make it.
 *
 * Captions are one line each on purpose. A second line puts the rule at a
 * different height on every tile, which reads as sloppy when they are swiped
 * side by side — and the render check below fails the build if one wraps.
 *
 * A function of `staff` rather than a constant, because the staff tile's notation
 * is engraved by the app's own OSMD asset and that needs the browser — so the set
 * cannot exist until after `chromium.launch`.
 */
const screenSet = (staff) => [
  { name: "home", caption: "Hear it. See it. Notate it.", html: home(), scroll: true },
  {
    name: "record",
    caption: "Tap once, then just sing",
    html: record(),
    scroll: false, // RecordScreen has no ScrollView: it must fit, or it clips
  },
  {
    name: "solfa",
    caption: "Tonic Solfa, ready to sing",
    html: result({ view: "solfa" }),
    scroll: true,
  },
  {
    name: "staff",
    caption: "The same take, engraved",
    html: result({ view: "staff", staff }),
    scroll: true,
  },
  {
    name: "rekey",
    caption: "Change key. Notes stay put.",
    html: result({ view: "solfa", keyPicker: true, keyText: TAKE.rekey }),
    scroll: true,
  },
  { name: "library", caption: "Every take saved, and yours", html: library(), scroll: true },
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
  /* Caption and rule flow, so a two-line caption would push the rule down
     instead of striking through it. They are all one line — this is the belt to
     the check's braces. */
  .head {
    position: absolute; left: 20px; right: 20px; top: 26px;
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
const OUT_PARTS = join(STORE, "out", "parts");

for (const d of [BUILD, OUT_DEVICE, OUT_SHOTS, OUT_PARTS]) mkdirSync(d, { recursive: true });

const browser = await launch();

const problems = [];

/**
 * The staff tile's notation, from `assets/engraver/index.html` — the same asset
 * `ScoreView` loads in its WebView. `heads` is the engraver's own count of
 * noteheads it drew; the sample take needs no ties and no rests, so anything other
 * than one head per note means the XML or the layout drifted.
 */
const { svg: staff, heads } = await engrave(browser, {
  notes: NOTES,
  timeSignature: TAKE.timeSignature,
  keyText: TAKE.key,
  width: STAFF_W,
});
if (heads !== NOTES.length) {
  problems.push(`staff: engraver drew ${heads} heads for ${NOTES.length} notes`);
}

const SCREENS = screenSet(staff);

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

  const check = await inspect(page);

  console.log(
    `  ${n}-${screen.name}  content ends at ${check.contentBottom}dp of ${check.view}dp` +
      (check.below.length ? `  (${check.below.length} below the fold)` : ""),
  );

  // A screen with no ScrollView that doesn't fit is broken on a device too.
  if (!screen.scroll && check.below.length) {
    problems.push(`${screen.name}: no ScrollView, yet clipped — ${check.below.slice(0, 4).join(", ")}`);
  }
  problems.push(...solfaProblems(screen.name, check.lines));

  await page.screenshot({ path: join(OUT_DEVICE, `${n}-${screen.name}.png`) });

  // The feature graphic needs the solfa card on its own, big enough to read.
  // Capturing the element keeps it in step with the layout; a hardcoded crop
  // would silently slide the moment anything above it changes height.
  if (screen.name === "solfa") {
    await page.locator(".solfaCardWrap").screenshot({ path: join(OUT_PARTS, "solfa-card.png") });
  }

  await page.close();

  // ── Framed 9:16 upload ──
  const tile = await browser.newPage({
    viewport: { width: TILE_W, height: TILE_H },
    deviceScaleFactor: 3,
  });
  await tile.goto(pathToFileURL(framePath).href, { waitUntil: "load" });
  await tile.evaluate(() => document.fonts.ready.then(() => true));
  await tile.waitForTimeout(600); // the iframe's own webfonts

  const cap = await tile.evaluate(() => {
    const el = document.querySelector(".cap");
    return { h: el.offsetHeight, lh: parseFloat(getComputedStyle(el).lineHeight) };
  });
  if (cap.h > cap.lh + 1) {
    problems.push(`${screen.name}: caption wraps to ${Math.round(cap.h / cap.lh)} lines — shorten it`);
  }

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
