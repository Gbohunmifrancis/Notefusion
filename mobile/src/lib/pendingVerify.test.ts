import { test } from "node:test";
import assert from "node:assert/strict";
import { VERIFY_CODE_MS, readPendingVerify } from "./pendingVerify.ts";

const sentAt = Date.UTC(2026, 9, 20, 9, 0, 0);
const stored = JSON.stringify({ email: "ada@example.com", fromSignUp: true, sentAt });

test("a code under ten minutes old reopens the code screen", () => {
  assert.deepEqual(readPendingVerify(stored, sentAt + 9 * 60 * 1000), { email: "ada@example.com", fromSignUp: true, sentAt });
  assert.deepEqual(readPendingVerify(stored, sentAt), { email: "ada@example.com", fromSignUp: true, sentAt });
});

test("an expired, future-dated or unreadable record does not", () => {
  assert.equal(readPendingVerify(stored, sentAt + VERIFY_CODE_MS), null);
  assert.equal(readPendingVerify(stored, sentAt - 1000), null, "a clock moved back");
  assert.equal(readPendingVerify(null, sentAt), null);
  assert.equal(readPendingVerify("not json", sentAt), null);
  assert.equal(readPendingVerify(JSON.stringify({ email: "", sentAt }), sentAt), null);
  assert.equal(readPendingVerify(JSON.stringify({ email: "a@b.co" }), sentAt), null);
});

test("a refused sign-in's code is not sign-up's", () => {
  const fromLogin = JSON.stringify({ email: "ada@example.com", sentAt });
  assert.equal(readPendingVerify(fromLogin, sentAt + 1000)?.fromSignUp, false);
});
