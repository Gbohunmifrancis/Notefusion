#!/usr/bin/env node
// CI check for the generated blog and hymn pages:
//   1. Stale output: rebuilds into a temporary copy of web-site/ and fails if anything the build
//      owns differs from what is committed (run `node tools/blog/build.mjs` and commit) — the pages and
//      the worker's hymn index, server/app/data/hymn_index.json.
//   2. Links: every internal href/src (and canonical, og:image) on every page resolves to a file,
//      and every #fragment to an id on its page.
//   3. Pages the build writes: one <h1>, a <title>, a description of at most 160 characters, a
//      canonical URL; every JSON-LD block and the hymn data parse as JSON; every page a JSON-LD
//      list or breadcrumb names on this site exists; the MusicXML, sitemap.xml and feed.xml are
//      well-formed XML; every sitemap URL exists.
//   4. The PDFs (built with the pages, never committed): every hymn and tune page has its PDF and links
//      to it; each one opens, is titled "… in Tonic Solfa", has at most two pages and stays under the size
//      limit, and its first line of solfa is the page's first line of solfa, character for character.
//   5. The app's hymn pack (web-site/hymns/pack.json, pack-version.json): valid, every entry readable, and
//      the version file naming the pack's own version and byte size (stale output is caught by 1).
// The committed output is built from content/ alone (posts come from the API at deploy time); the deploy
// runs `node check.mjs --deployed` on what `build.mjs --api` wrote, as warnings.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SITE_DIR, ORIGIN } from "./lib/site.mjs";
import { writeSite, GENERATED_DIRS } from "./build.mjs";
import { GENERATED_NOTE } from "./lib/layout.mjs";
import { HYMN_INDEX_PATH } from "./lib/hymn-index.mjs";
import { pdfText, pdfInfo, PDF_MAX_BYTES, PDF_MAX_PAGES } from "./lib/render-pdf.mjs";
import { packErrors, PACK_PATH, PACK_VERSION_PATH } from "./lib/hymn-pack.mjs";

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
      if (m[1] === "ld+json") for (const u of ldUrls(data)) if (!resolveSitePath(siteDir, u.slice(ORIGIN.length) || "/")) errors.push(`${rel}: the JSON-LD names ${u}, which has no page`);
      if (data.musicXml) { const x = xmlError(data.musicXml); if (x) errors.push(`${rel}: the MusicXML is not well-formed (${x})`); }
    }
    for (const img of markup.matchAll(/<img\b[^>]*>/g)) {
      if (!/\swidth="\d+"/.test(img[0]) || !/\sheight="\d+"/.test(img[0])) errors.push(`${rel}: an image without width and height (layout shift): ${img[0].slice(0, 80)}`);
      if (!/\salt="/.test(img[0])) errors.push(`${rel}: an image without alt text`);
    }
  }

  const packFile = path.join(siteDir, PACK_PATH), versionFile = path.join(siteDir, PACK_VERSION_PATH);
  if (!fs.existsSync(packFile) || !fs.existsSync(versionFile)) errors.push(`${PACK_PATH} or ${PACK_VERSION_PATH} is missing`);
  else errors.push(...packErrors(fs.readFileSync(packFile, "utf8"), fs.readFileSync(versionFile, "utf8")));

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

/** Every address on this site a JSON-LD block names (a page's url, a list's items, a breadcrumb, a PDF). */
export function ldUrls(data, out = []) {
  if (Array.isArray(data)) for (const x of data) ldUrls(x, out);
  else if (data && typeof data === "object") {
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === "string" && ["url", "item", "contentUrl"].includes(k) && v.startsWith(ORIGIN)) out.push(v);
      else if (typeof v === "object") ldUrls(v, out);
    }
  }
  return out;
}

/**
 * The PDFs (lib/render-pdf.mjs): every hymn and tune page names its PDF (<link rel="alternate">) and the PDF
 * is there; each one opens, is titled "… in Tonic Solfa" by NoteFusion, has at most PDF_MAX_PAGES pages and
 * PDF_MAX_BYTES bytes, and prints the page's first line of solfa exactly as the page writes it. A PDF no page
 * names is an error too. Asynchronous (pdf-lib reads the files).
 */
export async function checkPdfs(siteDir) {
  const errors = [];
  const dir = path.join(siteDir, "hymns");
  if (!fs.existsSync(dir)) return errors;
  const all = walk(dir);
  const named = new Set();
  for (const file of all.filter((f) => f.endsWith("index.html"))) {
    const rel = path.relative(siteDir, file);
    const html = fs.readFileSync(file, "utf8");
    if (!html.includes('id="lines-title"')) continue; // only hymn and tune pages print their solfa line by line
    const alt = /<link rel="alternate" type="application\/pdf" href="([^"]+)"/.exec(html);
    if (!alt) { errors.push(`${rel}: no <link rel="alternate" type="application/pdf"> for its PDF`); continue; }
    if (!html.includes(`<a class="pdf-button" href="${alt[1]}"`)) errors.push(`${rel}: no "Download the solfa (PDF)" button for ${alt[1]}`);
    const pdf = resolveSitePath(siteDir, alt[1]);
    if (!pdf) { errors.push(`${rel}: its PDF ${alt[1]} was not built`); continue; }
    named.add(pdf);
    const bytes = fs.readFileSync(pdf);
    const where = path.relative(siteDir, pdf);
    if (bytes.length > PDF_MAX_BYTES) errors.push(`${where}: ${Math.round(bytes.length / 1024)} KB (at most ${PDF_MAX_BYTES / 1024} KB)`);
    if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-" || !bytes.subarray(-8).toString("latin1").includes("%%EOF")) { errors.push(`${where}: not a PDF file`); continue; }
    try {
      const info = await pdfInfo(bytes);
      if (!/ in Tonic Solfa$/.test(info.title || "")) errors.push(`${where}: its title "${info.title}" does not end "in Tonic Solfa"`);
      if (info.author !== "NoteFusion") errors.push(`${where}: its author is not NoteFusion`);
      if (info.pages > PDF_MAX_PAGES) errors.push(`${where}: ${info.pages} pages (at most ${PDF_MAX_PAGES})`);
      // The page's first line, bar by bar; the PDF prints those bars in order (a line too wide for A4 wraps
      // at a bar line, so a bar, never a line, is the unit compared).
      const line = /<div class="solfa-line">([\s\S]*?)<\/div>/.exec(html);
      const bars = line ? [...line[1].matchAll(/<code>([\s\S]*?)<\/code>/g)].map((m) => m[1].replace(/<[^>]*>/g, "").replace(/&amp;/g, "&")) : [];
      const text = (await pdfText(bytes))[0].join("\n");
      let at = text.indexOf(bars[0]);
      for (const bar of bars.slice(1)) if (at >= 0) at = text.indexOf(bar.trimEnd(), at);
      if (!bars.length || at < 0) errors.push(`${where}: its first line of solfa is not the page's ("${bars.join("")}")`);
    } catch (e) {
      errors.push(`${where}: cannot be read (${e.message})`);
    }
  }
  for (const f of all.filter((x) => x.endsWith(".pdf") && !named.has(x))) errors.push(`${path.relative(siteDir, f)}: no page names this PDF`);
  return errors;
}

/** Files the build writes or owns that differ between a fresh build and the committed site (PDFs are never committed). */
export function staleFiles(freshDir, siteDir) {
  const owned = (dir) => GENERATED_DIRS.flatMap((d) => (fs.existsSync(path.join(dir, d)) ? walk(path.join(dir, d)) : [])).filter((f) => !f.endsWith(".pdf")).map((f) => path.relative(dir, f));
  const names = new Set([...owned(freshDir), ...owned(siteDir), "sitemap.xml", "index.html", "assets/icons.svg", "assets/icons-LICENSE.txt", ...fs.readdirSync(freshDir).filter((f) => /^[0-9a-f]{32}\.txt$/.test(f))]);
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
async function checkDeployed() {
  const errors = [...checkSite(SITE_DIR), ...(await checkPdfs(SITE_DIR))];
  for (const e of errors) console.log(`::warning::${e}`);
  console.log(errors.length ? `${errors.length} problem${errors.length === 1 ? "" : "s"} in the built site (warnings above).` : "The built site's links, JSON-LD, sitemap, feed and PDFs check out.");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes("--deployed")) {
  await checkDeployed();
} else if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nf-site-"));
  let failed = false;
  try {
    fs.cpSync(SITE_DIR, tmp, { recursive: true });
    const freshIndex = path.join(tmp, ".hymn_index.json");
    const summary = await writeSite({ siteDir: tmp, indexPath: freshIndex });
    const stale = staleFiles(tmp, SITE_DIR);
    if (!fs.existsSync(HYMN_INDEX_PATH)) stale.push("server/app/data/hymn_index.json (missing — not committed)");
    else if (!fs.readFileSync(freshIndex).equals(fs.readFileSync(HYMN_INDEX_PATH))) stale.push("server/app/data/hymn_index.json (differs)");
    if (stale.length) {
      failed = true;
      console.error(`The committed pages are out of date. Run \`node tools/blog/build.mjs\` and commit the result:\n  - ${stale.join("\n  - ")}`);
    }
    const errors = [...checkSite(tmp), ...(await checkPdfs(tmp))];
    if (errors.length) {
      failed = true;
      console.error(`${errors.length} problem${errors.length === 1 ? "" : "s"} in the built site:\n  - ${errors.join("\n  - ")}`);
    }
    if (!failed) console.log(`OK: ${summary.posts} posts, ${summary.hymns} hymns, ${summary.occasions} occasions, ${summary.people} people, ${summary.pdfs} PDFs; output up to date; links, JSON-LD, sitemap, feed and PDFs check out.`);
  } catch (e) {
    failed = true;
    console.error(`Check failed: ${e.message}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
}
