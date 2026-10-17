#!/usr/bin/env node
// The site's one icon set: Lucide (https://lucide.dev, ISC licence), pinned as lucide-static in package.json.
// Writes web-site/assets/icons.svg, a sprite of <symbol id="i-…"> that every page and script references as
//   <svg class="ic" aria-hidden="true"><use href="/assets/icons.svg#i-mic"/></svg>
// and web-site/assets/icons-LICENSE.txt, Lucide's licence. Every symbol carries the same stroke (1.75, round
// caps and joins, currentColor), so icons look alike wherever they are drawn; the page sets the size
// (16, 20 or 24 px) in CSS. The build (build.mjs) writes it, so `node check.mjs` fails when it is stale, and
// tests/icons.test.mjs fails when a page or script asks for an icon the sprite does not have.
//
// To add an icon: add "our-id": "lucide-name" below (names at https://lucide.dev/icons), then
// `node tools/blog/build.mjs`. Brand marks (the NoteFusion logo, Google, Google Play, YouTube, Spotify,
// Apple Music, Product Hunt) are not icons and stay as they are.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { SITE_DIR } from "./lib/site.mjs";

/** Our id (without the "i-") → the Lucide icon drawn for it. */
export const ICONS = {
  "arrow-right": "arrow-right",
  "back": "chevron-left",
  "camera": "camera",
  "check": "check",
  "chev": "chevron-right",
  "chev-down": "chevron-down",
  "choir": "users",
  "clock": "clock",
  "crown": "crown",
  "download": "download",
  "expand": "maximize-2",
  "eye": "eye",
  "eye-off": "eye-off",
  "gear": "settings",
  "help": "circle-help",
  "info": "info",
  "keys": "piano",
  "link": "link",
  "lock": "lock",
  "logout": "log-out",
  "mail": "mail",
  "menu": "menu",
  "mic": "mic",
  "minus": "minus",
  "monitor": "monitor",
  "moon": "moon",
  "music": "music",
  "paste": "clipboard-paste",
  "pause": "pause",
  "phone": "smartphone",
  "play": "play",
  "plus": "plus",
  "print": "printer",
  "restart": "rotate-ccw",
  "save": "save",
  "search": "search",
  "share": "share",
  "shift": "chevrons-up-down",
  "sing": "mic-vocal",
  "sparkle": "sparkles",
  "stop": "square",
  "sun": "sun",
  "text": "type",
  "trash": "trash-2",
  "upload": "upload",
  "user": "user",
  "volume": "volume-2",
  "wave": "audio-lines",
  "x": "x",
};

/** One stroke for every icon, as presentation attributes so it holds inside <use> wherever the sprite is drawn. */
const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';

export const SPRITE_PATH = path.join(SITE_DIR, "assets", "icons.svg");
export const LICENSE_PATH = path.join(SITE_DIR, "assets", "icons-LICENSE.txt");

function lucideDir() {
  const require = createRequire(import.meta.url);
  return path.dirname(require.resolve("lucide-static/package.json"));
}

/** The sprite's text: one <symbol> per icon, its Lucide shapes unchanged. */
export function spriteSvg() {
  const dir = lucideDir();
  const version = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version;
  const symbols = Object.entries(ICONS).sort(([a], [b]) => a.localeCompare(b)).map(([id, name]) => {
    const src = fs.readFileSync(path.join(dir, "icons", `${name}.svg`), "utf8");
    const body = src.slice(src.indexOf(">", src.indexOf("<svg")) + 1, src.lastIndexOf("</svg>"))
      .split("\n").map((l) => l.trim()).filter(Boolean).join("").replace(/\s*\/>/g, "/>");
    return `<symbol id="i-${id}" viewBox="0 0 24 24" ${STROKE}>${body}</symbol>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg">
<!-- Lucide icons v${version} (https://lucide.dev), ISC licence: /assets/icons-LICENSE.txt. Written by tools/blog/icons.mjs; do not edit. -->
${symbols.join("\n")}
</svg>
`;
}

export function licenseText() {
  return fs.readFileSync(path.join(lucideDir(), "LICENSE"), "utf8");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  fs.writeFileSync(SPRITE_PATH, spriteSvg());
  fs.writeFileSync(LICENSE_PATH, licenseText());
  console.log(`Wrote ${Object.keys(ICONS).length} icons to ${path.relative(process.cwd(), SPRITE_PATH)}`);
}
