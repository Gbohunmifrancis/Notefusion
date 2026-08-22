/**
 * Bakes the sheet-music engraver into a single offline HTML asset.
 *
 * `assets/engraver/index.html` = OpenSheetMusicDisplay's UMD bundle, inlined,
 * followed by `scripts/engraver/page.js`. One self-contained file, because the
 * WebView must render with no network and no file-system reads beside it: a
 * remote <script> would make the stave fail wherever the app is most likely to
 * be used, and separate local files need platform-specific file:// permissions
 * that a single inlined document sidesteps entirely.
 *
 * OSMD is a devDependency for the same reason — nothing imports it at runtime,
 * the bundle only has to exist when this script runs. The generated HTML is
 * committed, like the brand assets, so a clean checkout builds without it.
 *
 * Re-run with `npm run build:engraver` after upgrading OSMD or editing the page.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MOBILE = resolve(HERE, "..");

const OSMD = resolve(
  MOBILE,
  "node_modules/opensheetmusicdisplay/build/opensheetmusicdisplay.min.js",
);
const PAGE = resolve(HERE, "engraver/page.js");
const OUT_DIR = resolve(MOBILE, "assets/engraver");
const OUT = resolve(OUT_DIR, "index.html");

const version = JSON.parse(
  readFileSync(resolve(MOBILE, "node_modules/opensheetmusicdisplay/package.json"), "utf8"),
).version;

const bundle = readFileSync(OSMD, "utf8");
const page = readFileSync(PAGE, "utf8");

// `</script>` anywhere in the JS would close the tag early. Neither file has one
// today; a future one would break the page silently, so refuse instead.
for (const [name, source] of [
  ["opensheetmusicdisplay.min.js", bundle],
  ["page.js", page],
]) {
  if (/<\/script/i.test(source)) {
    throw new Error(`${name} contains "</script" and cannot be inlined verbatim`);
  }
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>NoteFusion engraver</title>
<style>
  /* No margins: the native side sizes the WebView to the reported content
     height, so any page chrome would show up as a gap under the last system. */
  html, body { margin: 0; padding: 0; background: transparent; overflow-x: hidden; }
  body { -webkit-tap-highlight-color: transparent; -webkit-user-select: none; user-select: none; }
  #score { width: 100%; }
</style>
</head>
<body>
<div id="score"></div>
<!-- opensheetmusicdisplay ${version}, inlined by scripts/build-engraver.mjs -->
<script>${bundle}</script>
<script>${page}</script>
</body>
</html>
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, html, "utf8");

const kb = (n) => `${Math.round(n / 1024)} KiB`;
console.log(
  `engraver/index.html  ${kb(html.length)}  (osmd ${version} ${kb(bundle.length)} + page ${kb(page.length)})`,
);
