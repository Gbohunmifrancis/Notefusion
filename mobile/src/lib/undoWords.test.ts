import { test } from "node:test";
import assert from "node:assert/strict";
import { deletedLine, dohNowLine, HYMNBOOK_IN_LINE, movedLine } from "./undoWords.ts";

test("the doh and hymnbook toasts say what is on screen now", () => {
  assert.equal(dohNowLine("D"), "Doh is D now");
  assert.equal(dohNowLine("Bb"), "Doh is Bb now");
  assert.equal(HYMNBOOK_IN_LINE, "Hymnbook version in");
});

test("a delete names the one sheet, or counts several", () => {
  assert.equal(deletedLine(["Abide with Me"]), "“Abide with Me” deleted");
  assert.equal(deletedLine(["a", "b", "c"]), "3 sheets deleted");
});

test("a transposition says which way, how far and to what key", () => {
  assert.equal(movedLine(2, "A major"), "Moved up 2, to A");
  assert.equal(movedLine(-3, "Eb major"), "Moved down 3, to Eb");
  assert.equal(movedLine(1, "F# minor"), "Moved up 1, to F# minor");
});
