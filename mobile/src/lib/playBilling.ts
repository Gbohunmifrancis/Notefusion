/**
 * Google Play Billing, the pure part (board h-play). The Android app sells Pro, the choir plan and one song through
 * Google Play only; the server still lists the plans (who may buy what, their names), and Google Play sells them at
 * its own prices. This file maps one onto the other and says what the member screen shows. The store calls live in
 * `playStore.ts`; nothing here touches React Native, so `node --test` runs it.
 */
import type { Plan, Subscription } from "../api/types";

/** The app's package, as Google Play knows it (app.json `android.package`). */
export const PLAY_PACKAGE = "com.notefusion.com";

/** Play Console product ids. `pro` and `choir` are subscriptions with base plans `monthly` and `yearly`. */
export const PLAY_PRO = "pro";
export const PLAY_CHOIR = "choir";
export const PLAY_SONG = "one_song";
export const PLAY_SUBSCRIPTIONS = [PLAY_PRO, PLAY_CHOIR];
export const PLAY_PRODUCTS = [PLAY_SONG];

/**
 * Whether this phone sells through Google Play: Android, the server able to confirm Play purchases (its service
 * account set), and Google Play selling the products. Until then the app keeps the website's checkout (Paystack,
 * Bachs), as the builds before Play billing did.
 */
export function sellsOnPlay(android: boolean, serverReady: boolean, playOffers: number): boolean {
  return android && serverReady && playOffers > 0;
}

/** What a server plan is sold as on Google Play. */
export interface PlayItem {
  productId: string;
  /** `monthly` or `yearly` for a subscription; null for the one-song purchase. */
  basePlanId: string | null;
  subscription: boolean;
}

/** The Play item for a plan, or null for one Play does not sell (a lifetime plan). */
export function playItemFor(plan: Plan): PlayItem | null {
  if (plan.interval === "single") return { productId: PLAY_SONG, basePlanId: null, subscription: false };
  if (plan.interval !== "monthly" && plan.interval !== "yearly") return null;
  return { productId: plan.choirSeats ? PLAY_CHOIR : PLAY_PRO, basePlanId: plan.interval, subscription: true };
}

export function playKey(item: PlayItem): string {
  return item.basePlanId ? `${item.productId}:${item.basePlanId}` : item.productId;
}

/** One thing Google Play will sell, priced as Google Play shows it in the buyer's country. */
export interface PlayOffer {
  key: string;
  productId: string;
  basePlanId: string | null;
  /** Needed to buy a subscription's base plan; null for the one-song purchase. */
  offerToken: string | null;
  /** The price as Google Play writes it ("₦7,500.00", "$9.99"), the recurring price for a subscription. */
  price: string;
}

/** The parts of expo-iap's product this reads, so the mapping stays pure. */
export interface PlayProductLike {
  id: string;
  type: "subs" | "in-app";
  displayPrice: string;
  subscriptionOffers?:
    | {
        id: string;
        basePlanIdAndroid?: string | null;
        offerTokenAndroid?: string | null;
        displayPrice: string;
        pricingPhasesAndroid?: { pricingPhaseList: { formattedPrice: string }[] } | null;
      }[]
    | null;
}

/**
 * Google Play's products as offers, keyed like `playKey`. A subscription's base plan is bought with the base plan's
 * own offer (no offer id: it carries no trial or discount), priced at its recurring phase.
 */
export function offersFrom(products: PlayProductLike[]): Map<string, PlayOffer> {
  const offers = new Map<string, PlayOffer>();
  for (const p of products) {
    if (p.type === "in-app") {
      offers.set(p.id, { key: p.id, productId: p.id, basePlanId: null, offerToken: null, price: p.displayPrice });
      continue;
    }
    for (const o of p.subscriptionOffers ?? []) {
      const basePlan = o.basePlanIdAndroid;
      if (!basePlan || !o.offerTokenAndroid) continue;
      const key = `${p.id}:${basePlan}`;
      const plain = !o.id || o.id === basePlan;
      if (offers.has(key) && !plain) continue;
      const phases = o.pricingPhasesAndroid?.pricingPhaseList ?? [];
      offers.set(key, {
        key,
        productId: p.id,
        basePlanId: basePlan,
        offerToken: o.offerTokenAndroid,
        price: phases.length > 0 ? phases[phases.length - 1].formattedPrice : o.displayPrice,
      });
    }
  }
  return offers;
}

/** The offer a plan is bought with, or undefined when Google Play does not sell it (yet). */
export function offerFor(plan: Plan, offers: Map<string, PlayOffer>): PlayOffer | undefined {
  const item = playItemFor(plan);
  return item ? offers.get(playKey(item)) : undefined;
}

/** Google's page for a subscription: cancel, change card, switch plan. */
export function manageUrl(productId: string | null | undefined): string {
  const sku = productId ? `sku=${encodeURIComponent(productId)}&` : "";
  return `https://play.google.com/store/account/subscriptions?${sku}package=${PLAY_PACKAGE}`;
}

/** The paywall's fine print under the button (board h-play 01). */
export function playFinePrint(plan: Plan): string {
  if (plan.interval === "single")
    return "Paid through Google Play. One payment, one transcription that never expires.";
  const period = plan.interval === "yearly" ? "year" : "month";
  return `Paid through Google Play. Renews every ${period} until you cancel in Google Play; cancel any time before the next charge.`;
}

/**
 * The paywall's button (board h-play 01): what happens, and Google Play's price, per period as the plan rows above it
 * write it (`price.periodLabel`: "/ month").
 */
export function playButtonLabel(plan: Plan, price: string, director: boolean): string {
  if (plan.interval === "single") return `Buy this song · ${price}`;
  const per = plan.interval === "yearly" ? " / year" : " / month";
  if (plan.choirSeats) return `${director ? "Add choir time" : "Start your choir"} · ${price}${per}`;
  return `Subscribe · ${price}${per}`;
}

/** How a membership Google Play bills reads on the member screen (board h-play 03). */
export type PlayMemberState = "renewing" | "cancelled" | "grace" | "hold";

export function playMemberState(sub: Pick<Subscription, "billedThrough" | "autoRenews" | "paymentIssue">): PlayMemberState | null {
  if (sub.billedThrough !== "googlePlay") return null;
  if (sub.paymentIssue === "hold") return "hold";
  if (sub.paymentIssue === "grace") return "grace";
  return sub.autoRenews ? "renewing" : "cancelled";
}

/** Pro paused on hold: not Pro now, but the member screen (with its fix) is shown rather than the plans. */
export function isOnHold(sub: Pick<Subscription, "billedThrough" | "paymentIssue"> | null | undefined): boolean {
  return sub?.billedThrough === "googlePlay" && sub.paymentIssue === "hold";
}

/** The Billing Details lines for a Google Play membership, in order. */
export function playStatusLine(state: PlayMemberState): string {
  switch (state) {
    case "renewing":
      return "Renews automatically";
    case "cancelled":
      return "Cancelled";
    case "grace":
      return "Payment problem";
    case "hold":
      return "Paused, payment needed";
  }
}

/**
 * The member hub's plan line for a Google Play membership (board n-ux-low Q2b g): its state and, but on hold, its date
 * ("Renews automatically · next charge 20 Oct 2027", "Cancelled · Pro until 20 Oct 2027").
 */
export function playStateLine(state: PlayMemberState, until: string | null): string {
  const word = playStatusLine(state);
  if (state === "hold" || !until) return word;
  return `${word} · ${state === "renewing" ? "next charge" : "Pro until"} ${until}`;
}

/** The amber note above the card, for a renewal Google could not take. */
export function playProblemNote(state: PlayMemberState): string | null {
  if (state === "grace")
    return "Google Play couldn't take this month's payment. Update your card in Google Play and Pro carries on.";
  if (state === "hold")
    return "Pro is paused. Google Play still couldn't take the payment. Fix it in Google Play and Pro comes back at once.";
  return null;
}

/**
 * What Delete account adds for a membership Google Play still bills: deleting the account does not stop Google's
 * charges, which only Google Play can cancel. Null once it is cancelled (or not billed by Google Play).
 */
export function deleteAccountPlayNote(state: PlayMemberState | null): string | null {
  if (state === null || state === "cancelled") return null;
  return "Your Pro is billed by Google Play, and deleting your account doesn't stop that. Cancel it first in Google Play (Payments & subscriptions), or Google keeps charging you.";
}

/** The plain line at the foot of the card. */
export function playHint(state: PlayMemberState, until: string | null): string {
  switch (state) {
    case "renewing":
      return "Google Play charges you again at the end of each period until you cancel there. Receipts come from Google Play.";
    case "cancelled":
      return until
        ? `You cancelled in Google Play. Pro stays on until ${until}; after that this phone shows the plans again.`
        : "You cancelled in Google Play. Pro stays on until the end of the period you paid for.";
    case "grace":
      return "Google tries the card again over the next few days.";
    case "hold":
      return "Your library and sheets are all kept while Pro is paused.";
  }
}
