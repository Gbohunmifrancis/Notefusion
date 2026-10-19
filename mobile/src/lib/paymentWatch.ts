/**
 * How often a payment is asked about after the checkout browser closes (`subscription.tsx`), pure so the
 * schedule is testable. Each check reaches the payment provider, and most payments land within seconds of the
 * return, so the first is at once and the rest spread out: 3, 6, 12 and 20 s apart, then every 30 s until the
 * watch's ten minutes are up.
 */

export const PAYMENT_CHECK_DELAYS_MS: readonly number[] = [3_000, 6_000, 12_000, 20_000];
export const LATE_PAYMENT_CHECK_MS = 30_000;

/** The wait after the `checksDone`-th check before the next one. */
export function paymentCheckDelayMs(checksDone: number): number {
  return checksDone >= 1 && checksDone <= PAYMENT_CHECK_DELAYS_MS.length
    ? PAYMENT_CHECK_DELAYS_MS[checksDone - 1]
    : LATE_PAYMENT_CHECK_MS;
}
