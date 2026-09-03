/**
 * The onboarding animations, rendered for real.
 *
 * `OnboardingScreen` plays `mobile/assets/animations/*.json` through
 * `lottie-react-native`. Those files are Bodymovin JSON, so the browser can play
 * them too — with `lottie-web`, which is a `mobile/` devDependency for exactly
 * this reason (the same arrangement as `opensheetmusicdisplay`, which only
 * `scripts/build-engraver.mjs` uses).
 *
 * A still frame, not a loop: these pages are captured, so the animation is
 * seeked to one frame and stopped. `goToAndStop(fraction * totalFrames, true)`
 * with the second argument makes the seek frame-based rather than millisecond-
 * based, which is what keeps a rebuild landing on the same picture.
 *
 * The player is loaded off disk over `file://` and fetches the JSON by XHR, both
 * of which need Chromium's `--allow-file-access-from-files` — `render.mjs`
 * already passes it.
 */

import { pathToFileURL } from "node:url";
import { join } from "node:path";

const MOBILE = join(import.meta.dirname, "..", "..");
const url = (p) => pathToFileURL(p).href;

/** `lottie-web`'s bundled player. */
export const LOTTIE_JS = url(
  join(MOBILE, "node_modules/lottie-web/build/player/lottie.min.js"),
);

const ANIM_DIR = join(MOBILE, "assets/animations");

/** The container the app gives Lottie — 230×230 inside the 260×260 stage. */
export const lottieStage = (file, frame = 0.5) =>
  `<div class="animation f" data-lottie="${url(join(ANIM_DIR, file))}" data-frame="${frame}"></div>`;

/**
 * Loads the player, seeks every `[data-lottie]` on the page, and flips
 * `window.__lottieReady` once they have all drawn. The renderer polls that flag
 * instead of racing `document.fonts.ready`, because the JSON fetch and the first
 * SVG layout both happen after the fonts are in.
 */
export const lottieScript = () => `
<script src="${LOTTIE_JS}"></script>
<script>
(() => {
  const stages = [...document.querySelectorAll("[data-lottie]")];
  let left = stages.length;
  if (!left) { window.__lottieReady = true; return; }
  for (const container of stages) {
    const anim = lottie.loadAnimation({
      container,
      renderer: "svg",
      loop: false,
      autoplay: false,
      path: container.dataset.lottie,
      rendererSettings: { preserveAspectRatio: "xMidYMid meet" },
    });
    anim.addEventListener("DOMLoaded", () => {
      anim.goToAndStop(Number(container.dataset.frame) * anim.totalFrames, true);
      if (--left === 0) window.__lottieReady = true;
    });
    anim.addEventListener("data_failed", () => {
      // Better a visibly empty disc than a page that never reports ready — the
      // renderer would sit on the poll until it timed out with no reason given.
      container.dataset.failed = "1";
      if (--left === 0) window.__lottieReady = true;
    });
  }
})();
</script>`;
