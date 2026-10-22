import type { CheckoutExitReason } from "@/api/types";

/** The answers to "What stopped you?", as the customer read them (Growth's card and the Unpaid checkouts page). */
export const REASON_LABELS: Record<CheckoutExitReason, string> = {
  currency: "The price wasn't in my currency",
  cardDeclined: "My card was declined",
  slow: "The page was slow or didn't load",
  tooExpensive: "It costs too much",
  justLooking: "I'm just looking",
  somethingElse: "Something else",
};
