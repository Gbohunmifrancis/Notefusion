import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSongUrl, firstUrl, providerOf, songLinkHint } from "./songLink.ts";

test("first link in share text, trailing punctuation trimmed", () => {
  assert.equal(
    firstUrl("Listen to Amazing Grace on Spotify: https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc."),
    "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc",
  );
  assert.equal(firstUrl("see (https://youtu.be/dQw4w9WgXcQ)!"), "https://youtu.be/dQw4w9WgXcQ");
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
