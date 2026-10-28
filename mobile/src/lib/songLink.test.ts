import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSongUrl, fetchesItsOwnVideo, firstUrl, providerOf, songLinkHint } from "./songLink.ts";

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

test("YouTube: any subdomain, watch/shorts/live/embed, youtu.be", () => {
  assert.equal(providerOf("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10"), "youtube");
  assert.equal(providerOf("https://music.youtube.com/watch?v=dQw4w9WgXcQ"), "youtube");
  assert.equal(providerOf("https://m.youtube.com/shorts/dQw4w9WgXcQ"), "youtube");
  assert.equal(providerOf("https://youtube.com/live/dQw4w9WgXcQ"), "youtube");
  assert.equal(providerOf("https://www.youtube.com/embed/dQw4w9WgXcQ"), "youtube");
  assert.equal(providerOf("https://youtu.be/dQw4w9WgXcQ?si=x"), "youtube");
  assert.equal(providerOf("https://www.youtube.com/watch?v=short"), null);
  assert.equal(providerOf("https://www.youtube.com/playlist?list=PL123"), null);
  assert.equal(providerOf("https://www.youtube.com/@channel"), null);
  assert.equal(providerOf("https://notyoutube.com/watch?v=dQw4w9WgXcQ"), null);
});

test("Spotify: tracks (with intl path), short links; not albums or playlists", () => {
  assert.equal(providerOf("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"), "spotify");
  assert.equal(providerOf("https://open.spotify.com/intl-de/track/4uLU6hMCjMI75M1A2tKUQC?si=1"), "spotify");
  assert.equal(providerOf("https://open.spotify.com/intl-pt-br/track/4uLU6hMCjMI75M1A2tKUQC"), "spotify");
  assert.equal(providerOf("https://spotify.link/abc123"), "spotify");
  assert.equal(providerOf("https://spotify.app.link/abc123"), "spotify");
  assert.equal(providerOf("https://open.spotify.com/album/1A2B3C"), null);
  assert.equal(providerOf("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"), null);
  assert.equal(providerOf("https://spotify.link/"), null);
});

test("Apple Music: song pages, album links with i=, geo host", () => {
  assert.equal(providerOf("https://music.apple.com/us/song/amazing-grace/1440889823"), "apple_music");
  assert.equal(providerOf("https://music.apple.com/ng/album/hymns/1440889800?i=1440889823"), "apple_music");
  assert.equal(providerOf("https://geo.music.apple.com/gb/album/hymns/1440889800?i=1440889823&ls=1"), "apple_music");
  assert.equal(providerOf("https://music.apple.com/us/album/hymns/1440889800"), null);
  assert.equal(providerOf("https://music.apple.com/us/artist/someone/123"), null);
  assert.equal(providerOf("https://music.apple.com/song/1440889823"), null);
});

test("extractSongUrl returns the link to send, or null", () => {
  assert.deepEqual(
    extractSongUrl("Check this out https://youtu.be/dQw4w9WgXcQ, great tune"),
    { url: "https://youtu.be/dQw4w9WgXcQ", provider: "youtube" },
  );
  assert.equal(extractSongUrl("https://example.com/song"), null);
  assert.equal(extractSongUrl("just words"), null);
  assert.equal(extractSongUrl(null), null);
});

test("the hint tells a wrong link from no link", () => {
  assert.match(songLinkHint("https://open.spotify.com/album/1"), /isn't a single song/);
  assert.match(songLinkHint("hello"), /^Paste a link/);
});

test("a link typed without https:// is read as https, as the worker, the API and the web do", () => {
  assert.equal(firstUrl("youtube.com/watch?v=dQw4w9WgXcQ"), "https://youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(firstUrl("Sing this: m.youtube.com/watch?v=dQw4w9WgXcQ"), "https://m.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(firstUrl("youtu.be/dQw4w9WgXcQ."), "https://youtu.be/dQw4w9WgXcQ");
  assert.deepEqual(extractSongUrl("open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT"), {
    url: "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT",
    provider: "spotify",
  });
  assert.deepEqual(extractSongUrl("(music.apple.com/gb/song/1559885424)"), {
    url: "https://music.apple.com/gb/song/1559885424",
    provider: "apple_music",
  });
  assert.equal(firstUrl("notyoutube.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(firstUrl("example.com/watch?v=dQw4w9WgXcQ"), null);
  assert.match(songLinkHint("youtube.com/@RickAstleyYT"), /isn't a single song/);
});

test("Instagram reels and posts and TikTok videos, as the worker, the API and the web read them", () => {
  for (const url of [
    "https://www.instagram.com/reel/C9xYz12AbCd/?igsh=abc",
    "https://instagram.com/reels/C9xYz12AbCd/",
    "https://www.instagram.com/p/C9xYz12AbCd/",
    "https://www.instagram.com/someone/reel/C9xYz12AbCd/",
  ]) assert.equal(providerOf(url), "instagram", url);
  for (const url of [
    "https://www.tiktok.com/@singer/video/7312345678901234567?is_from_webapp=1",
    "https://vm.tiktok.com/ZMabc123/",
    "https://vt.tiktok.com/ZSabc123/",
    "https://www.tiktok.com/t/ZTabc123/",
    "https://m.tiktok.com/v/7312345678901234567.html",
  ]) assert.equal(providerOf(url), "tiktok", url);
  for (const url of [
    "https://www.instagram.com/someone/",
    "https://www.instagram.com/explore/tags/choir/",
    "https://www.tiktok.com/@singer",
    "https://www.tiktok.com/music/original-sound-7312345678901234567",
    "https://vm.tiktok.com/",
  ]) assert.equal(providerOf(url), null, url);
  assert.deepEqual(extractSongUrl("Watch this vm.tiktok.com/ZMabc123/"), { url: "https://vm.tiktok.com/ZMabc123/", provider: "tiktok" });
  assert.equal(fetchesItsOwnVideo("tiktok"), true);
  assert.equal(fetchesItsOwnVideo("spotify"), false);
});
