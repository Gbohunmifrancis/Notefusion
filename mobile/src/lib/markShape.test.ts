import { test } from "node:test";
import assert from "node:assert/strict";
import { FOCUSED_MARK_LEGEND, PLAYFUL_MARK_LEGEND, markGlyph, markLabel } from "./markShape.ts";

test("every mark carries a shape: ✓ in tune, ~ close, – not sung; off the note is struck through instead", () => {
  assert.equal(markGlyph("hit"), "✓");
  assert.equal(markGlyph("near"), "~");
  assert.equal(markGlyph("missed"), "–");
  assert.equal(markGlyph("wrong"), "");
});

test("Focused marks are said with their cents, sharp or flat", () => {
  assert.equal(markLabel("d", "hit", 6), "d: in tune, 6 cents sharp");
  assert.equal(markLabel("m", "hit", -12.4), "m: in tune, 12 cents flat");
  assert.equal(markLabel("s", "near", 1), "s: close, 1 cent sharp");
  assert.equal(markLabel("m", "wrong", 190), "m: off the note, 190 cents sharp");
  assert.equal(markLabel("d", "hit", 0.2), "d: in tune");
  assert.equal(markLabel("s,", "missed", null), "s,: not sung");
});

test("Playful marks are said in its own words, without cents", () => {
  assert.equal(markLabel("d", "hit", 6, true), "d: spot on");
  assert.equal(markLabel("m", "wrong", 190, true), "m: try again");
  assert.equal(markLabel("s,", "missed", null, true), "s,: not heard");
});

test("the legends name the shapes, and Playful's never says red", () => {
  for (const legend of [FOCUSED_MARK_LEGEND, PLAYFUL_MARK_LEGEND]) {
    assert.match(legend, /✓/);
    assert.match(legend, /struck through/);
    assert.match(legend, /dashed/);
    assert.doesNotMatch(legend, /red/i);
  }
});
