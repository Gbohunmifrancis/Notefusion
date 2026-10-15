import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { urlsFromChangedFiles, payload } from "../indexnow.mjs";
import { INDEXNOW_KEY, SITE_DIR } from "../lib/site.mjs";

test("changed blog and hymn pages become URLs; tag pages, feeds and other files do not", () => {
  const urls = urlsFromChangedFiles([
    "web-site/blog/index.html",
    "web-site/blog/how-to-read-tonic-solfa/index.html",
    "web-site/blog/tag/choir/index.html",
    "web-site/blog/feed.xml",
    "web-site/hymns/amazing-grace/index.html",
    "web-site/hymns/index.html",
    "web-site/index.html",
    "web-site/assets/blog.css",
  ]);
  assert.deepEqual(urls, [
    "https://notefusion.studio/blog",
    "https://notefusion.studio/blog/how-to-read-tonic-solfa",
    "https://notefusion.studio/hymns",
    "https://notefusion.studio/hymns/amazing-grace",
  ]);
});

test("the ping names the host and the key file that proves it", () => {
  const p = payload(["https://notefusion.studio/blog"]);
  assert.equal(p.host, "notefusion.studio");
  assert.equal(p.keyLocation, `https://notefusion.studio/${INDEXNOW_KEY}.txt`);
  assert.match(INDEXNOW_KEY, /^[0-9a-f]{32}$/);
  assert.equal(fs.readFileSync(path.join(SITE_DIR, `${INDEXNOW_KEY}.txt`), "utf8").trim(), INDEXNOW_KEY);
});
