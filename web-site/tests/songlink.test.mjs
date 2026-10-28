// node --test web-site/tests/*.test.mjs
// songlink.js is a plain browser script that sets window.NfSongLink; its top level touches only `window`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInNewContext(readFileSync(new URL("../assets/songlink.js", import.meta.url), "utf8"), { window, URL });
const { hint } = window.NfSongLink;
// A plain copy: the script's objects come from another realm, which strict deepEqual tells apart.
const extract = (text) => { const found = window.NfSongLink.extract(text); return found && { ...found }; };

test("the first link in share text, its punctuation trimmed", () => {
  assert.deepEqual(extract("Check this out https://youtu.be/dQw4w9WgXcQ, great tune"), {
    url: "https://youtu.be/dQw4w9WgXcQ",
    provider: "youtube",
  });
  assert.equal(extract("https://example.com/song"), null);
  assert.equal(extract("just words"), null);
});

test("a link typed without https:// is read as https, as the worker, the API and the phone do", () => {
  assert.deepEqual(extract("youtube.com/watch?v=dQw4w9WgXcQ"), { url: "https://youtube.com/watch?v=dQw4w9WgXcQ", provider: "youtube" });
  assert.deepEqual(extract("Sing this: m.youtube.com/watch?v=dQw4w9WgXcQ"), { url: "https://m.youtube.com/watch?v=dQw4w9WgXcQ", provider: "youtube" });
  assert.deepEqual(extract("youtu.be/dQw4w9WgXcQ."), { url: "https://youtu.be/dQw4w9WgXcQ", provider: "youtube" });
  assert.deepEqual(extract("open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT"), {
    url: "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT",
    provider: "spotify",
  });
  assert.deepEqual(extract("(music.apple.com/gb/song/1559885424)"), { url: "https://music.apple.com/gb/song/1559885424", provider: "apple_music" });
  assert.equal(extract("notyoutube.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(extract("example.com/watch?v=dQw4w9WgXcQ"), null);
  assert.match(hint("youtube.com/@RickAstleyYT"), /isn't a single song/);
  assert.match(hint("hello"), /^Paste a link/);
});

test("Instagram reels and posts and TikTok videos are links we read, as the worker, the API and the phone do", () => {
  for (const url of [
    "https://www.instagram.com/reel/C9xYz12AbCd/?igsh=abc",
    "https://instagram.com/reels/C9xYz12AbCd/",
    "https://www.instagram.com/p/C9xYz12AbCd/",
    "https://www.instagram.com/someone/reel/C9xYz12AbCd/",
  ]) assert.equal(extract(url).provider, "instagram", url);
  for (const url of [
    "https://www.tiktok.com/@singer/video/7312345678901234567?is_from_webapp=1",
    "https://vm.tiktok.com/ZMabc123/",
    "https://vt.tiktok.com/ZSabc123/",
    "https://www.tiktok.com/t/ZTabc123/",
    "https://m.tiktok.com/v/7312345678901234567.html",
  ]) assert.equal(extract(url).provider, "tiktok", url);
  assert.deepEqual(extract("Watch this vm.tiktok.com/ZMabc123/"), { url: "https://vm.tiktok.com/ZMabc123/", provider: "tiktok" });
  assert.deepEqual(extract("instagram.com/reel/C9xYz12AbCd"), { url: "https://instagram.com/reel/C9xYz12AbCd", provider: "instagram" });
  for (const url of [
    "https://www.instagram.com/someone/",
    "https://www.instagram.com/explore/tags/choir/",
    "https://www.tiktok.com/@singer",
    "https://www.tiktok.com/music/original-sound-7312345678901234567",
    "https://vm.tiktok.com/",
  ]) assert.equal(extract(url), null, url);
  assert.match(hint("hello"), /Instagram or TikTok/);
});
