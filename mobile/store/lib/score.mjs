/**
 * The stave, engraved by the app's own engraver.
 *
 * `ScoreView.tsx` hands MusicXML to `assets/engraver/index.html` — OSMD inlined
 * above `scripts/engraver/page.js` — inside a WebView, and that is what ships. So
 * the screenshots do the same thing: load the very same asset in a headless page,
 * call `window.NF.render`, and lift the finished `<svg>` out to be inlined into
 * the result screen's card. Nothing is redrawn; the notation in the picture is
 * the notation the app prints.
 *
 * The page talks back over `window.ReactNativeWebView.postMessage`, which does not
 * exist in a browser — `post()` simply no-ops. Rather than poll for an `<svg>` and
 * hope (which cannot tell a slow render from a failed one), a stub is installed
 * before the page's scripts run, so `ready`, `rendered` and `error` all arrive
 * exactly as they do on a device and a load failure is reported instead of
 * silently producing an empty card.
 *
 * The one thing that is NOT faithful: OSMD sets lyrics and measure numbers in
 * "Times New Roman", which resolves to Android's serif on a device and to the
 * real face here. The noteheads are Bravura paths, so only those two labels
 * differ, and only in shape — not in position.
 */

import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { paletteFor } from "./tokens.mjs";
import { confidenceColor, deriveSolfa } from "./music.mjs";
import { buildMusicXml, resolveKeySignature } from "./musicxml.mjs";

const ENGRAVER = join(import.meta.dirname, "..", "..", "assets", "engraver", "index.html");

/**
 * Engrave `notes` and return the `<svg>` markup.
 *
 * `width` is the container the stave has to fit — `.staffWrap`'s content box on
 * the result screen. OSMD lays systems out to fill it, so passing the wrong
 * number here would break the line in a place the app never would.
 */
export async function engrave(
  browser,
  { notes, timeSignature, keyText, mode = "light", width, showSolfa = true },
) {
  const palette = paletteFor(mode);

  /**
   * `ResultScreen` passes `view.notes` — the *labelled* list — to `ScoreView`, so
   * the syllable printed under each head is the one on the chip beside it. Derive
   * here for the same reason: raw notes have no `solfa` field, and `lyrics: true`
   * over a list without one prints a stave with nothing sung under it.
   */
  const labelled = deriveSolfa(notes, keyText, timeSignature).notes;

  const xml = buildMusicXml(labelled, resolveKeySignature(keyText), timeSignature, {
    lyrics: showSolfa,
    colorFor: (conf) => confidenceColor(conf, palette),
  });
  if (xml === null) throw new Error("nothing to engrave: buildMusicXml returned null");

  /** `ScoreView`'s options object, verbatim. */
  const options = {
    ink: palette.text,
    pageBackground: palette.surface,
    cursorColor: palette.accent,
    lyrics: showSolfa,
    showCursor: false,
    measureNumberInterval: 1,
  };

  const page = await browser.newPage({ viewport: { width, height: 1200 } });
  try {
    await page.addInitScript(() => {
      window.__nf = [];
      window.ReactNativeWebView = {
        postMessage: (text) => {
          try {
            window.__nf.push(JSON.parse(text));
          } catch {
            /* not one of ours */
          }
        },
      };
    });

    await page.goto(pathToFileURL(ENGRAVER).href, { waitUntil: "load" });
    await page.waitForFunction(() => window.__nf.some((m) => m.type === "ready"));

    /**
     * `NF.render` has to be called from a <script> the page runs itself.
     *
     * patchright — the only Chromium on this machine — evaluates `page.evaluate` in
     * an isolated world for stealth. It shares the DOM but not the globals, so
     * `window.NF` is undefined there and the obvious `page.evaluate(() =>
     * window.NF.render(…))` fails. `addInitScript` and `waitForFunction` do run in
     * the main world, which is why the stub above and the waits below work as
     * written; an appended script element does too, so the call goes in as source
     * with the payload inlined. `<` is escaped because script content ends at the
     * first `</script`, and the payload is MusicXML.
     */
    const payload = JSON.stringify({ xml, options }).replace(/</g, "\\u003c");
    await page.addScriptTag({ content: `window.NF.render(${payload})` });

    const message = await page
      .waitForFunction(
        () => window.__nf.find((m) => m.type === "rendered" || m.type === "error") ?? false,
      )
      .then((handle) => handle.jsonValue());

    if (message.type === "error") throw new Error(`engraver ${message.where}: ${message.message}`);

    // The DOM is shared with the isolated world, so this one can stay an evaluate.
    const svg = await page.evaluate(() => {
      const el = document.querySelector("#score svg");
      return el === null ? null : el.outerHTML;
    });
    if (svg === null) throw new Error("engraver reported rendered but produced no <svg>");

    return { svg, height: message.height, heads: message.heads };
  } finally {
    await page.close();
  }
}
