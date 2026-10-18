import type {
  LedgerReason,
  PaymentProviderName,
  PaymentStatus,
  WebhookStatus,
} from "@/api/types";
import type { BadgeTone } from "@/components/Badge";

/**
 * Display metadata for the billing pages, in one place for the same reason `src/lib/audit.ts`
 * exists: the payment pill is drawn by both a user's detail page and the global payments table, and
 * each filter has to offer exactly the set the server accepts.
 *
 * The literals are the C# enum member names as they arrive on the wire, and they are also what the
 * filters send back up — MVC binds query-string enums case-insensitively, so one spelling works in
 * both directions and there is no second spelling to keep in step.
 */

/** Attempts are kept, so a table has to be able to show a failure as clearly as a success. */
export const PAYMENT_TONES: Record<PaymentStatus, BadgeTone> = {
  Pending: "neutral",
  Processing: "warning",
  Verified: "blue",
  Completed: "success",
  Failed: "danger",
};

/**
 * What each state means for the customer, hung off the pill as a native tooltip. `Verified` is the
 * one nobody guesses right: it looks like a success and it is a customer who paid and has nothing.
 */
export const PAYMENT_STATUS_TITLES: Record<PaymentStatus, string> = {
  Pending: "Created, but checkout was never opened. The provider has nothing to report on it.",
  Processing: "Checkout is open. The customer may still be paying, or may have walked away.",
  Verified:
    "The money moved but the subscription was never applied — they have paid and cannot use Pro. "
    + "Reconciliation does not recover this state; escalate it.",
  Completed: "Paid, the ledger entry is written, and the subscription is applied.",
  Failed: "Closed. Nothing was taken, and the customer can start a new checkout.",
};

export const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  "Pending",
  "Processing",
  "Verified",
  "Completed",
  "Failed",
];

/** Every gateway the API can be configured with, whether or not this deployment has keys for it. */
export const PAYMENT_PROVIDERS: readonly PaymentProviderName[] = [
  "Paystack",
  "Flutterwave",
  "Bachs",
  "Squad",
];

/**
 * The inbox states, relabelled for a reader. "Received" is the wire value and it says nothing about
 * whether anything happened, which is the only question this column is asked; "Failed" is worse than
 * the truth, because a parked callback does not cost the customer their subscription.
 */
export const WEBHOOK_STATUS_META: Record<
  WebhookStatus,
  { label: string; tone: BadgeTone; title: string }
> = {
  Received: {
    label: "Awaiting",
    tone: "warning",
    title: "Stored and signature-verified. The worker has not applied it yet.",
  },
  Processed: {
    label: "Processed",
    tone: "success",
    title: "The effect was applied, exactly once.",
  },
  Failed: {
    label: "Parked",
    tone: "danger",
    title:
      "The retries ran out and nobody has looked at why. Reconciling the payment recovers the "
      + "subscription regardless, so this is a bug to find, not access to restore.",
  },
};

export const WEBHOOK_STATUSES: readonly WebhookStatus[] = ["Received", "Processed", "Failed"];

/** The stored amount is always positive; the direction carries the sign. */
export const LEDGER_REASON_LABELS: Record<LedgerReason, string> = {
  SubscriptionCharge: "Charge",
  Refund: "Refund",
  TranscriptionPurchase: "One song",
};

export const LEDGER_REASONS: readonly LedgerReason[] = ["SubscriptionCharge", "TranscriptionPurchase", "Refund"];
