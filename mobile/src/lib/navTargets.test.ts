import { test } from "node:test";
import assert from "node:assert/strict";
import { ADMIN_TAB_ORDER, TAB_ORDER, isAdminScreen, isTab, notificationTarget } from "./navTargets.ts";

test("five tabs, Record in the middle, Practice and Hymns as tabs, no Profile or Songs cell", () => {
  assert.deepEqual([...TAB_ORDER], ["Home", "Library", "Record", "Practice", "Hymns"]);
  assert.equal(TAB_ORDER.length % 2, 1);
  assert.equal(TAB_ORDER[(TAB_ORDER.length - 1) / 2], "Record");
  assert.ok(isTab("Practice"));
  assert.ok(isTab("Hymns"));
  assert.equal(isTab("Profile"), false);
  assert.equal(isTab("Settings"), false);
});

test("the admin's own bar: Overview, Payments, Users, Health, More", () => {
  assert.deepEqual([...ADMIN_TAB_ORDER], ["Overview", "Payments", "Users", "Health", "More"]);
  assert.equal(isTab("Payments"), false, "an admin cell is never a customer tab");
});

test("a practice reminder opens the Practice tab, and the record nudge the Record tab", () => {
  assert.deepEqual(notificationTarget("Practice"), { kind: "tab", tab: "Practice" });
  assert.deepEqual(notificationTarget("Record"), { kind: "tab", tab: "Record" });
});

test("the other screens the server sends keep their places, and an update goes to the store", () => {
  assert.deepEqual(notificationTarget("Upgrade"), { kind: "route", route: "Upgrade" });
  assert.deepEqual(notificationTarget("AppUpdate"), { kind: "store" });
});

test("a payment push opens that payment over Payments, for an admin", () => {
  const id = "5f0c6a1e-3b7d-4c8e-9a12-0b1c2d3e4f50";
  assert.deepEqual(notificationTarget("AdminPayment", { isAdmin: true, paymentId: id }), {
    kind: "admin",
    tab: "Payments",
    paymentId: id,
  });
  // A summary of several, the test alert and the problem alerts open the list.
  assert.deepEqual(notificationTarget("AdminPayments", { isAdmin: true }), { kind: "admin", tab: "Payments" });
  assert.deepEqual(notificationTarget("AdminWebhooks", { isAdmin: true }), {
    kind: "admin",
    tab: "Payments",
    view: "webhooks",
  });
  // A payment id that is not one is not followed into the sheet.
  for (const paymentId of ["../users", "", 42, null, "5f0c6a1e"]) {
    assert.deepEqual(notificationTarget("AdminPayment", { isAdmin: true, paymentId }), { kind: "admin", tab: "Payments" });
  }
});

test("a sign-up or transcription push opens that account, or Users for several, for an admin", () => {
  const id = "0b1c2d3e-4f50-4c8e-9a12-5f0c6a1e3b7d";
  assert.deepEqual(notificationTarget("AdminUser", { isAdmin: true, userId: id }), { kind: "adminUser", userId: id });
  assert.deepEqual(notificationTarget("AdminUsers", { isAdmin: true }), { kind: "admin", tab: "Users" });
  // An id that is not one opens the list, never a guessed route.
  for (const userId of ["../payments", "", 7, null, undefined]) {
    assert.deepEqual(notificationTarget("AdminUser", { isAdmin: true, userId }), { kind: "admin", tab: "Users" });
  }
});

test("an admin target resolves for nobody else: a customer's phone is never sent into Admin", () => {
  for (const screen of ["AdminPayment", "AdminPayments", "AdminWebhooks", "AdminUser", "AdminUsers"]) {
    assert.equal(notificationTarget(screen), null, screen);
    assert.equal(notificationTarget(screen, { isAdmin: false, paymentId: "5f0c6a1e-3b7d-4c8e-9a12-0b1c2d3e4f50" }), null, screen);
    assert.ok(isAdminScreen(screen), screen);
  }
  assert.equal(isAdminScreen("Practice"), false);
  assert.equal(isAdminScreen("toString"), false);
});

test("anything else is ignored, including names off the object's prototype", () => {
  for (const screen of ["Profile", "Settings", "Hymns", "Admin", "AdminAlerts", "toString", "__proto__", "constructor", "", 3, null, undefined]) {
    assert.equal(notificationTarget(screen, { isAdmin: true }), null, String(screen));
  }
});
