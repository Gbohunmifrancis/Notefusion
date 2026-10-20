import { test } from "node:test";
import assert from "node:assert/strict";
import { recentReveal } from "./homeReveal.ts";

test("the skeleton stays until the list has answered", () => {
  assert.equal(recentReveal({ listIn: false, cardIn: true, timedOut: true }), "wait");
  assert.equal(recentReveal({ listIn: false, cardIn: false, timedOut: false }), "wait");
});

test("with both in, the rows and Doh's card arrive together", () => {
  assert.equal(recentReveal({ listIn: true, cardIn: true, timedOut: false }), "rows-and-card");
  assert.equal(recentReveal({ listIn: true, cardIn: true, timedOut: true }), "rows-and-card");
});

test("the list in but the progress late: wait, then the rows alone after 1.5 s", () => {
  assert.equal(recentReveal({ listIn: true, cardIn: false, timedOut: false }), "wait");
  assert.equal(recentReveal({ listIn: true, cardIn: false, timedOut: true }), "rows");
});
