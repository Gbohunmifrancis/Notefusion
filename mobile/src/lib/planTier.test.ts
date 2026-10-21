import { test } from "node:test";
import assert from "node:assert/strict";
import { memberPlanLabel, memberStateLine, tierOf } from "./planTier.ts";

const pro = {
  planName: "NoteFusion Pro (Yearly)",
  planCode: "pro_yearly",
  isLifetime: false,
  isGift: false,
  choirRole: null,
  choirName: null,
};

test("the plan's period comes from its name or code", () => {
  assert.equal(tierOf({ planName: "NoteFusion Pro (Yearly)", planCode: null }), "Yearly");
  assert.equal(tierOf({ planName: null, planCode: "pro_monthly_regional" }), "Monthly");
  assert.equal(tierOf({ planName: null, planCode: null }), "Pro");
});

test("the member hub names the plan once: Pro and its period, a choir by its name", () => {
  assert.equal(memberPlanLabel(pro), "NoteFusion Pro · Yearly");
  assert.equal(memberPlanLabel({ ...pro, planName: "NoteFusion Pro", planCode: "pro" }), "NoteFusion Pro");
  assert.equal(memberPlanLabel({ ...pro, isLifetime: true }), "NoteFusion Pro · Lifetime");
  assert.equal(memberPlanLabel({ ...pro, isGift: true }), "NoteFusion Pro · Gift");
  assert.equal(
    memberPlanLabel({ ...pro, planCode: "choir_yearly", planName: "Choir (Yearly)", choirRole: "member", choirName: "St Paul's Choir" }),
    "St Paul's Choir · Yearly",
  );
  // A director with Pro of their own: the plan shown is their own.
  assert.equal(memberPlanLabel({ ...pro, choirRole: "director", choirName: "St Paul's Choir" }), "NoteFusion Pro · Yearly");
});

test("the plan's second line says its state and date once", () => {
  const sub = { status: "active" as const, isLifetime: false, isGift: false };
  assert.equal(memberStateLine(sub, "20 Oct 2027"), "Active · Pro until 20 Oct 2027");
  assert.equal(memberStateLine({ ...sub, status: "canceled" }, "20 Oct 2027"), "Cancelled · Pro until 20 Oct 2027");
  assert.equal(memberStateLine({ ...sub, isGift: true }, "20 Oct 2027"), "Complimentary · Pro until 20 Oct 2027");
  assert.equal(memberStateLine({ ...sub, isLifetime: true }, "1 Jan 2999"), "Paid in full");
  assert.equal(memberStateLine(sub, null), "Active");
});
