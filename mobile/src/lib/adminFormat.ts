/**
 * The phone admin's words and numbers (board f-admin), pure and tested (adminFormat.test.ts): money in the currency
 * paid (never converted, never added across currencies), the console's plan names, "12 min ago", payment rows grouped
 * by day, a payment's timeline, the status pills' tones and the Overview's ranges and series.
 */

// ── Money ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** "₦7,500", "₦7,500.50", "$39.99", "GHS 10.00": minor units are kobo and cents (C# `PaymentPushCopy.Money`). */
export function money(amountMinor: number, currency: string): string {
  const code = currency.toUpperCase();
  const major = amountMinor / 100;
  const grouped = (n: number, decimals: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  if (code === "NGN") return "₦" + grouped(major, amountMinor % 100 === 0 ? 0 : 2);
  if (code === "USD") return "$" + grouped(major, 2);
  return `${code} ${grouped(major, 2)}`;
}

export interface CurrencyAmount {
  currency: string;
  amountMinor: number;
}

/** Naira first, then the rest by code: the order every money line on the admin uses. */
export function byCurrency<T extends { currency: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => {
    const an = a.currency.toUpperCase() === "NGN" ? 0 : 1;
    const bn = b.currency.toUpperCase() === "NGN" ? 0 : 1;
    return an - bn || a.currency.localeCompare(b.currency);
  });
}

/** Sums per currency, never across: [{NGN, 900000}, {USD, 3999}]. */
export function totals(items: readonly CurrencyAmount[]): CurrencyAmount[] {
  const sums = new Map<string, number>();
  for (const i of items) {
    const code = i.currency.toUpperCase();
    sums.set(code, (sums.get(code) ?? 0) + i.amountMinor);
  }
  return byCurrency([...sums].map(([currency, amountMinor]) => ({ currency, amountMinor })));
}

/** "₦9,000 · $39.99", or the empty string for nothing. */
export function moneyLine(items: readonly CurrencyAmount[]): string {
  return items.map((i) => money(i.amountMinor, i.currency)).join(" · ");
}

// ── Plans ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** "NoteFusion Pro (Monthly)" → "Pro Monthly"; "One song" stays; nothing → "Payment" (C# `ShortPlan`). */
export function shortPlan(planName: string | null | undefined): string {
  const name = planName?.trim();
  if (!name) return "Payment";
  const m = /^NoteFusion\s+(.+?)\s*\((.+)\)$/.exec(name);
  return m ? `${m[1]} ${m[2]}` : name;
}

// ── Time ───────────────────────────────────────────────────────────────────────────────────────────────────────

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The API's instants are UTC; a value without a zone is read as UTC too. */
export function parseUtc(iso: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z");
}

/** "18:42" on the phone's clock. */
export function clock(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "Sun 18 Oct". */
export function dayShort(d: Date): string {
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "18 Oct", or "18 Oct 2027" outside this year. */
export function dayMonth(d: Date, now: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ""}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "Wed 18 Nov" this year, "18 Nov 2027" after it. */
export function proUntil(d: Date, now: Date): string {
  return d.getFullYear() === now.getFullYear() ? dayShort(d) : dayMonth(d, now);
}

/** "Today", "Yesterday", or "Sun 11 Oct". */
export function dayLabel(d: Date, now: Date): string {
  if (sameDay(d, now)) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return "Yesterday";
  return dayShort(d);
}

/** "now", "12 min", "3 h", "Yesterday", "5 d", "18 Oct": how long ago, short enough for a row's corner. */
export function ago(d: Date, now: Date): string {
  const min = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24 && sameDay(d, now)) return `${h} h`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return "Yesterday";
  const days = Math.max(1, Math.round((now.getTime() - d.getTime()) / 86_400_000));
  return days < 30 ? `${days} d` : dayMonth(d, now);
}

/** "12 min ago", "Yesterday", "just now": `ago` as a sentence's end. */
export function agoSentence(d: Date, now: Date): string {
  const when = ago(d, now);
  return when === "now" ? "just now" : /^\d+ (min|h|d)$/.test(when) ? `${when} ago` : when;
}

/** "Good morning", "Good afternoon", "Good evening" for the hour on the phone's clock. */
export function greeting(hour: number): string {
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

/** When the free week next turns: Friday 18:00 West Africa Time, 17:00 UTC, for everyone (C# `FreeTier.NextReset`). */
export function nextFreeReset(now: Date): Date {
  const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 17, 0, 0));
  const ahead = (5 - t.getUTCDay() + 7) % 7;
  t.setUTCDate(t.getUTCDate() + ahead);
  if (t.getTime() <= now.getTime()) t.setUTCDate(t.getUTCDate() + 7);
  return t;
}

// ── The Overview's range ───────────────────────────────────────────────────────────────────────────────────────

export type RangePreset = 7 | 30 | 90;

/** The window a preset covers, ending now: what the console sends as `from`/`to`. */
export function rangeFor(days: RangePreset, now: Date): { from: Date; to: Date } {
  const from = new Date(now);
  from.setDate(now.getDate() - (days - 1));
  from.setHours(0, 0, 0, 0);
  return { from, to: now };
}

/** "19 Sep – 18 Oct". */
export function rangeLabel(from: Date, to: Date): string {
  return `${from.getDate()} ${MONTHS[from.getMonth()]} – ${to.getDate()} ${MONTHS[to.getMonth()]}`;
}

/** The change against the period before, as a whole percentage; null when there was nothing before. */
export function change(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export interface DayCount {
  date: string;
  count: number;
}

export type Bucket = "day" | "week" | "month";

/** A daily series grouped by week (from each Monday) or month, labelled by its first day. */
export function bucketSeries(series: readonly DayCount[], by: Bucket): DayCount[] {
  if (by === "day") return [...series];
  const out: DayCount[] = [];
  for (const p of series) {
    const d = new Date(p.date + "T00:00:00");
    let key: string;
    if (by === "week") {
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      key = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
    } else {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    }
    const last = out[out.length - 1];
    if (last && last.date === key) last.count += p.count;
    else out.push({ date: key, count: p.count });
  }
  return out;
}

/** The busiest day, the average a day and the total of a series. */
export function seriesFacts(series: readonly DayCount[]): { busiest: DayCount | null; average: number; total: number } {
  const total = series.reduce((n, p) => n + p.count, 0);
  const busiest = series.reduce<DayCount | null>((b, p) => (!b || p.count > b.count ? p : b), null);
  return { busiest, average: series.length ? Math.round(total / series.length) : 0, total };
}

/** A chart's top line: the next round step above the largest value (5, 10, 20, 50, 100, …). */
export function niceMax(max: number): number {
  if (max <= 5) return 5;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 5, 10]) if (m * pow >= max) return m * pow;
  return 10 * pow;
}

// ── Payments ───────────────────────────────────────────────────────────────────────────────────────────────────

export type PaymentStatus = "Pending" | "Processing" | "Verified" | "Completed" | "Failed";

/** The web console's pill tones (web-admin `lib/payments.ts` PAYMENT_TONES). */
export type Tone = "ok" | "warn" | "bad" | "blue" | "neutral" | "prem" | "choir";

export const PAYMENT_TONE: Record<PaymentStatus, Tone> = {
  Pending: "neutral",
  Processing: "warn",
  Verified: "blue",
  Completed: "ok",
  Failed: "bad",
};

export interface PaymentRowLike {
  provider: string;
  status: PaymentStatus;
  amountMinor: number;
  currency: string;
  planName: string | null;
  isStuck: boolean;
  createdAtUtc: string;
  updatedAtUtc: string;
}

/** The row's second line: plan, provider and the one fact that matters ("18:42", "stuck 42 min", "paid, no Pro"). */
export function paymentLine(p: PaymentRowLike, now: Date): string {
  const fact =
    p.status === "Verified"
      ? "paid, no Pro"
      : p.status === "Processing" && p.isStuck
        ? `stuck ${stuckFor(parseUtc(p.updatedAtUtc), now)}`
        : p.status === "Failed"
          ? "failed"
          : p.status === "Pending"
            ? "not opened"
            : clock(parseUtc(p.status === "Completed" ? p.updatedAtUtc : p.createdAtUtc));
  return `${shortPlan(p.planName)} · ${p.provider} · ${fact}`;
}

/** "42 min", "2 h": how long a checkout has been stuck. */
export function stuckFor(since: Date, now: Date): string {
  const min = Math.max(1, Math.floor((now.getTime() - since.getTime()) / 60000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h`;
}

export interface DayGroup<T> {
  label: string;
  items: T[];
  /** Completed money that day, per currency. */
  paid: CurrencyAmount[];
}

/** Rows (newest first) grouped by the phone's day, each with what was paid that day. */
export function groupByDay<T extends PaymentRowLike>(rows: readonly T[], now: Date): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const row of rows) {
    const label = dayLabel(parseUtc(row.createdAtUtc), now);
    let g = groups[groups.length - 1];
    if (!g || g.label !== label) {
      g = { label, items: [], paid: [] };
      groups.push(g);
    }
    g.items.push(row);
  }
  for (const g of groups)
    g.paid = totals(g.items.filter((r) => r.status === "Completed").map((r) => ({ currency: r.currency, amountMinor: r.amountMinor })));
  return groups;
}

/** "AO" for Ada Obi; "?" for nothing. */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0]![0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] || "them";
}

export interface TimelineStep {
  title: string;
  detail?: string;
  at: Date;
  /** Blue for the start, mint for what went through, amber for what is waiting, grey for a dead end. */
  tone: "start" | "ok" | "warn" | "neutral";
}

export interface TimelineInput {
  payment: PaymentRowLike & { id: string };
  webhooks: readonly { eventType: string; status: string; processAttempts: number; receivedAtUtc: string; processedAtUtc: string | null }[];
  ledger: readonly { direction: string; amountMinor: number; currency: string; createdAtUtc: string }[];
  /** The membership's end now, for "Pro until …"; null when the payment bought none (one song) or it is unknown. */
  proUntilUtc?: string | null;
  isSingle?: boolean;
  isChoir?: boolean;
  choirSeats?: number | null;
}

/**
 * "What happened", as the console's timeline: checkout opened, the provider's word, the ledger credit, what it
 * applied. Our own facts only; the provider's raw replies stay one tap down.
 */
export function paymentTimeline(t: TimelineInput, now: Date): TimelineStep[] {
  const p = t.payment;
  const steps: TimelineStep[] = [{ title: "Checkout opened", detail: p.provider, at: parseUtc(p.createdAtUtc), tone: "start" }];

  for (const w of t.webhooks) {
    const processed = w.status === "Processed";
    steps.push({
      title: processed ? `${p.provider} confirmed the charge` : w.status === "Failed" ? `${p.provider}'s callback was parked` : `${p.provider}'s callback is waiting`,
      detail: `${w.eventType} · ${processed ? (w.processAttempts <= 1 ? "processed on the first try" : `processed after ${w.processAttempts} tries`) : `${w.processAttempts} ${w.processAttempts === 1 ? "try" : "tries"}`}`,
      at: parseUtc(w.processedAtUtc ?? w.receivedAtUtc),
      tone: processed ? "ok" : w.status === "Failed" ? "neutral" : "warn",
    });
  }

  for (const e of t.ledger) {
    steps.push({
      title: `Ledger ${e.direction === "Debit" ? "debit" : "credit"} ${money(e.amountMinor, e.currency)}`,
      at: parseUtc(e.createdAtUtc),
      tone: "ok",
    });
  }

  if (p.status === "Completed") {
    const at = parseUtc(p.updatedAtUtc);
    if (t.isSingle) steps.push({ title: "One transcription added", at, tone: "ok" });
    else if (t.isChoir) steps.push({ title: `Choir open${t.choirSeats ? `: ${t.choirSeats} seats` : ""}`, at, tone: "ok" });
    else if (t.proUntilUtc) {
      const until = parseUtc(t.proUntilUtc);
      steps.push({
        title: until.getFullYear() >= 9000 ? "Pro for life" : `Pro until ${proUntil(until, now)}`,
        at,
        tone: "ok",
      });
    }
  } else if (p.status === "Verified") {
    steps.push({ title: "Paid, but Pro was never applied", detail: "The sweep does not touch this. Escalate it.", at: parseUtc(p.updatedAtUtc), tone: "warn" });
  } else if (p.status === "Processing") {
    steps.push({
      title: p.isStuck ? `Waiting for ${p.provider}: stuck ${stuckFor(parseUtc(p.updatedAtUtc), now)}` : `Waiting for ${p.provider}`,
      detail: p.isStuck ? "Reconcile asks now; the sweep asks every 5 minutes." : undefined,
      at: parseUtc(p.updatedAtUtc),
      tone: "warn",
    });
  } else if (p.status === "Failed") {
    steps.push({ title: "Closed. Nothing was taken", at: parseUtc(p.updatedAtUtc), tone: "neutral" });
  }

  return steps.sort((a, b) => a.at.getTime() - b.at.getTime());
}

// ── Health ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** The API's rolled-up word for the stack, said as the console says it. */
export function healthWord(status: string): { word: string; tone: Tone } {
  switch (status.toLowerCase()) {
    case "healthy":
      return { word: "Operational", tone: "ok" };
    case "degraded":
      return { word: "Degraded", tone: "warn" };
    default:
      return { word: "Down", tone: "bad" };
  }
}

/** A tier's pill: Healthy (mint), Degraded (amber), Down (red: the one place red is a status). */
export function tierTone(status: string): Tone {
  const s = status.toLowerCase();
  return s === "healthy" ? "ok" : s === "degraded" ? "warn" : "bad";
}

/** A meter's fill: green under the optional-mail line, amber past it, red at the cap. */
export function quotaTone(sent: number, optionalCeiling: number, limit: number): Tone {
  if (limit > 0 && sent >= limit) return "bad";
  if (sent >= optionalCeiling) return "warn";
  return "ok";
}

const COUNTRIES: Record<string, string> = {
  NG: "Nigeria", GH: "Ghana", KE: "Kenya", ZA: "South Africa", UG: "Uganda", TZ: "Tanzania", RW: "Rwanda",
  CM: "Cameroon", ZM: "Zambia", ZW: "Zimbabwe", ET: "Ethiopia", EG: "Egypt", MW: "Malawi", SL: "Sierra Leone",
  LR: "Liberia", GM: "The Gambia", SN: "Senegal", CI: "Côte d'Ivoire", BJ: "Benin", TG: "Togo", BW: "Botswana",
  NA: "Namibia", IN: "India", PK: "Pakistan", BD: "Bangladesh", PH: "Philippines", ID: "Indonesia", VN: "Vietnam",
  US: "United States", GB: "United Kingdom", CA: "Canada", IE: "Ireland", DE: "Germany", FR: "France",
  NL: "Netherlands", AU: "Australia", AE: "United Arab Emirates",
};

/** "Nigeria" for NG; the code itself for one not listed; null for none. */
export function countryName(code: string | null | undefined): string | null {
  if (!code) return null;
  return COUNTRIES[code.toUpperCase()] ?? code.toUpperCase();
}

/** "1,032", whole numbers grouped. */
export function count(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** "412 MB", "1.2 GB". */
export function bytes(n: number | null | undefined): string {
  if (!n) return "0 MB";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(n / 1e6))} MB`;
}
