import { test } from "node:test";
import assert from "node:assert/strict";
import { audioRefused, canImport, fileExtension, isScoreFile } from "./importFile.ts";

test("audio the API could not read, or heard no notes in, is recorded again rather than resent", () => {
  assert.equal(audioRefused("UNSUPPORTED_MEDIA"), true);
  assert.equal(audioRefused("INVALID_AUDIO"), true);
  for (const code of ["NETWORK_OFFLINE", "SERVER_ERROR", "JOB_LOST", null, undefined]) assert.equal(audioRefused(code), false, String(code));
});

test("the ending is read in any case, and a dotfile has none", () => {
  assert.equal(fileExtension("Take 1.MP3"), "mp3");
  assert.equal(fileExtension("folder.v2/hymn.musicxml"), "musicxml");
  assert.equal(fileExtension("recording"), "");
  assert.equal(fileExtension(".hidden"), "");
  assert.equal(fileExtension(null), "");
});

test("recordings and scores the worker reads are sent; anything else is refused before the upload", () => {
  for (const name of ["a.wav", "a.flac", "a.ogg", "a.opus", "a.mp3", "a.m4a", "a.aac", "a.webm", "a.mp4", "a.mov", "a.caf", "a.weba"]) {
    assert.ok(canImport(name), name);
  }
  // A photo or PDF of printed music is a score: the worker reads the tune off the page.
  for (const name of ["a.mid", "a.midi", "a.xml", "a.musicxml", "a.mxl", "a.abc", "Hymn 135.JPG", "a.jpeg", "a.png", "a.webp", "Hymns.pdf"]) {
    assert.ok(canImport(name), name);
    assert.ok(isScoreFile(name), name);
  }
  assert.ok(canImport("voice note"), "no ending: sent as a recording");
  assert.equal(canImport("notes.docx"), false);
  assert.equal(canImport("photo.heic"), false);
  assert.equal(isScoreFile("song.mp3"), false);
});
