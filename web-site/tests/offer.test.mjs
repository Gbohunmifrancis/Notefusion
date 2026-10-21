// node --test web-site/tests/*.test.mjs
// offer.js is a plain browser script that sets window.NfOffer: the seasonal offer's countdown, sentences and prices
// (board p-halloween-offer). The page half (the strip, the ticking) needs a document and is checked in a browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const window = {};
vm.runInNewContext(read("../assets/offer.js"), { window, Intl, Date, Math, Number, String, Array, Object, isFinite, isNaN });
const O = window.NfOffer;
// The vm realm has its own Object and Array, so results are copied into this one to compare.
const plain = (v) => JSON.parse(JSON.stringify(v));

const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;
const halloween = {
  key: "halloween-2026", name: "Halloween 2026", template: "halloween", label: "Halloween offer", percentOff: 30,
  lastDay: "2026-10-31", endsAtUtc: "2026-10-31T23:00:00Z",
  plans: [
    { planId: "p-m", code: "pro_monthly_usd", interval: "Monthly", currency: "USD", amountMinor: 999, offerAmountMinor: 699 },
    { planId: "p-y", code: "pro_yearly_usd", interval: "Yearly", currency: "USD", amountMinor: 7900, offerAmountMinor: 5500 },
  ],
};
const christmas = { ...halloween, key: "christmas-2026", template: "christmas", label: "Christmas offer", lastDay: "2026-12-26", endsAtUtc: "2026-12-27T00:00:00Z" };

test("the countdown: days from a day up, hours under a day, minutes in the last hour", () => {
  assert.equal(O.countdown(2 * D + 14 * H + 8 * M + 33 * S), "2d 14:08:33");
  assert.equal(O.countdown(14 * H + 8 * M + 33 * S), "14:08:33");
  assert.equal(O.countdown(6 * H + 41 * M + 9 * S), "06:41:09");
  assert.equal(O.countdown(41 * M + 9 * S), "41:09");
  assert.equal(O.countdown(9 * S), "00:09");
});

test("the countdown rounds up to the second, so it reads 00:00 at the end and never before", () => {
  assert.equal(O.countdown(2 * D + 14 * H + 8 * M + 32 * S + 400), "2d 14:08:33");
  assert.equal(O.countdown(1), "00:01");
  assert.equal(O.countdown(0), "00:00");
  assert.equal(O.countdown(-5000), "00:00");
  assert.equal(O.countdown(D), "1d 00:00:00");
  assert.equal(O.countdown(D - 1000), "23:59:59");
  assert.equal(O.countdown(H), "01:00:00");
  assert.equal(O.countdown(H - 1000), "59:59");
});

test("under reduced motion it ticks by the minute and drops the seconds", () => {
  assert.equal(O.countdown(2 * D + 14 * H + 8 * M + 33 * S, true), "2d 14h 09m");
  assert.equal(O.countdown(14 * H + 8 * M, true), "14h 08m");
  assert.equal(O.countdown(41 * M + 9 * S, true), "42m");
  assert.equal(O.countdown(20 * S, true), "1m");
  assert.equal(O.countdown(0, true), "0m");
});

test("the next tick lands when the text changes: the next second, or the next minute", () => {
  assert.equal(O.tickDelay(2500), 500);
  assert.equal(O.tickDelay(2000), 1000);
  assert.equal(O.tickDelay(90 * S, true), 30 * S);
  assert.equal(O.tickDelay(2 * M, true), M);
});

test("a screen reader hears one sentence: the offer, its percent and the day it ends", () => {
  const thursday = new Date(2026, 9, 29, 15, 0); // the reader's own Thursday 29 October
  assert.equal(O.srSentence(halloween, thursday), "Halloween offer, 30% off Pro, ends Saturday at midnight");
  assert.equal(O.srSentence(halloween, new Date(2026, 9, 30, 9, 0)), "Halloween offer, 30% off Pro, ends tomorrow at midnight");
  assert.equal(O.srSentence(halloween, new Date(2026, 9, 31, 20, 0)), "Halloween offer, 30% off Pro, ends tonight at midnight");
  assert.equal(O.srSentence(halloween, new Date(2026, 9, 21, 9, 0)), "Halloween offer, 30% off Pro, ends Saturday 31 October at midnight");
  assert.equal(O.srSentence({ ...christmas, percentOff: 25 }, new Date(2026, 11, 20, 9, 0)), "Christmas offer, 25% off Pro, ends Saturday at midnight");
});

test("the pricing note and the ended line", () => {
  assert.equal(O.holdsLine(halloween), "The Halloween prices hold until midnight on Saturday 31 October, your time.");
  assert.equal(O.holdsLine(christmas), "The Christmas prices hold until midnight on Saturday 26 December, your time.");
  assert.equal(O.endedLine({ key: "halloween-2026", label: "Halloween offer" }), "The Halloween offer has ended.");
  assert.equal(O.longDay("2026-10-31"), "Saturday 31 October");
});

test("the tag and the skin follow the template", () => {
  assert.equal(O.tagText(halloween), "Halloween · 30% off");
  assert.equal(O.tagText(christmas), "Christmas · 30% off");
  assert.equal(O.skinOf(halloween), "halloween");
  assert.equal(O.skinOf(christmas), "christmas");
  assert.equal(O.skinOf({ template: "easter", label: "Easter offer" }), null);
  assert.equal(O.seasonName({ template: "easter", label: "Easter offer" }), "Easter");
});

test("plan merge: each plan gets its offer price by plan id, and only those the offer covers", () => {
  const plans = [
    { id: "p-m", code: "pro_monthly_usd", amountMinor: 999, currency: "USD", interval: "monthly" },
    { id: "p-y", code: "pro_yearly_usd", amountMinor: 7900, currency: "USD", interval: "yearly" },
    { id: "p-s", code: "one_song_usd", amountMinor: 199, currency: "USD", interval: "single" },
    { id: "c-m", code: "choir_monthly_usd", amountMinor: 1999, currency: "USD", interval: "monthly", choirSeats: 25 },
  ];
  assert.deepEqual(plain(O.mergePlans(plans, halloween).map((p) => [p.id, p.offerAmountMinor])), [["p-m", 699], ["p-y", 5500], ["p-s", null], ["c-m", null]]);
  assert.deepEqual(plain(O.mergePlans(plans, null).map((p) => p.offerAmountMinor)), [null, null, null, null]);
  assert.equal(plans[0].offerAmountMinor, undefined, "the plans themselves are not changed");
});

test("an offer price is never taken from another currency, another plan or a higher number", () => {
  const naira = { id: "p-m", code: "pro_monthly_ngn", amountMinor: 750000, currency: "NGN", interval: "monthly" };
  assert.equal(O.offerPrice(naira, halloween), null);
  assert.equal(O.offerPrice({ id: "other", code: "pro_monthly_usd", amountMinor: 999, currency: "USD" }, halloween), null);
  assert.equal(O.offerPrice({ id: "p-m", amountMinor: 999, currency: "USD" }, { plans: [{ planId: "p-m", currency: "USD", offerAmountMinor: 1200 }] }), null);
  // An answer without ids is matched on the code.
  assert.equal(O.offerPrice({ id: 7, code: "pro_monthly_usd_regional", amountMinor: 499, currency: "USD" }, { plans: [{ code: "pro_monthly_usd_regional", currency: "USD", offerAmountMinor: 349 }] }), 349);
});

test("money as app.js writes it, and a year by the month", () => {
  assert.equal(O.money(699, "USD"), "$6.99");
  assert.equal(O.money(5500, "USD"), "$55");
  assert.equal(O.money(349, "USD"), "$3.49");
  assert.equal(O.perMonth(5500, "USD"), "$4.58 a month");
  assert.equal(O.perMonth(2799, "USD"), "$2.33 a month");
});

test("the small print under Pay says where the money goes and that nothing renews", () => {
  assert.equal(O.payFine("monthly"), "Secure checkout on Bachs’ page, in US dollars. One payment covers the whole month; nothing renews without you.");
  assert.equal(O.payFine("Yearly"), "Secure checkout on Bachs’ page, in US dollars. One payment covers the whole year; nothing renews without you.");
  assert.equal(O.payFine(1), "Secure checkout on Bachs’ page, in US dollars. One payment covers the whole year; nothing renews without you.");
});

test("only an offer still running with a plan priced is shown", () => {
  const before = Date.parse("2026-10-31T22:59:59Z"), after = Date.parse("2026-10-31T23:00:00Z");
  assert.equal(O.isLive(halloween, before), true);
  assert.equal(O.isLive(halloween, after), false);
  assert.equal(O.isLive({ ...halloween, plans: [] }, before), false);
  assert.equal(O.isLive(null, before), false);
  assert.equal(O.dismissKey("halloween-2026"), "nf.offerDismissed.halloween-2026");
});

test("the files are loaded only while an offer runs, and every change carries a new version", () => {
  const app = read("../assets/app.js"), pricing = read("../assets/pricing.js");
  for (const src of [app, pricing]) {
    assert.match(src, /"\/assets\/offer\.js\?v=\d+"/);
    assert.match(src, /"\/assets\/offer\.css\?v=\d+"/);
  }
  assert.doesNotMatch(read("../app/index.html"), /offer\.(js|css)/);
  assert.doesNotMatch(read("../index.html"), /offer\.(js|css)/);
  // Pro's gold and pumpkin as a fill never appear in the offer's styles.
  const css = read("../assets/offer.css");
  assert.doesNotMatch(css, /amber|premium|--page-pro|#F59E0B|#b45309/i);
  assert.doesNotMatch(css, /background:\s*#F28A3A|background:\s*rgba\(242, 138, 58, 1\)/i);
});

test("the account switch names notes and offers", () => {
  const html = read("../app/index.html");
  assert.match(html, />Notes and offers from NoteFusion</);
  assert.match(html, /id="acct-founder"[^>]*aria-describedby="acct-founder-note"/);
});
