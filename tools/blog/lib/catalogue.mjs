// /blog/catalogue.json: what the API needs to know about the site to check and draft posts. The hymns with
// their opening line exactly as NoteFusion's engine writes it (the only solfa the Gemini drafter may cite),
// every page path (internal links in a post must resolve), and the author ids. Written by the deploy-time
// build only (`build.mjs --api`), so it is never committed and never stale; the API reads it from the live site.
import fs from "node:fs";
import path from "node:path";
import { lineText, lineWords } from "./solfa.mjs";

/** Every page a visitor can open, as site paths (cleanUrls: /privacy.html is /privacy, /blog/index.html is /blog). */
export function sitePages(siteDir, generated) {
  const pages = new Set();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const rel = path.relative(siteDir, full).split(path.sep).join("/");
      if (e.isDirectory()) {
        if (rel === "blog" || rel === "hymns" || rel === "assets" || rel.startsWith(".") || rel === "node_modules") continue;
        walk(full);
      } else if (e.name.endsWith(".html")) pages.add(toPath(rel));
    }
  };
  walk(siteDir);
  for (const rel of generated) if (rel.endsWith(".html")) pages.add(toPath(rel));
  return [...pages].sort();
}

function toPath(rel) {
  const p = "/" + rel.replace(/(^|\/)index\.html$/, "").replace(/\.html$/, "");
  return p.length > 1 ? p.replace(/\/$/, "") : "/";
}

export function catalogueJson({ hymns, authors, pages }) {
  return JSON.stringify({
    version: 1,
    authors: Object.keys(authors).sort(),
    hymns: hymns.map((h) => {
      const first = h.view.lines[0];
      return {
        slug: h.slug,
        title: h.title,
        shortTitle: h.shortTitle || null,
        // Imported from the Open Hymnal Project rather than encoded by hand: the drafter spells out only the
        // hand-made hymns (and any the topic links to), so the prompt does not grow with the library.
        imported: !!h.importedFrom,
        key: h.view.key,
        header: h.view.header,
        time: h.view.time,
        bars: h.view.lines.flat().length,
        firstLine: { bars: first.length, solfa: lineText(first), words: lineWords(first) },
      };
    }),
    pages,
  }, null, 2) + "\n";
}
