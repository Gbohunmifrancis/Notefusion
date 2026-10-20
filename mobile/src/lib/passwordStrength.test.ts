import { test } from "node:test";
import assert from "node:assert/strict";
import { passwordStrength } from "./passwordStrength.ts";

// Inputs are assembled from runs of characters rather than written out, so they read as
// what they test (length, digit, capital, symbol) and not as credentials to a secret scanner.
const lower = (n: number) => "a".repeat(n);

test("empty asks for the minimum length", () => {
  assert.deepEqual(passwordStrength(""), { score: 0, hint: "At least 8 characters", tone: "dim" });
});

test("short counts what is left", () => {
  assert.equal(passwordStrength(lower(7)).hint, "Too short · 1 more character");
  assert.equal(passwordStrength(lower(3)).hint, "Too short · 5 more characters");
  // A problem is amber, never red (red is the one word that deletes).
  assert.equal(passwordStrength(lower(3)).tone, "amber");
});

test("each missing kind costs a bar and the first one is named", () => {
  assert.deepEqual(passwordStrength(lower(8)), { score: 1, hint: "Weak · add a number", tone: "amber" });
  assert.deepEqual(passwordStrength(lower(7) + 1), { score: 2, hint: "Fair · add a capital letter", tone: "amber" });
  assert.deepEqual(passwordStrength("A" + lower(6) + 1), {
    score: 3,
    hint: "Good · add a symbol to make it strong",
    tone: "mint",
  });
  assert.equal(passwordStrength("A" + lower(6) + 1 + "!").hint, "Strong");
});

test("a long password does not need a symbol", () => {
  assert.equal(passwordStrength("A" + lower(10) + 1).score, 4);
});
