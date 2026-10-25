/**
 * Seasonal offers (board p-halloween-offer): wire types and calls for Money › Offers. The types mirror the C#
 * `AdminOfferDto` and friends behind `/api/admin/offers` (camelCase). Change both together.
 *
 * An offer is a lower Pro price (Pro Monthly and/or Yearly, dollar plans only) for a few days on the web app and the
 * website's pricing, plus the one email that tells people. Halloween and Christmas are templates: a skin and default
 * words, never different code. Turning one on and sending its email are confirmed with the admin's passkey or
 * password (`[FreshPhoneUnlock]`); every change goes in the audit log.
 */

import { query, request } from "@/api/client";

export type OfferTemplate = "halloween" | "christmas";

/** `draft`: off. `scheduled`: on, before its start. `running`: on and live. `ended`: every person's midnight has passed. */
export type OfferState = "draft" | "scheduled" | "running" | "ended";

/** Which dollar price set: `standard`, or `regional` (the lower-income markets' `_regional` plans). */
export type OfferPriceSet = "standard" | "regional";

export type OfferInterval = "Monthly" | "Yearly";

/** The email's own words. `{pct}` stands for the percent off and follows it when it changes. */
export interface OfferWords {
  /** ≤ 120 characters. */
  subject: string;
  /** ≤ 200: what the inbox shows beside the subject. */
  preheader: string;
  /** ≤ 120. */
  headline: string;
  /** ≤ 1200; a blank line starts a new paragraph. */
  body: string;
}

/** One dollar Pro plan in the offer: its usual price and the offer's, rounded down to the plan's own ending. */
export interface OfferPlanPrice {
  code: string;
  interval: OfferInterval;
  set: OfferPriceSet;
  /** US cents. */
  amountMinor: number;
  offerAmountMinor: number;
}

/** The email's send, once pressed: who it went to and whether sending is held. */
export interface OfferSend {
  startedAtUtc: string;
  paused: boolean;
  includesFree: boolean;
  includesLapsed: boolean;
  includesProNow: boolean;
}

export interface AdminOffer {
  id: string;
  /** "halloween-2026": the `?offer=` in the email's link. */
  key: string;
  /** "Halloween 2026". */
  name: string;
  template: OfferTemplate;
  /** 5–70. */
  percentOff: number;
  includesMonthly: boolean;
  includesYearly: boolean;
  /** The instant it starts for everyone (set in UK time). */
  startsAtUtc: string;
  /** yyyy-mm-dd: it ends at the midnight after this day in each person's own time zone. */
  lastDay: string;
  enabled: boolean;
  state: OfferState;
  words: OfferWords;
  /** True once the email has been sent: the words are kept as they went out. */
  wordsLocked: boolean;
  plans: OfferPlanPrice[];
  send: OfferSend | null;
  /** False until `Email__PostalAddress` is set on the server; Send is refused until then. */
  postalAddressSet: boolean;
  /** The creating admin's email. */
  createdBy: string | null;
  createdAtUtc: string;
  /** Whether its season (Feature flags) is on for everyone; while it is off the offer shows nowhere and its email waits. */
  seasonOn: boolean;
}

/** A template's defaults for the year ahead, for "New offer". */
export interface OfferTemplateDefaults {
  template: OfferTemplate;
  /** "Halloween 2026". */
  name: string;
  /** "Halloween offer". */
  label: string;
  startsAtUtc: string;
  lastDay: string;
  percentOff: number;
  words: OfferWords;
}

/** `POST /api/admin/offers` and `PUT /api/admin/offers/{id}`. Words left out are the template's (create) or kept. */
export interface OfferChange {
  template: OfferTemplate;
  name?: string;
  percentOff: number;
  includesMonthly: boolean;
  includesYearly: boolean;
  startsAtUtc: string;
  lastDay: string;
  words?: OfferWords;
}

/** The email as the server would send it, rendered by the sender's own template. */
export interface OfferPreview {
  subject: string;
  preheader: string;
  html: string;
  text: string;
}

/** Who the email would go to with these groups ticked. */
export interface OfferAudienceChoice {
  free: boolean;
  lapsed: boolean;
  proNow: boolean;
}

export interface OfferAudience {
  /** Each group's count whether ticked or not. */
  groups: { free: number; lapsed: number; proNow: number };
  /** The ticked groups together. */
  total: number;
  bySet: { standard: number; regional: number };
  /** Never sent it, and why. */
  excluded: { naira: number; noCountry: number; emailOff: number; storeOrChoir: number; recentNote: number };
  /** The email quota as it stands (`EmailBudget`): the offer is optional mail. */
  quota: {
    dailyUsed: number;
    /** Null when there is no daily cap. */
    dailyLimit: number | null;
    /** Optional mail waits once the last 24 hours reach this; null with no daily cap. */
    dailyOptionalLine: number | null;
    monthlyUsed: number;
    /** Null when there is no 31-day cap. */
    monthlyLimit?: number | null;
    monthlyOptionalLine?: number | null;
    /** How many could still go today. */
    roomToday: number;
    /** How many a full day can send at today's limits. */
    perDay: number;
  };
  estimate: {
    /** Days to send to everyone at today's limits; null when nothing can go. */
    days: number | null;
    /** How many would have it before the offer ends for them. */
    reachedBeforeEnd: number;
  };
}

export interface OfferProgress {
  queued: number;
  sent: number;
  skipped: { optedOut: number; bought: number; becamePro: number; ended: number; noLongerEligible: number };
  failed: number;
  /** Emails whose image loaded or whose button was clicked: a floor and a ceiling at once (images off; Apple Mail loads them all). */
  opened: number;
  /** Opened the web app from the email's button. */
  clicked: number;
  /** Completed payments at the offer price, emailed or not. */
  bought: number;
  /** Of those, the buyers who were sent the email. */
  boughtFromEmail: number;
  /** US cents. */
  revenueMinor: number;
  /** yyyy-mm-dd, UK days. */
  byDay: { date: string; sent: number; clicked: number; bought: number; opened: number }[];
  byPlan: { code: string; name: string; set: OfferPriceSet; count: number; revenueMinor: number }[];
}

const base = "/api/admin/offers";
const one = (id: string) => `${base}/${encodeURIComponent(id)}`;
const opts = (signal?: AbortSignal) => (signal ? { signal } : {});

/** Every offer, newest first. */
export const getOffers = (signal?: AbortSignal) => request<AdminOffer[]>(base, opts(signal));

/** Each template's defaults for the year ahead. */
export const getOfferTemplates = (signal?: AbortSignal) =>
  request<OfferTemplateDefaults[]>(`${base}/templates`, opts(signal));

/** A new offer, off until it is turned on. Audit `CreateOffer`. */
export const createOffer = (change: OfferChange) => request<AdminOffer>(base, { method: "POST", body: change });

/** The offer's price, dates, template and (until sent) words. Audit `UpdateOffer`. */
export const updateOffer = (id: string, change: OfferChange) =>
  request<AdminOffer>(one(id), { method: "PUT", body: change });

/** On or off for everyone; wants a fresh confirmation. Audit `SetOfferEnabled`. */
export const setOfferEnabled = (id: string, enabled: boolean) =>
  request<unknown>(`${one(id)}/enabled`, { method: "PUT", body: { enabled } });

/** The email as Grace (free, in the UK) would get it, at one price set. */
export const getOfferPreview = (id: string, set: OfferPriceSet, signal?: AbortSignal) =>
  request<OfferPreview>(`${one(id)}/preview${query({ set, firstName: "Grace" })}`, opts(signal));

/** Mails the preview to the signed-in admin only. It counts toward the day's email. */
export const sendOfferTest = (id: string, set: OfferPriceSet) =>
  request<unknown>(`${one(id)}/test`, { method: "POST", body: { set } });

export const getOfferAudience = (id: string, choice: OfferAudienceChoice, signal?: AbortSignal) =>
  request<OfferAudience>(`${one(id)}/audience${query({ ...choice })}`, opts(signal));

/** Queues the email for the ticked groups; wants a fresh confirmation. Audit `SendOffer`. */
export const sendOffer = (id: string, choice: OfferAudienceChoice) =>
  request<unknown>(`${one(id)}/send`, { method: "POST", body: choice });

/** Holds or resumes the queue. */
export const setOfferSending = (id: string, paused: boolean) =>
  request<unknown>(`${one(id)}/sending`, { method: "PUT", body: { paused } });

export const getOfferProgress = (id: string, signal?: AbortSignal) =>
  request<OfferProgress>(`${one(id)}/progress`, opts(signal));
