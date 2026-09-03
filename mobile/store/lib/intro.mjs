/**
 * The frames either side of the app itself: the splash, the three onboarding
 * slides, and the closing card.
 *
 * Splash and outro are the only pages here that are *not* themed. The app's
 * splash is a fixed blue gradient in both modes (it shows while the stored theme
 * is still being read off disk, so there is no mode to honour yet), and the
 * closing card is brand artwork rather than a screen.
 */

import { C, ic, paletteFor } from "./tokens.mjs";
import { shell, DEVICE_W } from "./screens.mjs";
import { brandMark, staffRibbon } from "./brand.mjs";
import { USER } from "./sample.mjs";
import { lottieStage, lottieScript } from "./lottie.mjs";

/** `SPLASH_GRADIENT`, at the diagonal its start/end points describe. */
const SPLASH_BG = "linear-gradient(135deg, #2F7CF6, #1D6FF2, #1257E8)";

/**
 * The design's diagonal sheen. RN gives it as start {0.1,0} → end {0.9,0.62};
 * over a 412×915 box that vector is 330 right and 567 down, which is 150° in
 * CSS's clockwise-from-north convention.
 */
const SPLASH_SHEEN = "linear-gradient(150deg, rgba(255,255,255,0.14), rgba(255,255,255,0))";

const SPLASH_CSS = `
/* The splash has no SafeAreaView: the gradient runs under the status bar and the
   OS glyphs float over it, so the bar comes out of the flow. White, because the
   canvas beneath it is always deep blue — the app sets barStyle="light-content". */
:root { --text: #FFFFFF; }
.statusbar { position: absolute; top: 0; left: 0; right: 0; z-index: 5; }
.safe { background: #1D6FF2; }
.fill { position: absolute; top: 0; left: 0; right: 0; bottom: 0; }
.centre { flex: 1 1 0; align-items: center; justify-content: center; padding: 0 20px 120px; }
.wordmark { margin-top: 24px; font-size: 36px; font-weight: 700; color: #FFFFFF; letter-spacing: -0.2px; text-align: center; }
.tagline { margin-top: 10px; font-size: 17px; font-weight: 500; color: rgba(255,255,255,0.92); }
.ribbon { position: absolute; left: 0; right: 0; bottom: 0; }
`;

export function splash() {
  const body = `
<div class="fill" style="background:${SPLASH_BG}"></div>
<div class="fill" style="background:${SPLASH_SHEEN}"></div>
<div class="centre f">
  ${brandMark({ size: 150, color: "#FFFFFF", waveColor: "rgba(255,255,255,0.55)", showWaves: true })}
  <div class="wordmark display">Notefusion</div>
  <div class="tagline">Hear it. See it. Notate it.</div>
</div>
<div class="ribbon">${staffRibbon({ width: DEVICE_W, height: 200, color: "#FFFFFF", opacity: 0.22 })}</div>`;

  return shell(body, SPLASH_CSS);
}

// ─── Onboarding ──────────────────────────────────────────────────────────────

/**
 * `SLIDES` from `OnboardingScreen.tsx`, verbatim, plus the point in each
 * animation to freeze at — the app plays them, a captured page cannot, and the
 * first frame of a Lottie is usually an empty stage.
 */
export const SLIDES = [
  {
    animation: "record.json",
    frame: 0.5,
    title: "Record a melody",
    body: "Capture a live tune or hum — a few bars is all it takes. Sing, hum, or play near the mic.",
  },
  {
    animation: "transcribe.json",
    frame: 0.5,
    title: "Instant transcription",
    body: "We turn your audio into Tonic Solfa and staff notation, perfectly on-key every time.",
  },
  {
    animation: "rekey.json",
    frame: 0.5,
    title: "Save & re-key",
    body: "Build a personal library and change the key anytime — your notes never shift, only the labels do.",
  },
];

const ONB_CSS = `
.topBar { align-items: flex-end; padding: 8px 24px 0; }
.skip { font-size: 16px; font-weight: 600; color: ${C.accent}; }
.centre { flex: 1 1 0; justify-content: center; align-items: center; }
.slide { align-items: center; padding: 0 24px; }
.stage { width: 260px; height: 260px; align-items: center; justify-content: center; position: relative; }
.disc { position: absolute; width: 250px; height: 250px; border-radius: 125px; background: ${C.accentSoft}; }
.animation { width: 230px; height: 230px; align-items: center; justify-content: center; }
.animation svg { width: 100%; height: 100%; }
.onbTitle { font-size: 28px; font-weight: 700; letter-spacing: -0.5px; text-align: center; margin-top: 24px; }
.onbBody { font-size: 16px; font-weight: 400; line-height: 26px; color: ${C.textMuted}; text-align: center; margin-top: 12px; padding: 0 8px; }
.dots { flex-direction: row; justify-content: center; align-items: center; margin-top: 24px; gap: 8px; }
.dot { width: 9px; height: 9px; border-radius: 999px; background: ${C.border}; }
.dotActive { background: ${C.accent}; }
.footer { padding: 12px 24px 16px; }
/* The app pins the ribbon with zIndex:-1, which in RN simply keeps it under its
   siblings. CSS would paint a negative z-index child behind the safe area's own
   background and lose it, so it is placed first in the document instead — same
   result, and it survives the parent getting a stacking context. */
.ribbon { position: absolute; left: 0; right: 0; bottom: 0; }
`;

export function onboarding({ slide = 0, mode = "light" } = {}) {
  const P = paletteFor(mode);
  const s = SLIDES[slide];
  const isLast = slide === SLIDES.length - 1;

  const dots = SLIDES.map(
    (_, i) => `<div class="dot${i === slide ? " dotActive" : ""}"></div>`,
  ).join("");

  const body = `
<div class="ribbon">${staffRibbon({ width: DEVICE_W, height: 110, color: P.accent, opacity: 0.18 })}</div>
<div class="topBar f"><div class="skip">Skip</div></div>
<div class="centre f">
  <div class="slide f" style="width:${DEVICE_W}px">
    <div class="stage f">
      <div class="disc"></div>
      ${lottieStage(s.animation, s.frame)}
    </div>
    <div class="onbTitle display">${s.title}</div>
    <div class="onbBody">${s.body}</div>
  </div>
  <div class="dots">${dots}</div>
</div>
<div class="footer f">
  <div class="btn btnPrimary">
    <div class="btnLabel" style="color:#FFFFFF">${isLast ? "Get started" : "Next"}</div>
    ${ic("arrow-forward", 18, "#FFFFFF", "margin-left:12px")}
  </div>
</div>
${lottieScript()}`;

  return shell(body, ONB_CSS, { mode });
}

// ─── Closing card ────────────────────────────────────────────────────────────

const OUTRO_CSS = `
:root { --text: #FFFFFF; }
.statusbar { position: absolute; top: 0; left: 0; right: 0; z-index: 5; }
.safe { background: #1D6FF2; }
.fill { position: absolute; top: 0; left: 0; right: 0; bottom: 0; }
.centre { flex: 1 1 0; align-items: center; justify-content: center; padding: 0 32px 96px; }
.outroWord { margin-top: 20px; font-size: 34px; font-weight: 700; color: #FFFFFF; letter-spacing: -0.5px; }
.outroTag { margin-top: 8px; font-size: 16px; font-weight: 500; color: rgba(255,255,255,0.92); text-align: center; }
.recap { margin-top: 32px; gap: 12px; align-self: stretch; }
.recapRow { flex-direction: row; align-items: center; gap: 12px; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.22); border-radius: 999px; padding: 10px 16px; }
.recapText { font-size: 14px; font-weight: 600; color: #FFFFFF; }
.trial { margin-top: 28px; font-size: 13px; font-weight: 500; color: rgba(255,255,255,0.86); }
.site { margin-top: 6px; font-size: 15px; font-weight: 700; color: #FFFFFF; letter-spacing: 0.2px; }
.ribbon { position: absolute; left: 0; right: 0; bottom: 0; }
`;

/**
 * The closing frame. Everything it claims is something the app does today: the
 * three recap rows are the three onboarding promises, and the trial line is the
 * count `RecordScreen` shows on a free account.
 */
export function outro() {
  const rows = [
    ["mic-outline", "Record a few bars"],
    ["sparkles-outline", "Get Solfa and a stave"],
    ["key-outline", "Re-key without re-recording"],
  ]
    .map(
      ([icon, label]) => `<div class="recapRow">
        ${ic(icon, 18, "#FFFFFF")}<div class="recapText">${label}</div>
      </div>`,
    )
    .join("");

  const body = `
<div class="fill" style="background:${SPLASH_BG}"></div>
<div class="fill" style="background:${SPLASH_SHEEN}"></div>
<div class="centre f">
  ${brandMark({ size: 96, color: "#FFFFFF", waveColor: "rgba(255,255,255,0.55)", showWaves: true })}
  <div class="outroWord display">Notefusion</div>
  <div class="outroTag">Hear it. See it. Notate it.</div>
  <div class="recap f">${rows}</div>
  <div class="trial">${USER.trialTotal} free transcriptions to start</div>
  <div class="site">notefusion.studio</div>
</div>
<div class="ribbon">${staffRibbon({ width: DEVICE_W, height: 170, color: "#FFFFFF", opacity: 0.2 })}</div>`;

  return shell(body, OUTRO_CSS);
}
