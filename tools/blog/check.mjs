#!/usr/bin/env node
// CI check for the generated blog and hymn pages:
//   1. Stale output: rebuilds into a temporary copy of web-site/ and fails if anything the build
//      owns differs from what is committed (run `node tools/blog/build.mjs` and commit) — the pages and
//      the worker's hymn index, server/app/data/hymn_index.json.
//   2. Links: every internal href/src (and canonical, og:image) on every page resolves to a file,
//      and every #fragment to an id on its page.
//   3. Pages the build writes: one <h1>, a <title>, a description of at most 160 characters, a
//      canonical URL; every JSON-LD block and the hymn data parse as JSON; the MusicXML,
//      sitemap.xml and feed.xml are well-formed XML; every sitemap URL exists.
// The committed output is built from content/ alone (posts come from the API at deploy time); the deploy
// runs `node check.mjs --deployed` on what `build.mjs --api` wrote, as warnings.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SITE_DIR, ORIGIN } from "./lib/site.mjs";
import { writeSite } from "./build.mjs";
import { GENERATED_NOTE } from "./lib/layout.mjs";
import { HYMN_INDEX_PATH } from "./lib/hymn-index.mjs";

/** A small well-formedness check: tags balance, attributes are quoted, entities are known. Returns an error or null. */
export function xmlError(xml) {
  const src = String(xml).replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<\?[\s\S]*?\?>/g, "").replace(/<!DOCTYPE[^>]*>/i, "");
  const stack = [];
  const re = /<\/?([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>|<|&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g;
  let m, roots = 0;
  while ((m = re.exec(src))) {
    if (!m[1]) return `stray "${m[0]}" at ${m.index}`;
    if (m[0].startsWith("</")) {
      const open = stack.pop();
      if (open !== m[1]) return `</${m[1]}> closes <${open || "nothing"}>`;
    } else if (!m[3]) { if (!stack.length) roots++; stack.push(m[1]); }
    else if (!stack.length) roots++;
  }
  if (stack.length) return `<${stack[stack.length - 1]}> is never closed`;
  return roots === 1 ? null : `${roots} root elements`;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

/** The file a site path is served from (cleanUrls: /blog → blog.html or blog/index.html), or null. */
export function resolveSitePath(siteDir, urlPath) {
  let p = decodeURIComponent(urlPath.split("#")[0].split("?")[0]);
  if (!p.startsWith("/")) return null;
  if (p === "/") return path.join(siteDir, "index.html");
  p = p.replace(/\/+$/, "");
  const base = path.join(siteDir, p);
  for (const cand of [base, base + ".html", path.join(base, "index.html")]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

function idsIn(html) { return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])); }

export function checkSite(siteDir, { generatedOnly = false } = {}) {
  const errors = [];
  const files = walk(siteDir).filter((f) => f.endsWith(".html"));
  const cache = new Map();
  const read = (f) => { if (!cache.has(f)) cache.set(f, fs.readFileSync(f, "utf8")); return cache.get(f); };

  for (const file of files) {
    const rel = path.relative(siteDir, file);
    const html = read(file);
    const generated = html.includes(GENERATED_NOTE);
    if (generatedOnly && !generated) continue;
    // Strip scripts' and styles' bodies so their text is not read as links.
    const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, (s) => s.slice(0, s.indexOf(">") + 1)).replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, "");
    const ids = idsIn(markup);
    const urls = [...markup.matchAll(/\s(href|src)="([^"]*)"/g)].map((m) => m[2]);
    for (const m of markup.matchAll(/<meta\s+(?:property|name)="(?:og:image|twitter:image|og:url)"\s+content="([^"]+)"/g)) urls.push(m[1]);
    for (let u of urls) {
      if (!u) { errors.push(`${rel}: empty link`); continue; }
      if (u.startsWith(ORIGIN)) u = u.slice(ORIGIN.length) || "/";
      if (/^(https?:|mailto:|tel:|data:|javascript:|\/\/)/i.test(u)) continue;
      if (u.startsWith("#")) { if (u.length > 1 && !ids.has(decodeURIComponent(u.slice(1)))) errors.push(`${rel}: no id for ${u}`); continue; }
      if (!u.startsWith("/")) { if (generated) errors.push(`${rel}: relative link "${u}" (generated pages use site paths)`); continue; }
      const target = resolveSitePath(siteDir, u);
      if (!target) { errors.push(`${rel}: broken link ${u}`); continue; }
      const frag = u.includes("#") ? u.split("#")[1] : "";
      if (frag && target.endsWith(".html") && !idsIn(read(target)).has(frag)) errors.push(`${rel}: ${u} — no id "${frag}" on that page`);
    }
    if (!generated) continue;

    const h1 = (markup.match(/<h1[\s>]/g) || []).length;
    if (h1 !== 1) errors.push(`${rel}: ${h1} <h1> elements (want exactly one)`);
    const title = /<title>([^<]*)<\/title>/.exec(html);
    if (!title || !title[1].trim()) errors.push(`${rel}: no <title>`);
    const desc = /<meta name="description" content="([^"]*)">/.exec(html);
    if (!desc) errors.push(`${rel}: no meta description`);
    else if (desc[1].replace(/&[a-z#0-9]+;/g, "x").length > 160) errors.push(`${rel}: meta description over 160 characters`);
    if (!/<link rel="canonical" href="https:\/\/notefusion\.studio\/[^"]*">/.test(html)) errors.push(`${rel}: no canonical URL`);
    if (!/<html lang="en/.test(html)) errors.push(`${rel}: no lang="en…" on <html>`);
    if (!html.includes("/assets/track.js")) errors.push(`${rel}: the first-party tracker (track.js) is missing`);
    for (const m of html.matchAll(/<script type="application\/(ld\+json|json)"[^>]*>([\s\S]*?)<\/script>/g)) {
      let data;
      try { data = JSON.parse(m[2]); } catch (e) { errors.push(`${rel}: a ${m[1]} block is not valid JSON (${e.message})`); continue; }
      if (m[1] === "ld+json" && (!data["@context"] || !data["@type"])) errors.push(`${rel}: a JSON-LD block has no @context/@type`);
      if (data.musicXml) { const x = xmlError(data.musicXml); if (x) errors.push(`${rel}: the MusicXML is not well-formed (${x})`); }
    }
    for (const img of markup.matchAll(/<img\b[^>]*>/g)) {
      if (!/\swidth="\d+"/.test(img[0]) || !/\sheight="\d+"/.test(img[0])) errors.push(`${rel}: an image without width and height (layout shift): ${img[0].slice(0, 80)}`);
      if (!/\salt="/.test(img[0])) errors.push(`${rel}: an image without alt text`);
    }
  }

  for (const name of ["sitemap.xml", "blog/feed.xml"]) {
    const f = path.join(siteDir, name);
    if (!fs.existsSync(f)) { errors.push(`${name} is missing`); continue; }
    const xml = fs.readFileSync(f, "utf8");
    const x = xmlError(xml);
    if (x) errors.push(`${name} is not well-formed XML (${x})`);
    if (name === "sitemap.xml") {
      for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
        if (!m[1].startsWith(ORIGIN)) { errors.push(`sitemap.xml: ${m[1]} is not on ${ORIGIN}`); continue; }
        if (!resolveSitePath(siteDir, m[1].slice(ORIGIN.length) || "/")) errors.push(`sitemap.xml lists ${m[1]}, which has no page`);
      }
    } else {
      for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) for (const tag of ["title", "link", "guid", "pubDate", "description"]) {
        if (!new RegExp(`<${tag}[ >]`).test(m[1])) errors.push(`feed.xml: an item has no <${tag}>`);
      }
    }
  }
  return errors;
}

/** Files the build writes or owns that differ between a fresh build and the committed site. */
export function staleFiles(freshDir, siteDir) {
  const owned = (dir) => ["blog", "hymns"].flatMap((d) => (fs.existsSync(path.join(dir, d)) ? walk(path.join(dir, d)) : [])).map((f) => path.relative(dir, f));
  const names = new Set([...owned(freshDir), ...owned(siteDir), "sitemap.xml", "index.html", ...fs.readdirSync(freshDir).filter((f) => /^[0-9a-f]{32}\.txt$/.test(f))]);
  const stale = [];
  for (const rel of [...names].sort()) {
    const a = path.join(freshDir, rel), b = path.join(siteDir, rel);
    if (!fs.existsSync(a)) stale.push(`${rel} (committed, but the build no longer writes it)`);
    else if (!fs.existsSync(b)) stale.push(`${rel} (missing — not committed)`);
    else if (!fs.readFileSync(a).equals(fs.readFileSync(b))) stale.push(`${rel} (differs)`);
  }
  return stale;
}

/**
 * `--deployed`: the deploy's check, after `build.mjs --api` has written the live posts into web-site/. The
 * posts were checked by the API before they were published, so a problem here (a link to a post unpublished
 * since) is a warning in the deploy log, never a failed deploy: the rest of the site still ships.
 */
function checkDeployed() {
  const errors = checkSite(SITE_DIR);
  for (const e of errors) console.log(`::warning::${e}`);
  console.log(errors.length ? `${errors.length} problem${errors.length === 1 ? "" : "s"} in the built site (warnings above).` : "The built site's links, JSON-LD, sitemap and feed check out.");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes("--deployed")) {
  checkDeployed();
} else if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nf-site-"));
  let failed = false;
  try {
    fs.cpSync(SITE_DIR, tmp, { recursive: true });
    const freshIndex = path.join(tmp, ".hymn_index.json");
    const summary = writeSite({ siteDir: tmp, indexPath: freshIndex });
    const stale = staleFiles(tmp, SITE_DIR);
    if (!fs.existsSync(HYMN_INDEX_PATH)) stale.push("server/app/data/hymn_index.json (missing — not committed)");
    else if (!fs.readFileSync(freshIndex).equals(fs.readFileSync(HYMN_INDEX_PATH))) stale.push("server/app/data/hymn_index.json (differs)");
    if (stale.length) {
      failed = true;
      console.error(`The committed pages are out of date. Run \`node tools/blog/build.mjs\` and commit the result:\n  - ${stale.join("\n  - ")}`);
    }
    const errors = checkSite(tmp);
    if (errors.length) {
      failed = true;
      console.error(`${errors.length} problem${errors.length === 1 ? "" : "s"} in the built site:\n  - ${errors.join("\n  - ")}`);
    }
    if (!failed) console.log(`OK: ${summary.posts} posts, ${summary.hymns} hymns; output up to date; links, JSON-LD, sitemap and feed check out.`);
  } catch (e) {
    failed = true;
    console.error(`Check failed: ${e.message}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
}
