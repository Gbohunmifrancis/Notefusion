import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldShowWhatsNew } from "./whatsNew.ts";

const base = { platform: "android", seen: false, firstLaunch: false, dialogOpen: false, anywhere: true };

test("once, on Android, after the first launch, and never over another sheet", () => {
  assert.equal(shouldShowWhatsNew(base), true);
  assert.equal(shouldShowWhatsNew({ ...base, seen: true }), false);
  assert.equal(shouldShowWhatsNew({ ...base, platform: "ios" }), false);
  assert.equal(shouldShowWhatsNew({ ...base, firstLaunch: true }), false);
  assert.equal(shouldShowWhatsNew({ ...base, dialogOpen: true }), false);
});

test("not on a store build without Listen from anywhere, so it is still unseen when that build arrives", () => {
  assert.equal(shouldShowWhatsNew({ ...base, anywhere: false }), false);
});
