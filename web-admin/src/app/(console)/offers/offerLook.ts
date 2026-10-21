import { Ghost, Snowflake, TicketPercent } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { ApiError } from "@/api/client";
import type { AdminOffer, OfferInterval, OfferPriceSet, OfferState } from "@/api/offers";
import type { BadgeTone } from "@/components/Badge";
import { daysBetween, formatOfferDay, formatPrice, ukToday, zoneWall } from "@/lib/offers";

/**
 * A template is a skin (board p-halloween-offer/6e): the email's header art, the line's colour and the tint of the
 * banner and the price tags. The tile here draws the email's header as it is sent: the art over the dark header.
 */
export interface OfferLook {
  /** "Halloween". */
  name: string;
  /** "Halloween offer", as the email, the banner and the dialogs say it. */
  label: string;
  icon: LucideIcon;
  /** The email's header art (560×240, shown 140×60 here). */
  art: string | null;
  /** The glow under the art. */
  tint: string;
  /** The small line under the wordmark: moon cream for Halloween, candle for Christmas. */
  lineColor: string;
}

export const LOOKS = {
  halloween: {
    name: "Halloween",
    label: "Halloween offer",
    icon: Ghost,
    art: "/offer/season-halloween.png",
    tint: "rgba(242,138,58,0.16)",
    lineColor: "#EDE6CF",
  },
  christmas: {
    name: "Christmas",
    label: "Christmas offer",
    icon: Snowflake,
    art: "/offer/season-christmas.png",
    tint: "rgba(46,138,102,0.22)",
    lineColor: "#F3DFB4",
  },
} as const satisfies Record<string, OfferLook>;

export const TEMPLATE_ORDER = ["halloween", "christmas"] as const;

/** A template this console has no skin for still reads as an offer. */
export function lookOf(template: string): OfferLook {
  return (LOOKS as Record<string, OfferLook>)[template] ?? {
    name: template,
    label: "offer",
    icon: TicketPercent,
    art: null,
    tint: "rgba(59,130,246,0.16)",
    lineColor: "#C9D3E3",
  };
}

export const OFFERS_KEY = ["offers"] as const;
export const offerKeys = {
  preview: (id: string) => ["offer-preview", id] as const,
  audience: (id: string) => ["offer-audience", id] as const,
  progress: (id: string) => ["offer-progress", id] as const,
};

/** "Pro Monthly and Yearly", "Pro Monthly", "Pro Yearly". */
export function planWords(offer: Pick<AdminOffer, "includesMonthly" | "includesYearly">): string {
  if (offer.includesMonthly && offer.includesYearly) return "Pro Monthly and Yearly";
  return offer.includesMonthly ? "Pro Monthly" : "Pro Yearly";
}

/** The plan rows the offer prices, by interval and set. */
export function priceOf(offer: AdminOffer, interval: OfferInterval, set: OfferPriceSet) {
  return offer.plans.find((plan) => plan.interval === interval && plan.set === set) ?? null;
}

/** The set's headline offer price for the toggles: monthly when it is in the offer, else yearly. */
export function headlinePrice(offer: AdminOffer, set: OfferPriceSet): string | null {
  const plan =
    (offer.includesMonthly ? priceOf(offer, "Monthly", set) : null) ?? (offer.includesYearly ? priceOf(offer, "Yearly", set) : null);
  return plan ? formatPrice(plan.offerAmountMinor) : null;
}

/** The set's offer prices in the offer's plans, "$6.99, $55". */
export function setPrices(offer: AdminOffer, set: OfferPriceSet): string {
  const intervals: OfferInterval[] = [
    ...(offer.includesMonthly ? (["Monthly"] as const) : []),
    ...(offer.includesYearly ? (["Yearly"] as const) : []),
  ];
  return intervals
    .map((interval) => priceOf(offer, interval, set))
    .filter((plan) => plan !== null)
    .map((plan) => formatPrice(plan.offerAmountMinor))
    .join(", ");
}

/** The offer's start as UK date and time. */
export const startOf = (offer: Pick<AdminOffer, "startsAtUtc">) => zoneWall(offer.startsAtUtc);

/** The state pill for the list. */
export function stateBadge(offer: AdminOffer, now = Date.now()): { label: string; tone: BadgeTone } {
  const state: OfferState = offer.state;
  if (state === "running") {
    const left = daysBetween(ukToday(now), offer.lastDay);
    return { label: left <= 0 ? "On · last day" : `On · ${left} ${left === 1 ? "day" : "days"} left`, tone: "success" };
  }
  if (state === "scheduled") return { label: `Starts ${formatOfferDay(startOf(offer).date)}`, tone: "blue" };
  if (state === "ended") return { label: "Ended", tone: "neutral" };
  return { label: "Draft", tone: "neutral" };
}

/** The card's own pill: shorter, as the switch beside it says the rest. */
export const STATE_PILL: Record<OfferState, { label: string; tone: BadgeTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  scheduled: { label: "Scheduled", tone: "blue" },
  running: { label: "On", tone: "success" },
  ended: { label: "Ended", tone: "neutral" },
};

export const people = (n: number) => (n === 1 ? "person" : "people");

/**
 * Plain sentences for the offer routes' refusals, for when the server sent no words of its own. A refusal with its
 * own sentence keeps it: those are written for this reader.
 */
const PLAIN: Record<string, string> = {
  OFFER_POSTAL_ADDRESS_MISSING:
    "The email needs the company's postal address in its footer. Set Email__PostalAddress on the server, then send.",
  OFFER_NOT_ENABLED: "Turn the offer on before sending its email.",
  OFFER_ENDED: "This offer has ended, so its email can't be sent.",
  OFFER_ALREADY_SENT: "This offer's email has already been sent.",
  OFFER_OVERLAPS: "Another offer that's on runs at the same time. One offer runs at a time: turn the other off or move its dates.",
  NETWORK: "We couldn't reach the server. Check your connection and try again.",
};

/** The error to show: the server's own sentence, else a plain one. Never a status line or a browser's words. */
export function offerError(error: unknown, fallback: string): Error {
  if (error instanceof ApiError) {
    const generic = error.code === "UNKNOWN" || !error.message || error.message.startsWith("Request failed");
    if (!generic) return error;
    return new ApiError(error.status, { code: error.code, message: PLAIN[error.code] ?? fallback });
  }
  if (error instanceof TypeError) return new Error(PLAIN.NETWORK);
  return new Error(fallback);
}

/** A failed quiet save, as the flags page reports one: the sentence, and the code under it. */
export function toastOfferError(error: unknown, fallback: string) {
  const shown = offerError(error, fallback);
  toast.error(shown.message, shown instanceof ApiError && shown.code !== "UNKNOWN" ? { description: shown.code } : {});
}
