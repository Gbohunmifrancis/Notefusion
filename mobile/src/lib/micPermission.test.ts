import { test } from "node:test";
import assert from "node:assert/strict";
import { onlySettingsCanGrant } from "./micPermission.ts";

test("Open settings shows only when the phone will no longer ask", () => {
  assert.equal(onlySettingsCanGrant({ granted: false, canAskAgain: false }), true);
  assert.equal(onlySettingsCanGrant({ granted: false, canAskAgain: true }), false);
  assert.equal(onlySettingsCanGrant({ granted: true, canAskAgain: false }), false);
  assert.equal(onlySettingsCanGrant({ granted: true, canAskAgain: true }), false);
});
