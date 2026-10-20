import { test } from "node:test";
import assert from "node:assert/strict";
import { putBack, takeOut, withoutHeld } from "./heldDelete.ts";

const list = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
const ids = (l: readonly { id: string }[]) => l.map((t) => t.id).join("");

test("deleted sheets are taken out with their places, in list order", () => {
  const removed = takeOut(list, new Set(["d", "b"]));
  assert.deepEqual(
    removed.map((r) => [r.item.id, r.index]),
    [["b", 1], ["d", 3]],
  );
});

test("Undo puts each sheet back exactly where it was", () => {
  const removed = takeOut(list, new Set(["a", "c", "e"]));
  const left = list.filter((t) => !["a", "c", "e"].includes(t.id));
  assert.equal(ids(putBack(left, removed)), "abcde");
});

test("Undo before a row has folded away lists it once", () => {
  const removed = takeOut(list, new Set(["b"]));
  assert.equal(ids(putBack(list, removed)), "abcde");
  // Half gone: one already dropped, one still folding.
  const both = takeOut(list, new Set(["b", "d"]));
  assert.equal(ids(putBack(list.filter((t) => t.id !== "b"), both)), "abcde");
});

test("a list that shrank meanwhile takes them back at its end", () => {
  const removed = takeOut(list, new Set(["e"]));
  assert.equal(ids(putBack([{ id: "a" }], removed)), "ae");
});

test("a list read during the hold leaves the held sheets out", () => {
  assert.equal(ids(withoutHeld(list, new Set(["c"]))), "abde");
  assert.equal(ids(withoutHeld(list, new Set())), "abcde");
});
