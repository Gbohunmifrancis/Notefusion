import { test } from "node:test";
import assert from "node:assert/strict";
import { passwordStrength } from "./passwordStrength.ts";

test("empty asks for the minimum length", () => {
  assert.deepEqual(passwordStrength(""), { score: 0, hint: "At least 8 characters", tone: "dim" });
});

test("short counts what is left", () => {
  assert.equal(passwordStrength("abcdefg").hint, "Too short · 1 more character");
  assert.equal(passwordStrength("abc").hint, "Too short · 5 more characters");
});

test("each missing kind costs a bar and the first one is named", () => {
  assert.deepEqual(passwordStrength("abcdefgh"), { score: 1, hint: "Weak · add a number", tone: "amber" });
  assert.deepEqual(passwordStrength("abcdefg1"), { score: 2, hint: "Fair · add a capital letter", tone: "amber" });
  assert.deepEqual(passwordStrength("Abcdefg1"), {
    score: 3,
    hint: "Good · add a symbol to make it strong",
    tone: "mint",
  });
  assert.equal(passwordStrength("Abcdefg1!").hint, "Strong");
});

test("a long password does not need a symbol", () => {
  assert.equal(passwordStrength("Abcdefghijk1").score, 4);
});
