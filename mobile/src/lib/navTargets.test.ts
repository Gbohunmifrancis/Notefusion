import { test } from "node:test";
import assert from "node:assert/strict";
import { TAB_ORDER, isTab, notificationTarget } from "./navTargets.ts";

test("five tabs, Record in the middle, Practice and Hymns as tabs, no Profile or Songs cell", () => {
  assert.deepEqual([...TAB_ORDER], ["Home", "Library", "Record", "Practice", "Hymns"]);
  assert.equal(TAB_ORDER.length % 2, 1);
  assert.equal(TAB_ORDER[(TAB_ORDER.length - 1) / 2], "Record");
  assert.ok(isTab("Practice"));
  assert.ok(isTab("Hymns"));
  assert.equal(isTab("Profile"), false);
  assert.equal(isTab("Settings"), false);
});

test("a practice reminder opens the Practice tab, and the record nudge the Record tab", () => {
  assert.deepEqual(notificationTarget("Practice"), { kind: "tab", tab: "Practice" });
  assert.deepEqual(notificationTarget("Record"), { kind: "tab", tab: "Record" });
});

test("the other screens the server sends keep their routes, and an update goes to the store", () => {
  assert.deepEqual(notificationTarget("Upgrade"), { kind: "route", route: "Upgrade" });
  assert.deepEqual(notificationTarget("AdminPayments"), { kind: "route", route: "AdminPayments" });
  assert.deepEqual(notificationTarget("AdminWebhooks"), { kind: "route", route: "AdminWebhooks" });
  assert.deepEqual(notificationTarget("AppUpdate"), { kind: "store" });
});

test("anything else is ignored, including names off the object's prototype", () => {
  for (const screen of ["Profile", "Settings", "Hymns", "toString", "__proto__", "constructor", "", 3, null, undefined]) {
    assert.equal(notificationTarget(screen), null, String(screen));
  }
});
