import type { Plan } from "../api/types";

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
