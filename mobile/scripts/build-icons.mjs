#!/usr/bin/env node
/**
 * Bakes the phone app's icons into one module of path data: `src/design/iconGlyphs.ts`.
 *
 * One family, the website's line (tools/blog/icons.mjs): a 24 grid, a 1.75 stroke, round caps and joins.
 * Generic ideas are Lucide's (https://lucide.dev, ISC), pinned to the website's version; the music ideas
 * (the tuning fork, d:r, the clef, SATB, rhythm, Doh, …) are NoteFusion's own glyphs, drawn for the e-icons
 * boards and kept as SVG sources in `assets/icons-src/notefusion/`. Only the icons named in ICONS below are
 * written, never the whole library, and each becomes at most three path strings (strokes, solid marks, the
 * selected wash) for `components/Icon.tsx` to draw with react-native-svg — no icon font, no runtime package.
 *
 * Lucide comes from npm as lucide-static@LUCIDE_VERSION: `npm pack` into the OS temp folder the first time,
 * its integrity checked against the pin below, unpacked there and reused. Nothing is added to package.json, so
 * builds never install it. LUCIDE_DIR=<an unpacked lucide-static> uses a copy already on disk instead
 * (tools/blog/node_modules/lucide-static carries the same pin); its version is checked.
 *
 * To add an icon: add "our-name": "lucide:<name>" (names at https://lucide.dev/icons) or "nf:<file>" below,
 * then `npm run build:icons`. `src/lib/iconSet.test.ts` fails while the generated file is stale.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MOBILE = resolve(HERE, "..");
export const NF_DIR = join(MOBILE, "assets/icons-src/notefusion");
export const OUT = join(MOBILE, "src/design/iconGlyphs.ts");

export const LUCIDE_VERSION = "1.48.0";
const LUCIDE_INTEGRITY =
  "sha512-ZUGgZ4rzlLfVbhN2Zi37TMrTaSpXAbWx6Y/xZxKSDLPiqxtTK7Mw2M+oBJa0gjV8p3+CWBHh48u+IC9+jKlUjA==";

/** Our name → where its drawing comes from. One name per meaning (e-icons NOTES.md's vocabulary). */
export const ICONS = {
  // Tabs
  home: "nf:home",
  library: "nf:sheets",
  practice: "nf:fork",
  hymns: "nf:hymnal",
  // Music
  transcribe: "nf:transcribe",
  song: "lucide:disc-3",
  solfa: "nf:solfa",
  staff: "nf:staff",
  parts: "nf:parts",
  choir: "nf:choir",
  "learn-part": "nf:learn-part",
  transpose: "nf:transpose",
  "find-key": "lucide:ear",
  chat: "lucide:message-circle",
  import: "lucide:file-music",
  sing: "lucide:mic-vocal",
  mic: "lucide:mic",
  instrument: "lucide:piano",
  chords: "lucide:guitar",
  rehearse: "lucide:repeat",
  // Practice
  "warm-up": "lucide:wind",
  pitch: "nf:pitch",
  runs: "nf:run",
  intervals: "nf:interval",
  harmony: "nf:harmony",
  rhythm: "nf:rhythm",
  streak: "lucide:flame",
  reward: "lucide:sparkles",
  playful: "lucide:smile",
  switch: "lucide:arrow-left-right",
  headphones: "lucide:headphones",
  doh: "nf:doh",
  tap: "lucide:pointer",
  // Actions
  back: "lucide:chevron-left",
  chevron: "lucide:chevron-right",
  down: "lucide:chevron-down",
  up: "lucide:chevron-up",
  close: "lucide:x",
  clear: "lucide:circle-x",
  check: "lucide:check",
  add: "lucide:plus",
  minus: "lucide:minus",
  search: "lucide:search",
  more: "lucide:ellipsis",
  share: "lucide:share",
  link: "lucide:link",
  folder: "lucide:folder",
  "folder-out": "lucide:folder-minus",
  "remove-item": "lucide:circle-minus",
  rename: "lucide:pencil-line",
  "keep-offline": "lucide:cloud-download",
  kept: "lucide:cloud-check",
  delete: "lucide:trash-2",
  save: "lucide:bookmark",
  export: "lucide:download",
  pdf: "lucide:file-text",
  midi: "lucide:piano",
  musicxml: "lucide:file-code",
  lyrics: "lucide:type",
  retry: "lucide:rotate-ccw",
  sort: "lucide:arrow-down-wide-narrow",
  next: "lucide:arrow-right",
  "arrow-up": "lucide:arrow-up",
  "arrow-down": "lucide:arrow-down",
  external: "lucide:external-link",
  play: "lucide:play",
  pause: "lucide:pause",
  stop: "lucide:square",
  restart: "lucide:skip-back",
  hear: "lucide:volume-2",
  camera: "lucide:camera",
  image: "lucide:image",
  eye: "lucide:eye",
  "eye-off": "lucide:eye-off",
  join: "lucide:log-in",
  leave: "lucide:log-out",
  // Rows
  user: "lucide:user-round",
  "user-minus": "lucide:user-minus",
  mail: "lucide:mail",
  password: "lucide:key-round",
  theme: "lucide:contrast",
  night: "lucide:moon",
  day: "lucide:sun",
  haptics: "lucide:vibrate",
  "data-saver": "lucide:gauge",
  // Listen from anywhere (Settings): the floating button, "Display over other apps", the Quick Settings tile
  float: "nf:float",
  overlay: "lucide:layers",
  "qs-tile": "lucide:zap",
  bell: "lucide:bell",
  "bell-off": "lucide:bell-off",
  sound: "lucide:volume-2",
  mute: "lucide:volume-x",
  alarm: "lucide:alarm-clock",
  clock: "lucide:clock",
  settings: "lucide:settings",
  help: "lucide:circle-help",
  feedback: "lucide:message-square-text",
  privacy: "lucide:shield",
  terms: "lucide:file-text",
  about: "lucide:info",
  rate: "lucide:star",
  phone: "lucide:smartphone",
  quick: "lucide:zap",
  // Plan and billing
  pro: "lucide:crown",
  lock: "lucide:lock",
  plans: "lucide:tag",
  gift: "lucide:gift",
  card: "lucide:credit-card",
  "card-declined": "lucide:credit-card-x",
  currency: "lucide:banknote",
  calendar: "lucide:calendar",
  // Status
  problem: "lucide:circle-alert",
  done: "lucide:circle-check",
  offline: "lucide:cloud-off",
  sending: "lucide:cloud-upload",
  waiting: "lucide:hourglass",
  step: "lucide:circle",
  live: "lucide:radio",
  "video-off": "lucide:video-off",
  "not-found": "lucide:search-x",
  "too-long": "lucide:timer",
  later: "lucide:clock-alert",
  "link-off": "lucide:link-2-off",
  update: "lucide:circle-arrow-up",
  snow: "lucide:snowflake",
  ghost: "lucide:ghost",
  // Admin
  users: "lucide:users",
  webhook: "lucide:git-pull-request",
  sync: "lucide:refresh-cw",
  // The phone admin (board f-admin): the console's sidebar names, its panels and actions
  overview: "lucide:layout-grid",
  health: "lucide:heart-pulse",
  money: "lucide:banknote",
  "trend-up": "lucide:arrow-up-right",
  "trend-down": "lucide:arrow-down-right",
  "user-plus": "lucide:user-round-plus",
  "user-x": "lucide:user-round-x",
  "user-check": "lucide:user-round-check",
  insights: "lucide:chart-no-axes-combined",
  growth: "lucide:trending-up",
  "blog-analytics": "lucide:book-open-text",
  "blog-posts": "lucide:notebook-pen",
  activity: "lucide:activity",
  inbox: "lucide:inbox",
  audit: "lucide:scroll-text",
  flag: "lucide:flag",
  copy: "lucide:copy",
  database: "lucide:database",
  server: "lucide:server",
  backup: "lucide:database-backup",
  music: "lucide:music",
  send: "lucide:send",
  playing: "lucide:audio-lines",
  fingerprint: "lucide:fingerprint-pattern",
  role: "lucide:shield-check",
  "end-period": "lucide:calendar-x",
};

const LUCIDE_LICENCE = `ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

Icons Lucide derives from Feather are also under the MIT licence,
Copyright (c) 2013-present Cole Bemis.`;

// ─── SVG → path data ────────────────────────────────────────────────────────

const NUM = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
const n = (v) => String(+(+v).toFixed(3));

function attrs(src) {
  const out = {};
  for (const m of src.matchAll(/([\w:-]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

/**
 * A path's d made safe to join onto another: a leading relative "m" is absolute by the spec, but only while it
 * opens the path, so it becomes "M" (and the pairs that follow it, implicit relative linetos, an explicit "l").
 */
function absoluteStart(d) {
  const t = d.trim();
  if (t[0] !== "m") return t;
  const rest = t.slice(1);
  const nums = [];
  let i = 0;
  NUM.lastIndex = 0;
  for (let m; (m = NUM.exec(rest)); ) {
    if (/[a-df-z]/i.test(rest.slice(i, m.index))) break; // the next command letter (not an exponent "e")
    nums.push(m[0]);
    i = NUM.lastIndex;
  }
  const head = `M${n(nums[0])} ${n(nums[1])}`;
  const pairs = nums.slice(2);
  return head + (pairs.length ? "l" + pairs.join(" ") : "") + rest.slice(i);
}

/** One element of a drawing as a path's d, every shape on the 24 grid. */
function toPath(tag, a) {
  const known = new Set(["d", "cx", "cy", "r", "rx", "ry", "x", "y", "width", "height", "x1", "y1", "x2", "y2", "points", "transform", "fill", "stroke"]);
  for (const k of Object.keys(a)) if (!known.has(k)) throw new Error(`<${tag}> has an attribute this generator does not draw: ${k}`);
  if (a.transform && tag !== "ellipse") throw new Error(`<${tag}> carries a transform; only an ellipse's rotate() is drawn`);
  switch (tag) {
    case "path":
      return absoluteStart(a.d);
    case "circle": {
      const [cx, cy, r] = [+a.cx, +a.cy, +a.r];
      return `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;
    }
    case "ellipse": {
      const [cx, cy, rx, ry] = [+a.cx, +a.cy, +a.rx, +a.ry];
      let deg = 0;
      if (a.transform) {
        const m = /^rotate\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\)$/.exec(a.transform.trim());
        if (!m || +m[2] !== cx || +m[3] !== cy) throw new Error(`ellipse transform must be rotate(a cx cy): ${a.transform}`);
        deg = +m[1];
      }
      const t = (deg * Math.PI) / 180;
      const [dx, dy] = [rx * Math.cos(t), rx * Math.sin(t)];
      const arc = `${n(rx)} ${n(ry)} ${n(deg)} 1 1`;
      return `M${n(cx + dx)} ${n(cy + dy)}A${arc} ${n(cx - dx)} ${n(cy - dy)}A${arc} ${n(cx + dx)} ${n(cy + dy)}Z`;
    }
    case "rect": {
      const [x, y, w, h] = [+(a.x ?? 0), +(a.y ?? 0), +a.width, +a.height];
      const r = Math.min(+(a.rx ?? a.ry ?? 0), w / 2, h / 2);
      if (!r) return `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`;
      const c = (dx, dy) => `a${n(r)} ${n(r)} 0 0 1 ${n(dx)} ${n(dy)}`;
      return `M${n(x + r)} ${n(y)}h${n(w - 2 * r)}${c(r, r)}v${n(h - 2 * r)}${c(-r, r)}h${n(-(w - 2 * r))}${c(-r, -r)}v${n(-(h - 2 * r))}${c(r, -r)}Z`;
    }
    case "line":
      return `M${n(a.x1)} ${n(a.y1)}L${n(a.x2)} ${n(a.y2)}`;
    case "polyline":
    case "polygon": {
      const p = a.points.match(NUM).map(n);
      const pts = [];
      for (let i = 0; i < p.length; i += 2) pts.push(`${p[i]} ${p[i + 1]}`);
      return `M${pts[0]}L${pts.slice(1).join(" ")}${tag === "polygon" ? "Z" : ""}`;
    }
    default:
      throw new Error(`unknown element <${tag}>`);
  }
}

const SHAPE = /<(path|circle|ellipse|rect|line|polyline|polygon)\b([^>]*?)\/?>/g;

/**
 * A drawing as { s: the stroked line, k?: the solid marks (note heads, Doh's eyes), w?: the selected wash }.
 * NoteFusion glyphs: solid marks carry fill="currentColor"; the wash is their <g id="wash">. A Lucide icon has no
 * drawn wash, so its closed shapes are washed instead (a bookmark, a circle), never an open line.
 */
export function glyphFromSvg(svg, { lucide = false } = {}) {
  const body = svg.replace(/<!--[\s\S]*?-->/g, "");
  const washGroup = /<g id="wash"[^>]*>([\s\S]*?)<\/g>/.exec(body);
  const rest = washGroup ? body.replace(washGroup[0], "") : body;
  const s = [], k = [], w = [];
  for (const m of rest.matchAll(SHAPE)) {
    const a = attrs(m[2]);
    const d = toPath(m[1], a);
    if (a.fill === "currentColor") k.push(d);
    else {
      if (a.fill && a.fill !== "none") throw new Error(`unexpected fill ${a.fill}`);
      s.push(d);
      if (lucide && (m[1] !== "path" ? !["line", "polyline"].includes(m[1]) : /z\s*$/i.test(a.d))) w.push(d);
    }
  }
  if (washGroup) for (const m of washGroup[1].matchAll(SHAPE)) w.push(toPath(m[1], attrs(m[2])));
  const g = { s: s.join("") };
  if (k.length) g.k = k.join("");
  if (w.length) g.w = w.join("");
  return g;
}

// ─── Sources ────────────────────────────────────────────────────────────────

const lf = (s) => s.replace(/\r\n/g, "\n");

/** Everything the generated file depends on that lives in the repository: this script and the glyphs it uses. */
export function inputsHash() {
  const h = createHash("sha256");
  h.update(lf(readFileSync(fileURLToPath(import.meta.url), "utf8")));
  for (const src of [...new Set(Object.values(ICONS))].sort()) {
    if (!src.startsWith("nf:")) continue;
    h.update(src).update(lf(readFileSync(join(NF_DIR, src.slice(3) + ".svg"), "utf8")));
  }
  return h.digest("hex").slice(0, 16);
}

function lucideDir() {
  const given = process.env.LUCIDE_DIR;
  const dir = given ? resolve(given) : join(tmpdir(), `notefusion-lucide-static-${LUCIDE_VERSION}`, "package");
  if (!given && !existsSync(join(dir, "package.json"))) {
    const cache = dirname(dir);
    mkdirSync(cache, { recursive: true });
    const [packed] = JSON.parse(
      execFileSync("npm", ["pack", `lucide-static@${LUCIDE_VERSION}`, "--json", "--pack-destination", cache], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      }),
    );
    if (packed.integrity !== LUCIDE_INTEGRITY) throw new Error(`lucide-static ${LUCIDE_VERSION}: integrity ${packed.integrity}, pinned ${LUCIDE_INTEGRITY}`);
    execFileSync("tar", ["-xzf", join(cache, packed.filename), "-C", cache]);
  }
  const version = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
  if (version !== LUCIDE_VERSION) throw new Error(`${dir} is lucide-static ${version}; pinned ${LUCIDE_VERSION}`);
  return join(dir, "icons");
}

export function buildGlyphs(readLucide) {
  const out = {};
  for (const name of Object.keys(ICONS).sort()) {
    const [kind, file] = ICONS[name].split(":");
    if (kind === "nf") out[name] = glyphFromSvg(readFileSync(join(NF_DIR, file + ".svg"), "utf8"));
    else if (kind === "lucide") out[name] = glyphFromSvg(readLucide(file), { lucide: true });
    else throw new Error(`${name}: unknown source ${ICONS[name]}`);
  }
  return out;
}

export function renderModule(glyphs, hash) {
  const names = Object.keys(glyphs);
  const lines = names.map((name) => {
    const g = glyphs[name];
    const parts = Object.entries(g).map(([key, d]) => `${key}: ${JSON.stringify(d)}`);
    return `  ${JSON.stringify(name)}: { ${parts.join(", ")} },`;
  });
  return `/* Generated by scripts/build-icons.mjs (npm run build:icons) — do not edit. Inputs ${hash}.
 *
 * The app's icons as path data on the 24 grid, for components/Icon.tsx: s = the stroked line,
 * k = solid marks, w = the 20% wash under the selected state. NoteFusion glyphs from
 * assets/icons-src/notefusion (ours); every other icon from Lucide ${LUCIDE_VERSION} (lucide-static):
 *
${LUCIDE_LICENCE.split("\n").map((l) => (" * " + l).trimEnd()).join("\n")}
 */

export type IconName =
${names.map((name) => `  | ${JSON.stringify(name)}`).join("\n")};

export interface IconGlyph {
  readonly s: string;
  readonly k?: string;
  readonly w?: string;
}

export const ICON_GLYPHS: Readonly<Record<IconName, IconGlyph>> = {
${lines.join("\n")}
};

/** Lucide's notice, as a string so it ships with the paths in the bundle (comments are stripped; ISC asks for it in every copy). */
export const ICON_LICENCE = ${JSON.stringify(LUCIDE_LICENCE)};
`;
}

function main() {
  const icons = lucideDir();
  const available = new Set(readdirSync(icons));
  const readLucide = (file) => {
    if (!available.has(file + ".svg")) throw new Error(`lucide-static ${LUCIDE_VERSION} has no icon "${file}"`);
    return readFileSync(join(icons, file + ".svg"), "utf8");
  };
  const glyphs = buildGlyphs(readLucide);
  writeFileSync(OUT, renderModule(glyphs, inputsHash()));
  console.log(`${Object.keys(glyphs).length} icons → ${OUT.slice(MOBILE.length + 1)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
