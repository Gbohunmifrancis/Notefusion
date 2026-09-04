/**
 * Renders the walkthrough frames — the "how to use it" video.
 *
 *   node mobile/store/video.mjs
 *
 * Nineteen frames, in the order a first-time user meets them: install, sign up,
 * find the mic, record, read the result, re-key, save, find it again. `SHOTLIST.md`
 * beside this file carries which beat each frame belongs to, the tap that gets you
 * there, and the line to say over it.
 *
 * Two sets come out of one pass, the same arrangement `render.mjs` uses:
 *
 *   out/video/device/*.png  1236×2745 — the bare screen, 412×915dp at 3×. Pan and
 *                           zoom these in the editor; nothing is cropped for you.
 *   out/video/frame/*.png   1080×1920 — the same screen inside a phone on the
 *                           brand wash, already 9:16. Drop-in.
 *
 * No words are burnt into either set. A title baked into a PNG cannot be re-timed,
 * re-worded or translated, so the script lives in `SHOTLIST.md` as text.
 *
 * `focus` pans a screen taller than the window so the beat's subject is on screen,
 * and the pan is measured rather than guessed: the page is loaded once at rest, the
 * subject's box is read, and the pan is the number that puts its top under the
 * status bar. A subject that would fit but doesn't is reported; one that is simply
 * taller than a phone (the engraved stave) is noted, since there is no pan that
 * fixes it.
 *
 * Every frame is the app's own markup from `lib/`, so this cannot advertise a
 * screen the app doesn't have. The stave is engraved by the app's own OSMD asset.
 */

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { launch } from "./lib/browser.mjs";
import { inspect, solfaProblems } from "./lib/checks.mjs";
import { home, library, DEVICE_W, DEVICE_H, INSET_TOP } from "./lib/screens.mjs";
import { splash, onboarding, outro } from "./lib/intro.mjs";
import { register } from "./lib/auth.mjs";
import { drawer } from "./lib/drawer.mjs";
import { record } from "./lib/record.mjs";
import { result, STAFF_W } from "./lib/result.mjs";
import { engrave } from "./lib/score.mjs";
import { TAKE, NOTES } from "./lib/sample.mjs";

// ─── The beats ───────────────────────────────────────────────────────────────

/**
 * `frame(pan)` renders the screen; `pan` is only read by the screens that scroll,
 * and it is filled in by the measuring pass below, not by hand.
 *
 * `scroll: false` means the real screen has no ScrollView — so anything hanging
 * past the bottom of the window is a clip on a device too, and the check fails.
 * `focus` is the element the beat is about.
 */
const beats = (staff) => [
  { name: "splash", frame: () => splash(), scroll: false },
  { name: "onboarding-record", frame: () => onboarding({ slide: 0 }), scroll: false, lottie: true },
  {
    name: "onboarding-transcribe",
    frame: () => onboarding({ slide: 1 }),
    scroll: false,
    lottie: true,
  },
  { name: "onboarding-rekey", frame: () => onboarding({ slide: 2 }), scroll: false, lottie: true },
  { name: "register", frame: () => register(), scroll: true },
  { name: "home", frame: () => home(), scroll: true },
  { name: "drawer", frame: () => drawer(), scroll: true },
  { name: "record-ready", frame: () => record({ phase: "ready" }), scroll: false },
  { name: "record-live", frame: () => record({ phase: "recording" }), scroll: false },
  { name: "record-working", frame: () => record({ phase: "uploading" }), scroll: false },
  { name: "solfa", frame: () => result({ view: "solfa" }), scroll: true },
  {
    name: "play",
    frame: (pan) => result({ view: "solfa", scrollY: pan }),
    scroll: true,
    focus: ".playerCard",
  },
  {
    name: "staff",
    frame: (pan) => result({ view: "staff", staff, scrollY: pan }),
    scroll: true,
    focus: ".solfaCardWrap",
  },
  {
    name: "rekey",
    frame: () => result({ view: "solfa", keyPicker: true, keyText: TAKE.rekey }),
    scroll: true,
  },
  {
    name: "save",
    frame: (pan) => result({ view: "solfa", tail: "save", scrollY: pan }),
    scroll: true,
    focus: ".saveBlock",
  },
  {
    name: "saved",
    frame: (pan) => result({ view: "solfa", tail: "saved", scrollY: pan }),
    scroll: true,
    focus: ".saveBlock",
  },
  { name: "library", frame: () => library(), scroll: true },
  { name: "home-dark", frame: () => home({ mode: "dark" }), scroll: true },
  { name: "outro", frame: () => outro(), scroll: false },
];

/** Where a panned subject's top lands: just clear of the status bar. */
const TOP_GAP = INSET_TOP + 12;

// ─── 9:16 frame ──────────────────────────────────────────────────────────────

const TILE_W = 360;
const TILE_H = 640; // ×3 = 1080×1920
const BEZEL = 8;
const PHONE_INNER_H = 600;
const SCALE = PHONE_INNER_H / DEVICE_H;
const PHONE_INNER_W = DEVICE_W * SCALE;
const PHONE_X = (TILE_W - (PHONE_INNER_W + BEZEL * 2)) / 2;
const PHONE_Y = (TILE_H - (PHONE_INNER_H + BEZEL * 2)) / 2;

/**
 * The same wash as the store tiles, so the two sets read as one campaign — but no
 * caption and no rule, because the words belong in the edit.
 */
const framePage = (screenUrl) => `<!doctype html><html><head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${TILE_W}px; height: ${TILE_H}px; overflow: hidden; }
  body {
    background: linear-gradient(165deg, #EAF2FE 0%, #F8FAFF 46%, #E4EEFC 100%);
    -webkit-font-smoothing: antialiased;
  }
  .glow {
    position: absolute; left: 50%; top: 110px; width: 460px; height: 460px;
    margin-left: -230px; border-radius: 50%;
    background: radial-gradient(circle, rgba(37,99,235,0.16) 0%, rgba(37,99,235,0) 68%);
  }
  .phone {
    position: absolute; left: ${PHONE_X}px; top: ${PHONE_Y}px;
    padding: ${BEZEL}px; border-radius: 30px; background: #0F172A;
    box-shadow: 0 20px 44px rgba(29,78,216,0.24), 0 2px 6px rgba(15,23,42,0.14);
  }
  .glass { width: ${PHONE_INNER_W}px; height: ${PHONE_INNER_H}px; border-radius: 23px; overflow: hidden; }
  /* Scaled live rather than resampled from the big capture, so every glyph is
     re-rasterised at the size it ends up. */
  iframe {
    width: ${DEVICE_W}px; height: ${DEVICE_H}px; border: 0; display: block;
    transform: scale(${SCALE}); transform-origin: top left;
  }
</style></head>
<body>
  <div class="glow"></div>
  <div class="phone"><div class="glass"><iframe src="${screenUrl}" scrolling="no"></iframe></div></div>
</body></html>`;

// ─── Render ──────────────────────────────────────────────────────────────────

const STORE = import.meta.dirname;
/** Its own build dir, so `render.mjs`'s clean run cannot delete these pages. */
const BUILD = join(STORE, ".build-video");
const OUT_DEVICE = join(STORE, "out", "video", "device");
const OUT_FRAME = join(STORE, "out", "video", "frame");

for (const d of [BUILD, OUT_DEVICE, OUT_FRAME]) mkdirSync(d, { recursive: true });

const browser = await launch();
const problems = [];

const { svg: staff, heads } = await engrave(browser, {
  notes: NOTES,
  timeSignature: TAKE.timeSignature,
  keyText: TAKE.key,
  width: STAFF_W,
});
if (heads !== NOTES.length) {
  problems.push(`staff: engraver drew ${heads} heads for ${NOTES.length} notes`);
}

const BEATS = beats(staff);

/** Write the page, open it, and wait until everything that draws has drawn. */
async function open(html, stem, beat) {
  const path = join(BUILD, `${stem}.html`);
  writeFileSync(path, html, "utf8");
  const page = await browser.newPage({
    viewport: { width: DEVICE_W, height: DEVICE_H },
    deviceScaleFactor: 3,
  });
  await page.goto(pathToFileURL(path).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready.then(() => true));
  // waitForFunction, not evaluate: the flag is a page global, and evaluate runs in
  // patchright's isolated world where it does not exist. See lib/browser.mjs.
  if (beat.lottie) await page.waitForFunction(() => window.__lottieReady === true);
  return page;
}

for (const [i, beat] of BEATS.entries()) {
  const stem = `${String(i + 1).padStart(2, "0")}-${beat.name}`;

  // ── Pass one: at rest, to measure ──
  let page = await open(beat.frame(0), stem, beat);
  const at = await inspect(page, beat.focus ?? null);

  // ── Pass two: panned onto the subject ──
  let pan = 0;
  if (beat.focus !== undefined) {
    if (at.subject === null) {
      problems.push(`${beat.name}: focus "${beat.focus}" matched nothing`);
    } else {
      pan = Math.max(0, Math.min(at.subject.top - TOP_GAP, Math.max(0, at.contentEnd - at.view)));
      if (pan > 0) {
        await page.close();
        page = await open(beat.frame(pan), stem, beat);
      }
    }
  }

  const check = pan === 0 ? at : await inspect(page, beat.focus ?? null);

  const notes = [];
  if (pan > 0) notes.push(`panned ${pan}dp`);
  if (check.below.length > 0) notes.push(`${check.below.length} below the fold`);

  if (!beat.scroll && check.below.length > 0) {
    problems.push(
      `${beat.name}: no ScrollView, yet clipped — ${check.below.slice(0, 4).join(", ")}`,
    );
  }
  problems.push(...solfaProblems(beat.name, check.lines));

  if (check.subject !== null) {
    const room = check.view - TOP_GAP;
    if (check.subject.bottom > check.view + 0.5) {
      if (at.subject.height <= room) {
        problems.push(
          `${beat.name}: "${beat.focus}" would fit but is cut off — the pan stopped at ${pan}dp`,
        );
      } else {
        // Nothing to fix: the engraved stave is simply taller than a phone.
        notes.push(`subject is ${at.subject.height}dp tall, top ${room}dp shown`);
      }
    }
  }

  console.log(`  ${stem}${notes.length ? `  (${notes.join("; ")})` : ""}`);

  await page.screenshot({ path: join(OUT_DEVICE, `${stem}.png`) });
  await page.close();

  // ── The 9:16 drop-in ──
  const framePath = join(BUILD, `${stem}.frame.html`);
  writeFileSync(framePath, framePage(pathToFileURL(join(BUILD, `${stem}.html`)).href), "utf8");
  const tile = await browser.newPage({
    viewport: { width: TILE_W, height: TILE_H },
    deviceScaleFactor: 3,
  });
  await tile.goto(pathToFileURL(framePath).href, { waitUntil: "load" });
  await tile.evaluate(() => document.fonts.ready.then(() => true));
  await tile.waitForTimeout(700); // the iframe's own fonts, Lottie and stave
  await tile.screenshot({ path: join(OUT_FRAME, `${stem}.png`) });
  await tile.close();
}

await browser.close();

if (problems.length === 0) rmSync(BUILD, { recursive: true, force: true });

console.log(
  problems.length
    ? `\nPROBLEMS (${problems.length}) — pages kept in .build-video/ :\n  ${problems.join("\n  ")}`
    : `\n${BEATS.length} beats clean: nothing clipped, every subject on screen.`,
);
