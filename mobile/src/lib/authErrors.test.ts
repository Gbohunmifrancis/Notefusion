import { test } from "node:test";
import assert from "node:assert/strict";
import { emailFieldError, missesAfter, offersReset } from "./authErrors.ts";

test("a refused address goes on the Email field; other failures stay above Continue", () => {
  const disposable = "Please use a permanent email address. Temporary inboxes can't receive your NoteFusion sheets.";
  assert.equal(emailFieldError({ code: "AUTH_DISPOSABLE_EMAIL", message: disposable }), disposable);
  assert.equal(
    emailFieldError({ code: "Validation.Failed", message: "One or more validation errors occurred.", details: { Email: ["'Email' is not a valid email address."] } }),
    "That doesn't look like an email address.",
  );
  assert.equal(
    emailFieldError({ code: "Validation.Failed", message: "One or more validation errors occurred.", details: { Password: ["Too short."] } }),
    null,
  );
  assert.equal(emailFieldError({ code: "NETWORK_OFFLINE", message: "You're offline." }), null);
});

test("the second wrong password in a row offers Forgot password? in the note", () => {
  const first = missesAfter(0, "AUTH_INVALID_CREDENTIALS");
  assert.equal(offersReset(first), false);
  const second = missesAfter(first, "AUTH_INVALID_CREDENTIALS");
  assert.equal(offersReset(second), true);
  // Anything else between two misses starts the count again.
  assert.equal(offersReset(missesAfter(missesAfter(first, "NETWORK_OFFLINE"), "AUTH_INVALID_CREDENTIALS")), false);
});
