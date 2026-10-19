import { test } from "node:test";
import assert from "node:assert/strict";
import { paymentCheckDelayMs } from "./paymentWatch.ts";

test("a payment is asked about at once, then 3, 6, 12 and 20 s apart, then every 30 s", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 40].map(paymentCheckDelayMs), [3_000, 6_000, 12_000, 20_000, 30_000, 30_000, 30_000]);
});

test("ten minutes of watching asks the provider about twenty-four times, not sixty", () => {
  let at = 0;
  let checks = 0;
  while (at < 10 * 60_000) {
    checks += 1;
    at += paymentCheckDelayMs(checks);
  }
  assert.ok(checks <= 24, String(checks));
  assert.ok(checks >= 20, String(checks));
});
