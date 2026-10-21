import type { BillingInterval, Plan, Subscription } from "../api/types";

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
 * What a price is for, after it. On the website's checkout, what one payment buys (board m-ux-medium P4d): "₦7,500
 * for a month", "₦60,000 for a year", "₦1,500 once" — nothing bought there renews, and "/ month" reads as a
 * subscription that does. Google Play does renew, so there it stays a rate ("/ month"), and the lifetime tier and
 * the one-song purchase are "one-time".
 */
export function periodLabel(interval: BillingInterval, viaPlay: boolean): string {
  if (interval === "lifetime" || interval === "single") return viaPlay ? "one-time" : "once";
  if (viaPlay) return interval === "yearly" ? "/ year" : "/ month";
  return interval === "yearly" ? "for a year" : "for a month";
}

/**
 * The Pay button on the website's checkout (board m-ux-medium P4d), one pattern for every plan: "Pay ₦60,000 for a
 * year", "Pay ₦1,500 for this song", "Pay ₦250,000 for a choir year". Google Play's is `playButtonLabel`.
 */
export function payLabel(plan: Pick<Plan, "interval" | "amountMinor" | "currency" | "choirSeats">): string {
  const price = formatPrice(plan.amountMinor, plan.currency);
  if (plan.interval === "single") return `Pay ${price} for this song`;
  if (plan.interval === "lifetime") return `Pay ${price} for lifetime Pro`;
  const period = plan.interval === "yearly" ? "year" : "month";
  return `Pay ${price} for a ${plan.choirSeats ? `choir ${period}` : period}`;
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

/**
 * The paywall's fine print for the website's checkout: what one payment buys, and that it does not renew (nothing
 * bought there does: a member pays again to add time). Said before paying, where it used to be said only at Cancel.
 * Google Play's own is `playFinePrint`.
 */
export function webFinePrint(plan: Pick<Plan, "interval" | "choirSeats">): string {
  if (plan.interval === "single") {
    return "One payment, one transcription that never expires. Secure checkout opens in your browser; you'll come back to your song.";
  }
  const open = "Secure checkout opens in your browser; you'll come back here automatically.";
  if (plan.interval === "lifetime") return `One payment, Pro for good. ${open}`;
  const period = plan.interval === "yearly" ? "year" : "month";
  const what = plan.choirSeats ? `One ${period} of Pro for your choir` : `One ${period} of Pro`;
  return `${what}. It doesn't renew by itself: pay again whenever you want more time. ${open}`;
}

/**
 * What the year costs a month and saves in money against twelve months of the monthly plan in its currency (board
 * m-ux-medium P4b): "₦5,000 a month · save ₦30,000", never a percentage. Null for any other plan, with no monthly plan
 * of its kind in the same currency, or when the year saves nothing.
 */
export function yearNote(
  plan: Pick<Plan, "interval" | "currency" | "amountMinor" | "choirSeats">,
  plans: readonly Pick<Plan, "interval" | "currency" | "amountMinor" | "choirSeats">[],
): string | null {
  if (plan.interval !== "yearly") return null;
  const monthly = plans.find(
    (p) => p.interval === "monthly" && p.currency === plan.currency && Boolean(p.choirSeats) === Boolean(plan.choirSeats),
  );
  if (!monthly) return null;
  const saves = monthly.amountMinor * 12 - plan.amountMinor;
  if (saves <= 0) return null;
  // To the cent, but to the whole naira: kobo on a month's share are noise, as `formatPrice` says.
  const unit = plan.currency === "NGN" ? 100 : 1;
  const perMonth = Math.round(plan.amountMinor / 12 / unit) * unit;
  return `${formatPrice(perMonth, plan.currency)} a month · save ${formatPrice(saves, plan.currency)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "20 Oct 2027": a day as the pay bar says it, on the phone's own calendar (by hand, as `formatPrice` is). */
export function dayLabel(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * One period on from `from`, as the server counts it (`BillingPeriod.Advance`: .NET's AddMonths and AddYears on the
 * UTC instant), so a day past the end of the shorter month is held to its last day: 31 Jan and a month is 28 Feb.
 */
export function advancePeriod(from: Date, interval: "monthly" | "yearly"): Date {
  const to = new Date(from.getTime());
  to.setUTCDate(1);
  to.setUTCMonth(to.getUTCMonth() + (interval === "yearly" ? 12 : 1));
  const lastDay = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 0)).getUTCDate();
  to.setUTCDate(Math.min(from.getUTCDate(), lastDay));
  return to;
}

/**
 * The pay bar's line on the website's checkout (board m-ux-medium P4b): how long the chosen plan lasts — "Pro until
 * 20 Oct 2027" — never "billed", since nothing bought there renews. Time added by a member starts the day theirs
 * ends, as the server stacks it: their own Pro for a Pro plan, their choir's for a director's choir plan.
 */
export function paidUntilLine(
  plan: Pick<Plan, "interval" | "choirSeats">,
  sub: Pick<
    Subscription,
    "isActive" | "isLifetime" | "currentPeriodEndUtc" | "planCode" | "choirRole" | "choirPeriodEndUtc"
  > | null,
  now: Date,
): string {
  if (plan.interval === "single") return "Never expires";
  if (plan.interval === "lifetime") return "Pro for good";
  const choir = Boolean(plan.choirSeats);
  // Pro only through a choir is the choir's period, not time of one's own to add to.
  const viaChoir = Boolean(sub?.choirRole) && (sub?.planCode ?? "").startsWith("choir_");
  const current = choir
    ? sub?.choirRole === "director"
      ? sub.choirPeriodEndUtc
      : null
    : sub?.isActive && !sub.isLifetime && !viaChoir
      ? sub.currentPeriodEndUtc
      : null;
  const ends = current ? new Date(current) : null;
  const from = ends && ends.getTime() > now.getTime() ? ends : now;
  return `${choir ? "Choir" : "Pro"} until ${dayLabel(advancePeriod(from, plan.interval))}`;
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
 * Pro's price where a locked feature asks for it (the Result's Pro tag, SATB's row, Export's sentence; board n-ux-low
 * Q1h): the limit offer's monthly plan as "₦7,500 a month", "a month" not "/ month" since nothing bought on the
 * website renews. Null until the plans have loaded, and the tag then says "Pro" alone.
 */
export function monthPrice(monthly: Pick<Plan, "amountMinor" | "currency"> | undefined): string | null {
  return monthly ? `${formatPrice(monthly.amountMinor, monthly.currency)} a month` : null;
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
