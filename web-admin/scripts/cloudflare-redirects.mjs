// Writes out/_redirects for Cloudflare (Workers static assets) after `next build` has exported the console.
//
// The pages with an id in the path are built once, for the placeholder id "_" (usePathId), so every
// /users/{id} must be served /users/_ (and its RSC files /users/{id}/… from /users/_/…). Cloudflare's
// _redirects has no "unless a file exists", and a rule wins over a file, so every file the build put
// directly in one of those folders (the list page's own prefetch files, /blog/topics) is listed first
// as a rule to itself; only then come the id rules. Run by `npm run build:cloudflare`.
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = new URL("../out/", import.meta.url).pathname;
const ID_ROUTES = ["users", "blog", "sessions", "payments"];
const PLACEHOLDER = "_";

const own = new Set();
const folders = [];
const ids = [];
for (const route of ID_ROUTES) {
  const dir = join(OUT, route);
  for (const name of readdirSync(dir)) {
    if (name === PLACEHOLDER) continue;
    const isDir = statSync(join(dir, name)).isDirectory();
    // A file, or a folder that is a page of its own (/blog/topics): kept as itself. "_.html"/"_.txt" are the
    // placeholder's own files, reached through the id rules.
    if (name === `${PLACEHOLDER}.html` || name === `${PLACEHOLDER}.txt`) continue;
    const path = `/${route}/${isDir ? name : name.replace(/\.html$/, "")}`;
    own.add(`${path} ${path} 200`);
    // Its own files too, before "/route/:id/*" could take them (dynamic rules come after the static ones).
    if (isDir) folders.push(`${path}/* ${path}/:splat 200`);
  }
  ids.push(`/${route}/:id/* /${route}/${PLACEHOLDER}/:splat 200`);
  ids.push(`/${route}/:id /${route}/${PLACEHOLDER} 200`);
}

const lines = [
  "# Written by scripts/cloudflare-redirects.mjs at build time: do not edit.",
  "# Real files first, as themselves; then every id is served the placeholder page.",
  ...own,
  ...folders,
  ...ids,
];
writeFileSync(join(OUT, "_redirects"), lines.join("\n") + "\n");
console.log(`out/_redirects: ${own.size} files and ${folders.length} folders kept, ${ids.length} id rules`);
