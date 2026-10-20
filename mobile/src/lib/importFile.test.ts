import { test } from "node:test";
import assert from "node:assert/strict";
import { canImport, fileExtension, isScoreFile } from "./importFile.ts";

test("the ending is read in any case, and a dotfile has none", () => {
  assert.equal(fileExtension("Take 1.MP3"), "mp3");
  assert.equal(fileExtension("folder.v2/hymn.musicxml"), "musicxml");
  assert.equal(fileExtension("recording"), "");
  assert.equal(fileExtension(".hidden"), "");
  assert.equal(fileExtension(null), "");
});

test("recordings and scores the worker reads are sent; anything else is refused before the upload", () => {
  for (const name of ["a.wav", "a.flac", "a.ogg", "a.opus", "a.mp3", "a.m4a", "a.aac", "a.webm", "a.mp4", "a.caf", "a.weba"]) {
    assert.ok(canImport(name), name);
  }
  for (const name of ["a.mid", "a.midi", "a.xml", "a.musicxml", "a.mxl", "a.abc"]) {
    assert.ok(canImport(name), name);
    assert.ok(isScoreFile(name), name);
  }
  assert.ok(canImport("voice note"), "no ending: sent as a recording");
  assert.equal(canImport("Hymns.pdf"), false);
  assert.equal(canImport("photo.jpg"), false);
  assert.equal(isScoreFile("song.mp3"), false);
});
