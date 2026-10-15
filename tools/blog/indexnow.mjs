#!/usr/bin/env node
// Tells IndexNow (Bing, Yandex, Seznam, Naver… — Google does not take part) which blog and hymn
// pages a push added, changed or removed, so they are recrawled within hours instead of days.
// Run by .github/workflows/deploy-web.yml after a successful deploy:
//
//   node tools/blog/indexnow.mjs <before-sha> <after-sha>     ping the pages changed between two commits
//   node tools/blog/indexnow.mjs --dry-run <before> <after>   print them without pinging
//
// Needs only Node and git (no npm install). Best effort: a failed ping is a warning, never a
// failed deploy. The key is public by design and served at /<key>.txt.
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

export function payload(urls) {
  return { host: new URL(ORIGIN).host, key: INDEXNOW_KEY, keyLocation: `${ORIGIN}/${INDEXNOW_KEY}.txt`, urlList: urls };
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args[0] === "--dry-run";
  const [before, after] = dry ? args.slice(1) : args;
  if (!before || /^0+$/.test(before) || !after) { console.log("IndexNow: no previous commit to compare with; nothing to ping."); return; }
  let changed;
  try {
    changed = execFileSync("git", ["diff", "--name-only", before, after, "--", "web-site/blog", "web-site/hymns"], { cwd: REPO_ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  } catch (e) {
    console.log(`::warning::IndexNow: could not compare ${before}..${after} (${e.message.split("\n")[0]}); nothing pinged.`);
    return;
  }
  const urls = urlsFromChangedFiles(changed);
  if (!urls.length) { console.log("IndexNow: no blog or hymn pages changed."); return; }
  console.log(`IndexNow: ${urls.length} page${urls.length === 1 ? "" : "s"}:\n  ${urls.join("\n  ")}`);
  if (dry) return;
  try {
    const res = await fetch("https://api.indexnow.org/indexnow", { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(payload(urls.slice(0, 10000))) });
    // 200 and 202 are both success; 403 means the key file is not live yet, 422 a URL outside the host.
    if (res.status === 200 || res.status === 202) console.log(`IndexNow accepted the ping (${res.status}).`);
    else console.log(`::warning::IndexNow answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  } catch (e) {
    console.log(`::warning::IndexNow ping failed: ${e.message}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
