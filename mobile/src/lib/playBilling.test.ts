import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isOnHold,
  manageUrl,
  offerFor,
  offersFrom,
  playButtonLabel,
  playFinePrint,
  playItemFor,
  playMemberState,
  type PlayProductLike,
} from "./playBilling.ts";
import type { Plan } from "../api/types";

const plan = (code: string, interval: Plan["interval"], choirSeats?: number): Plan => ({
  id: code,
  code,
  name: code,
  amountMinor: 750000,
  currency: "NGN",
  interval,
  ...(choirSeats ? { choirSeats } : {}),
});

const products: PlayProductLike[] = [
  {
    id: "pro",
    type: "subs",
    displayPrice: "₦7,500.00",
    subscriptionOffers: [
      // A trial offer on the monthly plan must not stand in for the plain base plan.
      { id: "first-week-free", basePlanIdAndroid: "monthly", offerTokenAndroid: "trial", displayPrice: "Free" },
      {
        id: "",
        basePlanIdAndroid: "monthly",
        offerTokenAndroid: "tok-m",
        displayPrice: "₦7,500.00",
        pricingPhasesAndroid: { pricingPhaseList: [{ formattedPrice: "₦7,500.00" }] },
      },
      { id: "", basePlanIdAndroid: "yearly", offerTokenAndroid: "tok-y", displayPrice: "₦60,000.00" },
    ],
  },
  { id: "choir", type: "subs", displayPrice: "₦25,000.00", subscriptionOffers: [
    { id: "", basePlanIdAndroid: "monthly", offerTokenAndroid: "tok-cm", displayPrice: "₦25,000.00" },
  ] },
  { id: "one_song", type: "in-app", displayPrice: "₦1,500.00" },
];

test("each plan is the Play item it is sold as; lifetime is not on Play", () => {
  assert.deepEqual(playItemFor(plan("pro_monthly_ngn", "monthly")), { productId: "pro", basePlanId: "monthly", subscription: true });
  assert.deepEqual(playItemFor(plan("choir_yearly_ngn", "yearly", 25)), { productId: "choir", basePlanId: "yearly", subscription: true });
  assert.deepEqual(playItemFor(plan("one_song_ngn", "single")), { productId: "one_song", basePlanId: null, subscription: false });
  assert.equal(playItemFor(plan("pro_lifetime", "lifetime")), null);
});

test("a base plan is bought with its own offer at its own price, never a trial's", () => {
  const offers = offersFrom(products);
  const monthly = offerFor(plan("pro_monthly_ngn", "monthly"), offers)!;
  assert.equal(monthly.offerToken, "tok-m");
  assert.equal(monthly.price, "₦7,500.00");
  assert.equal(offerFor(plan("pro_yearly_ngn_v2", "yearly"), offers)!.offerToken, "tok-y");
  assert.equal(offerFor(plan("choir_monthly_ngn", "monthly", 25), offers)!.offerToken, "tok-cm");
  assert.equal(offerFor(plan("choir_yearly_ngn", "yearly", 25), offers), undefined);
  assert.equal(offerFor(plan("one_song_ngn", "single"), offers)!.price, "₦1,500.00");
});

test("the button and the fine print say what happens and how to stop it", () => {
  assert.equal(playButtonLabel(plan("pro_monthly_ngn", "monthly"), "₦7,500", false), "Subscribe · ₦7,500/month");
  assert.equal(playButtonLabel(plan("one_song_ngn", "single"), "₦1,500", false), "Buy this song · ₦1,500");
  assert.equal(playButtonLabel(plan("choir_monthly_ngn", "monthly", 25), "₦25,000", false), "Start your choir · ₦25,000/month");
  assert.match(playFinePrint(plan("pro_yearly_ngn_v2", "yearly")), /Renews every year until you cancel in Google Play/);
  assert.match(playFinePrint(plan("one_song_ngn", "single")), /never expires/);
});

test("a Google Play membership reads as renewing, cancelled, a payment problem or paused", () => {
  assert.equal(playMemberState({ billedThrough: "googlePlay", autoRenews: true, paymentIssue: null }), "renewing");
  assert.equal(playMemberState({ billedThrough: "googlePlay", autoRenews: false, paymentIssue: null }), "cancelled");
  assert.equal(playMemberState({ billedThrough: "googlePlay", autoRenews: true, paymentIssue: "grace" }), "grace");
  assert.equal(playMemberState({ billedThrough: "googlePlay", autoRenews: false, paymentIssue: "hold" }), "hold");
  assert.equal(playMemberState({ billedThrough: "web", autoRenews: false, paymentIssue: null }), null);
  assert.equal(isOnHold({ billedThrough: "googlePlay", paymentIssue: "hold" }), true);
  assert.equal(isOnHold({ billedThrough: "web", paymentIssue: null }), false);
});

test("Manage opens Google's page for this app's subscription", () => {
  assert.equal(
    manageUrl("pro"),
    "https://play.google.com/store/account/subscriptions?sku=pro&package=com.notefusion.com",
  );
  assert.equal(manageUrl(null), "https://play.google.com/store/account/subscriptions?package=com.notefusion.com");
});
