import { test } from "node:test";
import assert from "node:assert/strict";
import { meterSummary } from "./meter.ts";

test("the folded More options row names the choice by its chip", () => {
  assert.equal(meterSummary(null), "Beats in a bar: Not sure");
  assert.equal(meterSummary("3/4"), "Beats in a bar: 3");
  assert.equal(meterSummary("6/8"), "Beats in a bar: 6");
});
