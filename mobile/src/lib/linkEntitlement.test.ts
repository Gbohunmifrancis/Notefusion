import { test } from "node:test";
import assert from "node:assert/strict";
import { linkEntitlement } from "./linkEntitlement.ts";

const free = { isPro: false, credits: 1, creditsTotal: 1, boughtRemaining: 0 };
const pro = { isPro: true, credits: 12, creditsTotal: 20, boughtRemaining: 0 };

test("a free account with its preview left sends, saying what the preview is", () => {
  assert.deepEqual(linkEntitlement(free), {
    kind: "send",
    line: "Free preview: the first 60 seconds of one song. Buy the whole song, or go Pro.",
  });
});

test("a used preview with no bought song offers to buy this one instead of Transcribe", () => {
  assert.deepEqual(linkEntitlement({ ...free, credits: 0 }), { kind: "buy", reason: "Your free preview is used." });
});

test("a bought song pays for the link even with the preview used", () => {
  assert.equal(linkEntitlement({ ...free, credits: 0, boughtRemaining: 1 }).kind, "send");
});

test("Pro sends while songs are left and is offered nothing to buy once they are used", () => {
  assert.deepEqual(linkEntitlement(pro), { kind: "send", line: "Uses 1 of your 12 songs left this month" });
  assert.deepEqual(linkEntitlement({ ...pro, credits: 0 }), { kind: "full", reason: "All 20 of this month's songs are used." });
  // Pro reads the month's songs alone, as the line always has.
  assert.equal(linkEntitlement({ ...pro, credits: 0, boughtRemaining: 2 }).kind, "full");
  assert.deepEqual(linkEntitlement({ ...pro, credits: undefined, creditsTotal: undefined }), {
    kind: "send",
    line: "Pro: 20 songs a month, in the fast lane.",
  });
});
