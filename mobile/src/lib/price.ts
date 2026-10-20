import type { BillingInterval, Plan } from "../api/types";

/**
 * Prices as the app writes them, and the free-week limit's offer (board b-system/7b). Pure, so
 * it is tested (`price.test.ts`); the Upgrade screen and the Record screen's limit sheet share it.
 */

/**
 * "$4.99", "₦7,500", or "SEK 49.00" for a currency we know no symbol for. Two tiers are on sale in
 * two currencies now, so this can no longer assume dollars: naira figures are five digits and need
 * grouping to be readable, and a round one carries no kobo worth printing.
 *
 * Grouped by hand rather than with `toLocaleString`, which takes its options argument only where
 * Hermes was built with full Intl — on Android it is quietly ignored and the separators never appear.
 */
export function formatPrice(amountMinor: number, currency: string): string {
  const whole = Math.trunc(amountMinor / 100);
  const minor = Math.abs(amountMinor % 100);
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  // Cents are conventional in dollar prices even at .00; kobo on a whole naira figure are noise.
  const major =
    minor === 0 && currency !== "USD" ? grouped : `${grouped}.${String(minor).padStart(2, "0")}`;

  const symbol = currency === "USD" ? "$" : currency === "NGN" ? "₦" : null;
  return symbol ? `${symbol}${major}` : `${currency} ${major}`;
}

/**
 * What a price is for, after it ("₦7,500 / month"). A noun for the lifetime tier and the one-song purchase, not a
 * rate: "/ month" would be wrong and "/ lifetime" still reads like one.
 */
export function periodLabel(interval: BillingInterval): string {
  return interval === "lifetime" || interval === "single" ? "one-time" : interval === "yearly" ? "/ year" : "/ month";
}

/**
 * The line under the Pay button for a plan priced in dollars (board l-ux-high 03c): the website's checkout charges it
 * in naira at the day's rate, so the next page shows a different figure. Google Play charges in the store's own
 * currency, so never there.
 */
export function nairaNote(currency: string, viaPlay: boolean): string | null {
  return !viaPlay && currency !== "NGN"
    ? "You'll pay the naira amount at today's rate on the next page; your bank may add a fee."
    : null;
}

/**
 * The plans in the order the list shows them: grouped by currency, each currency where the server first lists it,
 * cheapest first within it. An account whose country is unknown is offered naira and dollars side by side, and
 * sorting both together by their minor units (kobo against cents) interleaved the two.
 */
export function plansInOrder<T extends Pick<Plan, "currency" | "amountMinor">>(plans: readonly T[]): T[] {
  const currencies = [...new Set(plans.map((p) => p.currency))];
  return plans
    .slice()
    .sort((a, b) => currencies.indexOf(a.currency) - currencies.indexOf(b.currency) || a.amountMinor - b.amountMinor);
}

/**
 * The plan chosen when the paywall opens: Pro's dearest (the year, the best value) within one currency. Picked across
 * two, kobo outweighed cents and it always landed on naira's year. The currency is the one-song purchase's when there
 * is one, as the limit sheet reads it (`limitOffer`), else the first the server lists.
 */
export function bestValuePlan(plans: readonly Plan[]): Plan | undefined {
  const pro = plans.filter((p) => p.interval !== "single");
  const currency = plans.find((p) => p.interval === "single")?.currency ?? pro[0]?.currency;
  const inCurrency = pro.filter((p) => p.currency === currency);
  return (inCurrency.length > 0 ? inCurrency : pro).slice().sort((a, b) => b.amountMinor - a.amountMinor)[0];
}

export interface LimitOffer {
  /** The one-song purchase, offered first (as the Upgrade screen preselects it at the limit). */
  single?: Plan;
  /** Pro by the month, in the same currency as the song. */
  monthly?: Plan;
}

/**
 * The two ways on when the week's free ones are used: the region's one-song purchase and Pro by
 * the month. The song comes from the separate single list (an older API listed it in the main one);
 * Pro is the monthly plan in the song's own currency, since an account whose country is unknown is
 * offered naira and dollars side by side and the two rows must not mix them.
 */
export function limitOffer(proPlans: readonly Plan[], singlePlans: readonly Plan[]): LimitOffer {
  const songs = singlePlans.length > 0 ? singlePlans : proPlans;
  const single = songs.find((p) => p.interval === "single");
  const monthlies = proPlans.filter((p) => p.interval === "monthly");
  const monthly = single ? monthlies.find((p) => p.currency === single.currency) : monthlies[0];
  return { single, monthly };
}

/**
 * The limit sheet's words: when the free ones come back, and that nothing already made is lost.
 * With bought ones also spent, the line says so.
 */
export function limitCopy(freePerWeek: number, boughtTotal: number, freeBack: string): { title: string; message: string } {
  return {
    title: `This week's ${freePerWeek} free ones are used`,
    message:
      boughtTotal > 0
        ? `You've used this week's ${freePerWeek} free ones and the ${boughtTotal} you bought. The free ones come back ${freeBack}.`
        : `They come back ${freeBack}. Everything you've transcribed stays in your library.`,
  };
}
