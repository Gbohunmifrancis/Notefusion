import { test } from "node:test";
import assert from "node:assert/strict";
import { loginGoogleFirst, welcomeChoices } from "./welcomeChoices.ts";

test("Welcome offers Google, then trying it first, with email in the line (board 07)", () => {
  assert.deepEqual(welcomeChoices(true, false), {
    blocks: ["google", "try"],
    lead: "Use email:",
    links: ["create", "signIn"],
  });
});

test("an email sign-in last time keeps Sign in with email as the second button (board 04a)", () => {
  assert.deepEqual(welcomeChoices(true, true), {
    blocks: ["google", "email"],
    lead: "New here?",
    links: ["create", "try"],
  });
});

test("with no Google, email and trying it first are the two buttons", () => {
  assert.deepEqual(welcomeChoices(false, false), { blocks: ["email", "try"], lead: "Already have one?", links: ["signIn"] });
  assert.deepEqual(welcomeChoices(false, true), { blocks: ["email", "try"], lead: "New here?", links: ["create"] });
});

test("there are never more than two block buttons, and every way in is offered once", () => {
  for (const google of [true, false]) {
    for (const emailLast of [true, false]) {
      const c = welcomeChoices(google, emailLast);
      assert.ok(c.blocks.length <= 2);
      assert.equal(c.blocks.includes("google"), google);
      assert.equal(c.blocks.includes("try") || c.links.includes("try"), true);
      assert.equal(new Set([...c.blocks, ...c.links]).size, c.blocks.length + c.links.length);
      // Signing in and creating an account are both reachable: the email button is one of them.
      const email = c.blocks.includes("email") ? (emailLast ? "signIn" : "create") : null;
      assert.ok([email, ...c.links].includes("signIn"));
      assert.ok([email, ...c.links].includes("create"));
    }
  }
});

test("Login puts Google first only when it is set up and was this phone's last way in (board n-ux-low Q3e)", () => {
  assert.equal(loginGoogleFirst(true, "google"), true);
  // Email last, never signed in here, or not read yet: the email form first, as before.
  assert.equal(loginGoogleFirst(true, "email"), false);
  assert.equal(loginGoogleFirst(true, null), false);
  assert.equal(loginGoogleFirst(true, undefined), false);
  // No Google on this build: there is no Google button to put first.
  assert.equal(loginGoogleFirst(false, "google"), false);
});
