#!/usr/bin/env node
// Tells IndexNow (Bing, Yandex, Seznam, Naver… — Google does not take part) which blog and hymn
// pages a deploy added, changed or removed, so they are recrawled within hours instead of days.
// Run by .github/workflows/deploy-web.yml after a successful deploy:
//
//   node tools/blog/indexnow.mjs --sitemaps OLD NEW [<before-sha> <after-sha>]
//       ping the pages whose sitemap entry is new, gone or has a new lastmod between the live sitemap
//       fetched before the deploy (OLD) and the one just built (NEW) — this is how posts published from
//       the admin console are found, since they are built at deploy time and never committed — plus the
//       committed blog and hymn pages changed between the two commits
//   node tools/blog/indexnow.mjs <before-sha> <after-sha>     only the committed pages changed between two commits
//   --dry-run                                                  print them without pinging
//
// Needs only Node and git (no npm install). Best effort: a failed ping is a warning, never a
// failed deploy. The key is public by design and served at /<key>.txt.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { INDEXNOW_KEY, ORIGIN, REPO_ROOT } from "./lib/site.mjs";

/** Site URLs for changed files under web-site/blog and web-site/hymns (tag pages are noindex, so left out). */
export function urlsFromChangedFiles(files) {
  const urls = new Set();
  for (const f of files) {
    const m = /^web-site\/((?:blog|hymns)(?:\/.*)?)\/index\.html$/.exec(f.trim());
    if (!m || m[1].startsWith("blog/tag/")) continue;
    urls.add(`${ORIGIN}/${m[1]}`);
  }
  return [...urls].sort();
}

function entries(xml) {
  const map = new Map();
  for (const m of String(xml || "").matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = /<loc>([^<]+)<\/loc>/.exec(m[1]);
    if (!loc) continue;
    const lastmod = /<lastmod>([^<]+)<\/lastmod>/.exec(m[1]);
    map.set(loc[1].trim(), lastmod ? lastmod[1].trim() : "");
  }
  return map;
}

/** Blog and hymn URLs that are new, gone, or carry a new lastmod in `newXml` compared with `oldXml`. */
export function urlsFromSitemaps(oldXml, newXml) {
  const before = entries(oldXml), after = entries(newXml);
  const ours = (u) => /^\/(blog|hymns)(\/|$)/.test(u.slice(ORIGIN.length)) && u.startsWith(ORIGIN) && !u.includes("/blog/tag/");
  const urls = new Set();
  for (const [u, lastmod] of after) if (ours(u) && before.get(u) !== lastmod) urls.add(u);
  for (const u of before.keys()) if (ours(u) && !after.has(u)) urls.add(u);
  return [...urls].sort();
}

export function payload(urls) {
  return { host: new URL(ORIGIN).host, key: INDEXNOW_KEY, keyLocation: `${ORIGIN}/${INDEXNOW_KEY}.txt`, urlList: urls };
}

function fromGit(before, after) {
  if (!before || /^0+$/.test(before) || !after) return [];
  try {
    const changed = execFileSync("git", ["diff", "--name-only", before, after, "--", "web-site/blog", "web-site/hymns"], { cwd: REPO_ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
    return urlsFromChangedFiles(changed);
  } catch (e) {
    console.log(`::warning::IndexNow: could not compare ${before}..${after} (${e.message.split("\n")[0]}); only the sitemaps are used.`);
    return [];
  }
}

async function main() {
  let args = process.argv.slice(2);
  const dry = args.includes("--dry-run");
  args = args.filter((a) => a !== "--dry-run");
  const urls = new Set();
  const s = args.indexOf("--sitemaps");
  if (s >= 0) {
    const [oldFile, newFile] = args.slice(s + 1, s + 3);
    args.splice(s, 3);
    const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } };
    for (const u of urlsFromSitemaps(read(oldFile), read(newFile))) urls.add(u);
  }
  for (const u of fromGit(args[0], args[1])) urls.add(u);

  const list = [...urls].sort();
  if (!list.length) { console.log("IndexNow: no blog or hymn pages changed."); return; }
  console.log(`IndexNow: ${list.length} page${list.length === 1 ? "" : "s"}:\n  ${list.join("\n  ")}`);
  if (dry) return;
  try {
    const res = await fetch("https://api.indexnow.org/indexnow", { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(payload(list.slice(0, 10000))) });
    // 200 and 202 are both success; 403 means the key file is not live yet, 422 a URL outside the host.
    if (res.status === 200 || res.status === 202) console.log(`IndexNow accepted the ping (${res.status}).`);
    else console.log(`::warning::IndexNow answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  } catch (e) {
    console.log(`::warning::IndexNow ping failed: ${e.message}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
