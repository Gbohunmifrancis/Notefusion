/**
 * The browser both renderers launch.
 *
 * patchright ships inside the CodeGPT VS Code extension, which is the only copy on
 * this machine. It is resolved by glob so a version bump doesn't break the scripts.
 *
 * The flags are not optional. Every page here is a `file://` page reading the
 * Poppins TTFs off disk, and three of them go further: the onboarding frames fetch
 * their Lottie JSON by XHR, the staff frame loads the engraver, and the framed
 * tiles iframe another `file://` page. All of that needs
 * `--allow-file-access-from-files`.
 *
 * One caveat to know before writing a new frame: patchright evaluates
 * `page.evaluate` in an isolated world for stealth. It shares the DOM but not the
 * page's globals, so `window.__lottieReady` and `window.NF` are simply undefined
 * there. `addInitScript` and `waitForFunction` do run in the main world, and a
 * `<script>` element appended to the document does too — so poll page state with
 * `waitForFunction`, call into the page with `addScriptTag`, and use `evaluate`
 * only for the DOM.
 */

import { join } from "node:path";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";

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

export function launch() {
  return loadChromium().launch({
    headless: true,
    channel: "chromium",
    args: ["--no-sandbox", "--allow-file-access-from-files", "--font-render-hinting=none"],
  });
}
