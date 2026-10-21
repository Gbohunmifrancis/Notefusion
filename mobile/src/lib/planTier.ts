import type { Subscription } from "../api/types";

/** "Monthly" or "Yearly" from the plan's name or code, for the member cards on Profile and Upgrade. */
export function tierOf(subscription: Pick<Subscription, "planName" | "planCode">): string {
  const label = `${subscription.planName ?? ""} ${subscription.planCode ?? ""}`.toLowerCase();
  if (label.includes("year")) return "Yearly";
  if (label.includes("month")) return "Monthly";
  return "Pro";
}

/**
 * The member hub's plan row on Upgrade (board n-ux-low Q2b g): "NoteFusion Pro · Yearly", or the choir's name and
 * period for Pro through a choir. Said once, under the page's title, in place of the old card, badge and Plan row.
 */
export function memberPlanLabel(
  sub: Pick<Subscription, "planName" | "planCode" | "isLifetime" | "isGift" | "choirRole" | "choirName">,
): string {
  if (sub.isLifetime) return "NoteFusion Pro · Lifetime";
  if (sub.isGift) return "NoteFusion Pro · Gift";
  const viaChoir = Boolean(sub.choirRole) && (sub.planCode ?? "").startsWith("choir_");
  const name = viaChoir ? sub.choirName || "Your choir" : "NoteFusion Pro";
  const tier = tierOf(sub);
  return tier === "Pro" ? name : `${name} · ${tier}`;
}

/**
 * The plan row's second line for a membership bought on the website: its state and its date, once ("Active · Pro until
 * 20 Oct 2027"). `until` is the period's end as the page writes a date. Google Play's are `playStateLine`'s.
 */
export function memberStateLine(sub: Pick<Subscription, "status" | "isLifetime" | "isGift">, until: string | null): string {
  if (sub.isLifetime) return "Paid in full";
  const to = until ? ` · Pro until ${until}` : "";
  if (sub.isGift) return `Complimentary${to}`;
  return `${sub.status === "canceled" ? "Cancelled" : "Active"}${to}`;
}
