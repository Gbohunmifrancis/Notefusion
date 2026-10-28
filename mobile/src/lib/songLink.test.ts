import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LOOKUP_GRACE_MS,
  NOT_NOW_LINE,
  asProvider,
  extractSongUrl,
  fetchesItsOwnVideo,
  firstUrl,
  lookupNotNow,
  serviceOf,
  songLinkHint,
} from "./songLink.ts";

test("first link in share text, trailing punctuation trimmed", () => {
  assert.equal(
    firstUrl("Listen to Amazing Grace on Spotify: https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc."),
    "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc",
  );
  assert.equal(firstUrl("see (https://youtu.be/dQw4w9WgXcQ)!"), "https://youtu.be/dQw4w9WgXcQ");
  assert.equal(firstUrl("https://youtu.be/dQw4w9WgXcQ…"), "https://youtu.be/dQw4w9WgXcQ");
  assert.equal(firstUrl("https://."), null);
  assert.equal(firstUrl("no link here"), null);
  assert.equal(firstUrl(""), null);
});

test("a link typed without https:// is read as https, as the worker, the API and the web do", () => {
  assert.equal(firstUrl("youtube.com/watch?v=dQw4w9WgXcQ"), "https://youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(firstUrl("Sing this: m.youtube.com/watch?v=dQw4w9WgXcQ"), "https://m.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(firstUrl("youtu.be/dQw4w9WgXcQ."), "https://youtu.be/dQw4w9WgXcQ");
  assert.equal(firstUrl("(music.apple.com/gb/song/1559885424)"), "https://music.apple.com/gb/song/1559885424");
  assert.equal(firstUrl("Watch this vm.tiktok.com/ZMabc123/"), "https://vm.tiktok.com/ZMabc123/");
  // Without a scheme, only the services' own hosts read as links.
  assert.equal(firstUrl("notyoutube.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(firstUrl("example.com/watch?v=dQw4w9WgXcQ"), null);
});

test("any link is looked up: whether it is a song is the server's to say", () => {
  assert.deepEqual(
    extractSongUrl("Check this out https://youtu.be/dQw4w9WgXcQ, great tune"),
    { url: "https://youtu.be/dQw4w9WgXcQ", provider: "youtube" },
  );
  // Not songs, but sent all the same; the server turns them away in its own words.
  assert.deepEqual(extractSongUrl("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"), {
    url: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
    provider: "spotify",
  });
  assert.deepEqual(extractSongUrl("https://example.com/song"), { url: "https://example.com/song", provider: null });
  // Shapes an older copy of the rule turned away that the worker reads.
  assert.deepEqual(extractSongUrl("https://www.youtube.com/v/dQw4w9WgXcQ"), { url: "https://www.youtube.com/v/dQw4w9WgXcQ", provider: "youtube" });
  assert.equal(extractSongUrl("just words"), null);
  assert.equal(extractSongUrl(null), null);
  assert.match(songLinkHint(), /^Paste a link to a YouTube, Instagram or TikTok video/);
});

test("a link's service is read off its host, for its mark only", () => {
  for (const [url, service] of [
    ["https://music.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"],
    ["https://youtu.be/dQw4w9WgXcQ", "youtube"],
    ["https://open.spotify.com/intl-de/track/4uLU6hMCjMI75M1A2tKUQC", "spotify"],
    ["https://spotify.link/abc123", "spotify"],
    ["https://spotify.app.link/abc123", "spotify"],
    ["https://geo.music.apple.com/gb/album/hymns/1440889800?i=1440889823", "apple_music"],
    ["https://www.instagram.com/reel/C9xYz12AbCd/", "instagram"],
    ["https://vt.tiktok.com/ZSabc123/", "tiktok"],
    ["https://m.tiktok.com/v/7312345678901234567.html", "tiktok"],
    ["https://notyoutube.com/watch?v=dQw4w9WgXcQ", null],
    ["https://apple.com/music", null],
  ] as const) assert.equal(serviceOf(url), service, url);
  assert.equal(asProvider("apple_music"), "apple_music");
  assert.equal(asProvider("soundcloud"), null);
  assert.equal(asProvider(undefined), null);
  assert.equal(fetchesItsOwnVideo("tiktok"), true);
  assert.equal(fetchesItsOwnVideo("spotify"), false);
});

test("a lookup refused only for now keeps Transcribe; one refused for good does not", () => {
  assert.equal(lookupNotNow("TRANS_LINK_REFUSED"), true);
  assert.equal(lookupNotNow("TRANS_LINK_POST_REFUSED"), true);
  for (const code of ["TRANS_LINK_NOT_FOUND", "TRANS_LINK_UNAVAILABLE", "TRANS_LINK_LIVE", "TRANS_LINK_TOO_LONG", "TRANS_INVALID_LINK", null]) {
    assert.equal(lookupNotNow(code), false, String(code));
  }
  assert.match(NOT_NOW_LINE, /Transcribe still tries it/);
  assert.equal(LOOKUP_GRACE_MS, 6000); // the web's GRACE_MS
});
