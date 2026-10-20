import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advancePeriod,
  bestValuePlan,
  dayLabel,
  formatPrice,
  limitCopy,
  limitOffer,
  nairaNote,
  paidUntilLine,
  payLabel,
  periodLabel,
  plansInOrder,
  webFinePrint,
  yearNote,
} from "./price.ts";

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

test("a price says what one payment buys on the website, and stays a rate on Google Play, which renews", () => {
  assert.equal(periodLabel("monthly", false), "for a month");
  assert.equal(periodLabel("yearly", false), "for a year");
  assert.equal(periodLabel("single", false), "once");
  assert.equal(periodLabel("lifetime", false), "once");
  assert.equal(periodLabel("monthly", true), "/ month");
  assert.equal(periodLabel("yearly", true), "/ year");
  assert.equal(periodLabel("single", true), "one-time");
  assert.equal(periodLabel("lifetime", true), "one-time");
});

test("the website's Pay button says what one payment buys, one pattern for every plan", () => {
  assert.equal(payLabel(plan("pro_y", 6000000, "NGN", "yearly")), "Pay ₦60,000 for a year");
  assert.equal(payLabel(plan("pro_m", 750000, "NGN", "monthly")), "Pay ₦7,500 for a month");
  assert.equal(payLabel(plan("song", 150000, "NGN", "single")), "Pay ₦1,500 for this song");
  assert.equal(payLabel({ ...plan("choir_y", 25000000, "NGN", "yearly"), choirSeats: 25 }), "Pay ₦250,000 for a choir year");
  assert.equal(payLabel({ ...plan("choir_m", 2500000, "NGN", "monthly"), choirSeats: 25 }), "Pay ₦25,000 for a choir month");
  assert.equal(payLabel(plan("pro_usd_y", 3999, "USD", "yearly")), "Pay $39.99 for a year");
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

test("the year says what it costs a month and saves in money, against the monthly plan in its currency", () => {
  const pro = [
    plan("pro_ngn_m", 750000, "NGN", "monthly"),
    plan("pro_ngn_y", 6000000, "NGN", "yearly"),
    plan("pro_usd_m", 499, "USD", "monthly"),
    plan("pro_usd_y", 3999, "USD", "yearly"),
  ];
  assert.equal(yearNote(pro[1], pro), "₦5,000 a month · save ₦30,000");
  assert.equal(yearNote(pro[3], pro), "$3.33 a month · save $19.89");
  assert.equal(yearNote(pro[0], pro), null, "only the year");
  assert.equal(yearNote(pro[1], [pro[1], pro[2]]), null, "no monthly plan in naira");
  assert.equal(yearNote(plan("pro_ngn_y", 9000000, "NGN", "yearly"), pro), null, "a year that saves nothing");
  // A choir's year is measured against the choir's month, never Pro's.
  const choirYear = { ...plan("choir_y", 25000000, "NGN", "yearly"), choirSeats: 25 };
  assert.equal(yearNote(choirYear, pro), null);
  assert.equal(yearNote(choirYear, [...pro, { ...plan("choir_m", 2500000, "NGN", "monthly"), choirSeats: 25 }]), "₦20,833 a month · save ₦50,000");
});

test("a period is counted as the server counts it: a month or a year on, the day held to the month's end", () => {
  const at = (iso: string) => new Date(iso);
  assert.equal(advancePeriod(at("2026-10-20T12:00:00Z"), "monthly").toISOString(), "2026-11-20T12:00:00.000Z");
  assert.equal(advancePeriod(at("2026-10-20T12:00:00Z"), "yearly").toISOString(), "2027-10-20T12:00:00.000Z");
  assert.equal(advancePeriod(at("2027-01-31T09:30:00Z"), "monthly").toISOString(), "2027-02-28T09:30:00.000Z");
  assert.equal(advancePeriod(at("2028-02-29T09:30:00Z"), "yearly").toISOString(), "2029-02-28T09:30:00.000Z");
  assert.equal(advancePeriod(at("2026-12-15T12:00:00Z"), "monthly").toISOString(), "2027-01-15T12:00:00.000Z");
  assert.equal(dayLabel(new Date(2027, 9, 20, 12)), "20 Oct 2027");
});

test("the pay bar says how long the plan lasts, from the day a member's own time ends", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const free = { isActive: false, isLifetime: false, currentPeriodEndUtc: null, planCode: null, choirRole: null, choirPeriodEndUtc: null };
  const year = { interval: "yearly" as const };
  const month = { interval: "monthly" as const };
  assert.equal(paidUntilLine(year, free, now), "Pro until 20 Oct 2027");
  assert.equal(paidUntilLine(month, null, now), "Pro until 20 Nov 2026");
  assert.equal(paidUntilLine({ interval: "single" }, free, now), "Never expires");
  // A member adding time: from the day their time ends.
  const member = { ...free, isActive: true, planCode: "pro_monthly", currentPeriodEndUtc: "2026-11-05T12:00:00Z" };
  assert.equal(paidUntilLine(month, member, now), "Pro until 5 Dec 2026");
  // Time already over, or Pro only through a choir, counts from today.
  assert.equal(paidUntilLine(month, { ...member, currentPeriodEndUtc: "2026-10-01T12:00:00Z" }, now), "Pro until 20 Nov 2026");
  const singer = { ...member, planCode: "choir_monthly", choirRole: "member" as const };
  assert.equal(paidUntilLine(month, singer, now), "Pro until 20 Nov 2026");
  // A choir plan: the director's choir stacks, anyone else's starts today.
  const choirYear = { interval: "yearly" as const, choirSeats: 25 };
  assert.equal(paidUntilLine(choirYear, free, now), "Choir until 20 Oct 2027");
  const director = { ...free, choirRole: "director" as const, choirPeriodEndUtc: "2027-01-10T12:00:00Z" };
  assert.equal(paidUntilLine(choirYear, director, now), "Choir until 10 Jan 2028");
});
