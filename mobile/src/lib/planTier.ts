import type { Subscription } from "../api/types";

/** "Monthly" or "Yearly" from the plan's name or code, for the member cards on Profile and Upgrade. */
export function tierOf(subscription: Subscription): string {
  const label = `${subscription.planName ?? ""} ${subscription.planCode ?? ""}`.toLowerCase();
  if (label.includes("year")) return "Yearly";
  if (label.includes("month")) return "Monthly";
  return "Pro";
}
