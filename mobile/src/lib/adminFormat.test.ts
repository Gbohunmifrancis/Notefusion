import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ago,
  bucketSeries,
  change,
  dayLabel,
  greeting,
  groupByDay,
  healthWord,
  initials,
  money,
  moneyLine,
  nextFreeReset,
  niceMax,
  parseUtc,
  paymentLine,
  paymentTimeline,
  quotaTone,
  rangeFor,
  rangeLabel,
  seriesFacts,
  shortPlan,
  totals,
  type PaymentRowLike,
} from "./adminFormat.ts";

const NOW = new Date(2026, 9, 18, 18, 54); // Sun 18 Oct, 18:54 on the phone's clock
const at = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m).toISOString();

test("money is in the currency paid, never converted or added across currencies", () => {
  assert.equal(money(750_000, "NGN"), "₦7,500");
  assert.equal(money(40_100_000, "NGN"), "₦401,000");
  assert.equal(money(750_050, "NGN"), "₦7,500.50");
  assert.equal(money(3_999, "USD"), "$39.99");
  assert.equal(money(15_087, "usd"), "$150.87");
  assert.equal(money(1_000, "GHS"), "GHS 10.00");

  const sums = totals([
    { currency: "USD", amountMinor: 3_999 },
    { currency: "NGN", amountMinor: 750_000 },
    { currency: "ngn", amountMinor: 150_000 },
  ]);
  assert.deepEqual(sums, [
    { currency: "NGN", amountMinor: 900_000 },
    { currency: "USD", amountMinor: 3_999 },
  ]);
  assert.equal(moneyLine(sums), "₦9,000 · $39.99");
  assert.equal(moneyLine([]), "");
});

test("plan names read as the console's", () => {
  assert.equal(shortPlan("NoteFusion Pro (Monthly)"), "Pro Monthly");
  assert.equal(shortPlan("NoteFusion Choir (Yearly)"), "Choir Yearly");
  assert.equal(shortPlan("One song"), "One song");
  assert.equal(shortPlan(null), "Payment");
});

test("times read short: now, minutes, hours today, Yesterday, days", () => {
  assert.equal(ago(new Date(2026, 9, 18, 18, 54, 20), NOW), "now");
  assert.equal(ago(new Date(2026, 9, 18, 18, 42), NOW), "12 min");
  assert.equal(ago(new Date(2026, 9, 18, 17, 50), NOW), "1 h");
  assert.equal(ago(new Date(2026, 9, 17, 22, 0), NOW), "Yesterday");
  assert.equal(ago(new Date(2026, 9, 16, 9, 0), NOW), "2 d");
  assert.equal(dayLabel(new Date(2026, 9, 18, 1, 0), NOW), "Today");
  assert.equal(dayLabel(new Date(2026, 9, 11, 1, 0), NOW), "Sun 11 Oct");
  assert.equal(greeting(9), "Good morning");
  assert.equal(greeting(14), "Good afternoon");
  assert.equal(greeting(18), "Good evening");
  assert.equal(parseUtc("2026-10-18T17:42:00").toISOString(), "2026-10-18T17:42:00.000Z");
});

test("the range presets end now and say their days", () => {
  const { from, to } = rangeFor(30, NOW);
  assert.equal(rangeLabel(from, to), "19 Sep – 18 Oct");
  assert.equal(from.getHours(), 0);
  assert.equal(change(2320, 2071), 12);
  assert.equal(change(5, 0), null);
});

test("a daily series groups into weeks from Monday and into months", () => {
  const days = Array.from({ length: 10 }, (_, i) => ({
    date: `2026-10-${String(5 + i).padStart(2, "0")}`, // Mon 5 Oct … Wed 14 Oct
    count: i + 1,
  }));
  assert.deepEqual(bucketSeries(days, "week"), [
    { date: "2026-10-05", count: 28 },
    { date: "2026-10-12", count: 27 },
  ]);
  assert.deepEqual(bucketSeries(days, "month"), [{ date: "2026-10-01", count: 55 }]);
  assert.deepEqual(seriesFacts(days), { busiest: { date: "2026-10-14", count: 10 }, average: 6, total: 55 });
  assert.equal(niceMax(13), 20);
  assert.equal(niceMax(83), 100);
  assert.equal(niceMax(3), 5);
});

function row(over: Partial<PaymentRowLike>): PaymentRowLike {
  return {
    provider: "Paystack",
    status: "Completed",
    amountMinor: 750_000,
    currency: "NGN",
    planName: "NoteFusion Pro (Monthly)",
    isStuck: false,
    createdAtUtc: at(18, 18, 40),
    updatedAtUtc: at(18, 18, 42),
    ...over,
  };
}

test("a payment row says plan, provider and the one fact that matters", () => {
  assert.equal(paymentLine(row({}), NOW), "Pro Monthly · Paystack · 18:42");
  assert.equal(
    paymentLine(row({ status: "Processing", isStuck: true, planName: "One song", updatedAtUtc: at(18, 18, 12) }), NOW),
    "One song · Paystack · stuck 42 min",
  );
  assert.equal(paymentLine(row({ status: "Verified", planName: "NoteFusion Choir (Monthly)" }), NOW), "Choir Monthly · Paystack · paid, no Pro");
  assert.equal(paymentLine(row({ status: "Failed" }), NOW), "Pro Monthly · Paystack · failed");
});

test("rows group by day with each day's completed money per currency", () => {
  const groups = groupByDay(
    [
      row({}),
      row({ currency: "USD", amountMinor: 3_999, provider: "Bachs" }),
      row({ status: "Processing", amountMinor: 150_000 }),
      row({ createdAtUtc: at(17, 19, 2), updatedAtUtc: at(17, 19, 3), currency: "USD", amountMinor: 999 }),
    ],
    NOW,
  );
  assert.deepEqual(
    groups.map((g) => [g.label, g.items.length, moneyLine(g.paid)]),
    [
      ["Today", 3, "₦7,500 · $39.99"],
      ["Yesterday", 1, "$9.99"],
    ],
  );
});

test("a payment's timeline: checkout, the provider's word, the ledger, what it applied", () => {
  const steps = paymentTimeline(
    {
      payment: { ...row({}), id: "p1" },
      webhooks: [{ eventType: "charge.success", status: "Processed", processAttempts: 1, receivedAtUtc: at(18, 18, 42), processedAtUtc: at(18, 18, 42) }],
      ledger: [{ direction: "Credit", amountMinor: 750_000, currency: "NGN", createdAtUtc: at(18, 18, 42) }],
      proUntilUtc: new Date(2026, 10, 18, 18, 42).toISOString(),
    },
    NOW,
  );
  assert.deepEqual(
    steps.map((s) => [s.title, s.detail ?? null, s.tone]),
    [
      ["Checkout opened", "Paystack", "start"],
      ["Paystack confirmed the charge", "charge.success · processed on the first try", "ok"],
      ["Ledger credit ₦7,500", null, "ok"],
      ["Pro until Wed 18 Nov", null, "ok"],
    ],
  );

  const stuck = paymentTimeline(
    { payment: { ...row({ status: "Processing", isStuck: true, createdAtUtc: at(18, 18, 10), updatedAtUtc: at(18, 18, 12) }), id: "p2" }, webhooks: [], ledger: [] },
    NOW,
  );
  assert.equal(stuck[stuck.length - 1]!.title, "Waiting for Paystack: stuck 42 min");

  const song = paymentTimeline({ payment: { ...row({ planName: "One song" }), id: "p3" }, webhooks: [], ledger: [], isSingle: true }, NOW);
  assert.equal(song[song.length - 1]!.title, "One transcription added");
});

test("initials, health words and quota tones", () => {
  assert.equal(initials("Ada Obi"), "AO");
  assert.equal(initials("Grace  Adeyemi  Smith"), "GS");
  assert.equal(initials("Kwame"), "K");
  assert.equal(initials(""), "?");
  assert.deepEqual(healthWord("healthy"), { word: "Operational", tone: "ok" });
  assert.deepEqual(healthWord("degraded"), { word: "Degraded", tone: "warn" });
  assert.deepEqual(healthWord("down"), { word: "Down", tone: "bad" });
  assert.equal(quotaTone(41, 60, 100), "ok");
  assert.equal(quotaTone(70, 60, 100), "warn");
  assert.equal(quotaTone(100, 60, 100), "bad");
});

test("the free week turns on Friday at 17:00 UTC (18:00 West Africa Time), the next one after now", () => {
  assert.equal(nextFreeReset(new Date(Date.UTC(2026, 9, 18, 12))).toISOString(), "2026-10-23T17:00:00.000Z");
  assert.equal(nextFreeReset(new Date(Date.UTC(2026, 9, 23, 16, 59))).toISOString(), "2026-10-23T17:00:00.000Z");
  assert.equal(nextFreeReset(new Date(Date.UTC(2026, 9, 23, 17, 0))).toISOString(), "2026-10-30T17:00:00.000Z");
});
