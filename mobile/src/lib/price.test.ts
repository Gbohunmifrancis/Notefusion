import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPrice, limitCopy, limitOffer } from "./price.ts";
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
