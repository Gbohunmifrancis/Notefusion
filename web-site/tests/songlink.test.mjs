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
  assert.deepEqual(extract("Check this out https://youtu.be/dQw4w9WgXcQ, great tune"), { url: "https://youtu.be/dQw4w9WgXcQ" });
  assert.deepEqual(
    extract("Listen to Never Gonna Give You Up on Spotify: https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc."),
    { url: "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc" },
  );
  assert.deepEqual(extract("(https://www.instagram.com/reel/C9xYz12AbCd/)"), { url: "https://www.instagram.com/reel/C9xYz12AbCd/" });
  assert.equal(extract("just words"), null);
  assert.equal(extract("https://."), null);
});

test("a link typed without https:// is read as https, as the worker, the API and the phone do", () => {
  assert.deepEqual(extract("youtube.com/watch?v=dQw4w9WgXcQ"), { url: "https://youtube.com/watch?v=dQw4w9WgXcQ" });
  assert.deepEqual(extract("Sing this: m.youtube.com/watch?v=dQw4w9WgXcQ"), { url: "https://m.youtube.com/watch?v=dQw4w9WgXcQ" });
  assert.deepEqual(extract("youtu.be/dQw4w9WgXcQ."), { url: "https://youtu.be/dQw4w9WgXcQ" });
  assert.deepEqual(extract("(music.apple.com/gb/song/1559885424)"), { url: "https://music.apple.com/gb/song/1559885424" });
  assert.deepEqual(extract("Watch this vm.tiktok.com/ZMabc123/"), { url: "https://vm.tiktok.com/ZMabc123/" });
  // Without a scheme, only the services' own hosts read as links.
  assert.equal(extract("notyoutube.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(extract("example.com/watch?v=dQw4w9WgXcQ"), null);
});

test("any link is sent on: whether it is a song is the server's to say", () => {
  for (const url of [
    "https://www.youtube.com/@RickAstleyYT",
    "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
    "https://www.tiktok.com/@singer",
    "https://example.com/song",
    // Shapes an older copy of the rule turned away that the worker reads.
    "https://www.youtube.com/v/dQw4w9WgXcQ",
    "https://music.apple.com/gb/song/1559885424",
  ]) assert.deepEqual(extract(url), { url }, url);
  assert.match(hint(), /^Paste a link to a YouTube or Instagram video/);
});

test("a lookup refused only for now keeps Transcribe, as the phone's lookupNotNow and the API's SongSections.IsForGood", () => {
  const { notNow, NOT_NOW, GRACE_MS } = window.NfSongLink;
  assert.equal(notNow("TRANS_LINK_REFUSED"), true);
  assert.equal(notNow("TRANS_LINK_POST_REFUSED"), true);
  for (const code of ["TRANS_LINK_NOT_FOUND", "TRANS_LINK_UNAVAILABLE", "TRANS_LINK_LIVE", "TRANS_LINK_TOO_LONG", "TRANS_INVALID_LINK", undefined]) {
    assert.equal(notNow(code), false, String(code));
  }
  assert.match(NOT_NOW, /Transcribe still tries it/);
  assert.equal(GRACE_MS, 6000);
});
