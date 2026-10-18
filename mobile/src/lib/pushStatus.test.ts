import { test } from "node:test";
import assert from "node:assert/strict";
import { notificationsValue, pushStatus, readyValue } from "./pushStatus.ts";

test("allowed and on: the mint line, and what depends on push is live", () => {
  const s = pushStatus("granted", true);
  assert.deepEqual(s, {
    on: true,
    switchable: true,
    live: true,
    line: "Your phone lets NoteFusion notify you.",
    tone: "ok",
    openSettings: false,
  });
  assert.equal(readyValue(s), "Always");
  assert.equal(notificationsValue("granted", true), "On");
});

test("blocked by the phone: said once, amber, with the way out, and the switch cannot fix it", () => {
  for (const chosen of [true, false]) {
    const s = pushStatus("denied", chosen);
    assert.equal(s.line, "Blocked in your phone's settings.");
    assert.equal(s.tone, "warn");
    assert.equal(s.openSettings, true);
    assert.equal(s.on, false);
    assert.equal(s.switchable, false);
    assert.equal(s.live, false);
    assert.equal(readyValue(s), "Off");
  }
  assert.equal(notificationsValue("denied", true), "Off");
});

test("turned off here: plain words, no settings link, the switch turns it back on", () => {
  const s = pushStatus("granted", false);
  assert.equal(s.line, "Off. You won't hear when a score is done.");
  assert.equal(s.tone, "plain");
  assert.equal(s.openSettings, false);
  assert.equal(s.switchable, true);
  assert.equal(s.live, false);
  assert.equal(readyValue(s), "Off");
  assert.equal(pushStatus("undetermined", false).line, "Off. You won't hear when a score is done.");
});

test("never asked: the switch reads off until the phone has said yes", () => {
  const s = pushStatus("undetermined", true);
  assert.equal(s.on, false);
  assert.equal(s.switchable, true);
  assert.equal(s.live, false);
  assert.equal(s.openSettings, false);
});

test("a build that cannot push, and the moment before the permission is read", () => {
  const none = pushStatus("unsupported", true);
  assert.equal(none.switchable, false);
  assert.equal(none.live, false);
  assert.equal(none.tone, "warn");
  assert.equal(none.openSettings, false);

  const checking = pushStatus(null, true);
  assert.equal(checking.line, "Checking…");
  assert.equal(checking.switchable, false);
  assert.equal(checking.on, true);
  assert.equal(notificationsValue(null, true), null);
});
