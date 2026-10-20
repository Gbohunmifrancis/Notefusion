import { test } from "node:test";
import assert from "node:assert/strict";
import { bestValuePlan, formatPrice, limitCopy, limitOffer, nairaNote, periodLabel, plansInOrder, webFinePrint } from "./price.ts";

test("the website's fine print says what one payment buys, and that it does not renew", () => {
  assert.equal(
    webFinePrint({ interval: "monthly" }),
    "One month of Pro. It doesn't renew by itself: pay again whenever you want more time. Secure checkout opens in your browser; you'll come back here automatically.",
  );
  assert.match(webFinePrint({ interval: "yearly" }), /^One year of Pro\. It doesn't renew by itself/);
  assert.match(webFinePrint({ interval: "yearly", choirSeats: 25 }), /^One year of Pro for your choir\. It doesn't renew/);
  assert.match(webFinePrint({ interval: "single" }), /^One payment, one transcription that never expires\./);
  assert.match(webFinePrint({ interval: "lifetime" }), /^One payment, Pro for good\./);
});
import type { Plan } from "../api/types";

const plan = (code: string, amountMinor: number, currency: string, interval: Plan["interval"]): Plan => ({
  id: code,
  code,
  name: code,
  amountMinor,
  currency,
  interval,
});

test("prices are grouped, naira without kobo, dollars with cents", () => {
  assert.equal(formatPrice(150000, "NGN"), "₦1,500");
  assert.equal(formatPrice(750000, "NGN"), "₦7,500");
  assert.equal(formatPrice(199, "USD"), "$1.99");
  assert.equal(formatPrice(500, "USD"), "$5.00");
  assert.equal(formatPrice(4950, "SEK"), "SEK 49.50");
});

test("the limit offers the song first and Pro by the month in the same currency", () => {
  const pro = [
    plan("pro_ngn_m", 750000, "NGN", "monthly"),
    plan("pro_ngn_y", 7500000, "NGN", "yearly"),
    plan("pro_usd_m", 499, "USD", "monthly"),
  ];
  const offer = limitOffer(pro, [plan("song_usd", 199, "USD", "single")]);
  assert.equal(offer.single?.code, "song_usd");
  assert.equal(offer.monthly?.code, "pro_usd_m");
});

test("an older API that lists the song in the main list still offers it", () => {
  const offer = limitOffer([plan("pro_m", 750000, "NGN", "monthly"), plan("song", 150000, "NGN", "single")], []);
  assert.equal(offer.single?.code, "song");
  assert.equal(offer.monthly?.code, "pro_m");
});

test("a price says what it is for: a rate for Pro, one-time for a song or a lifetime", () => {
  assert.equal(periodLabel("monthly"), "/ month");
  assert.equal(periodLabel("yearly"), "/ year");
  assert.equal(periodLabel("single"), "one-time");
  assert.equal(periodLabel("lifetime"), "one-time");
});

test("a dollar plan on the website's checkout warns of the naira charge; naira and Google Play do not", () => {
  assert.equal(
    nairaNote("USD", false),
    "You'll pay the naira amount at today's rate on the next page; your bank may add a fee.",
  );
  assert.equal(nairaNote("NGN", false), null);
  assert.equal(nairaNote("USD", true), null);
});

test("no plans loaded: no prices, the rows go without them", () => {
  assert.deepEqual(limitOffer([], []), { single: undefined, monthly: undefined });
});

test("the limit says when the free ones come back, and mentions bought ones when they are spent too", () => {
  assert.deepEqual(limitCopy(3, 0, "Friday 6pm"), {
    title: "This week's 3 free ones are used",
    message: "They come back Friday 6pm. Everything you've transcribed stays in your library.",
  });
  assert.equal(
    limitCopy(3, 2, "Friday 6pm").message,
    "You've used this week's 3 free ones and the 2 you bought. The free ones come back Friday 6pm.",
  );
});

test("plans are listed a currency at a time, cheapest first, never naira and dollars interleaved", () => {
  const plans = [
    plan("pro_ngn_y", 7500000, "NGN", "yearly"),
    plan("pro_usd_m", 499, "USD", "monthly"),
    plan("pro_ngn_m", 750000, "NGN", "monthly"),
    plan("pro_usd_y", 3999, "USD", "yearly"),
  ];
  assert.deepEqual(plansInOrder(plans).map((p) => p.code), ["pro_ngn_m", "pro_ngn_y", "pro_usd_m", "pro_usd_y"]);
});

test("the plan chosen at first is the year in one currency: the song's, else the first listed", () => {
  const pro = [
    plan("pro_ngn_m", 750000, "NGN", "monthly"),
    plan("pro_ngn_y", 7500000, "NGN", "yearly"),
    plan("pro_usd_m", 499, "USD", "monthly"),
    plan("pro_usd_y", 3999, "USD", "yearly"),
  ];
  assert.equal(bestValuePlan(pro)?.code, "pro_ngn_y");
  assert.equal(bestValuePlan([...pro, plan("song_usd", 199, "USD", "single")])?.code, "pro_usd_y");
  assert.equal(bestValuePlan([plan("song", 150000, "NGN", "single")]), undefined, "no Pro plan, nothing to choose");
});
