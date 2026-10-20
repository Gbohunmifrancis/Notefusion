import { test } from "node:test";
import assert from "node:assert/strict";
import { welcomeStep } from "./proWelcome.ts";

test("Start using Pro goes back to what the paywall was opened over, or on to Record", () => {
  assert.equal(welcomeStep("pro", ["Tabs", "Link", "Upgrade"]), "back");
  assert.equal(welcomeStep("pro", ["Tabs", "Result", "Upgrade"]), "back");
  assert.equal(welcomeStep("pro", ["Tabs", "Upgrade"]), "record");
  assert.equal(welcomeStep("pro", ["Tabs", "Profile", "Upgrade"]), "record");
  assert.equal(welcomeStep("pro", ["Upgrade"]), "record");
});

test("a welcome that lands away from the paywall moves a tab to Record and leaves anything else alone", () => {
  assert.equal(welcomeStep("pro", ["Tabs"]), "record");
  assert.equal(welcomeStep("pro", ["Tabs", "Result"]), "stay");
  assert.equal(welcomeStep("pro", []), "stay");
});

test("a song bought stays where the paywall went back to, and a choir opens the choir", () => {
  assert.equal(welcomeStep("song", ["Tabs", "Link"]), "stay");
  assert.equal(welcomeStep("choir", ["Tabs", "Profile", "Choir"]), "stay");
  assert.equal(welcomeStep("choir", ["Tabs", "Upgrade"]), "choir");
});
