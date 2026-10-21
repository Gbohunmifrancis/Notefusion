/**
 * The Offers page's sums and dates, pure (no React, no `@/` imports) so they read the same anywhere.
 *
 * An offer's times live in two zones. It starts at one instant, set in UK time (Europe/London, as the board writes
 * it: "Mon 26 Oct 09:00 UK time"); it ends at midnight after its last day in each person's own zone. Dates come off
 * the wire as calendar strings ("2026-10-31") and are formatted from their parts, never through `new Date(date)`,
 * which would read them as UTC midnight (see src/lib/format.ts).
 */

export const UK_ZONE = "Europe/London";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const DAY_MS = 86_400_000;

function split(date: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  return match ? { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) } : null;
}

const utcMidnight = (date: string): number => {
  const p = split(date);
  return p ? Date.UTC(p.y, p.m - 1, p.d) : NaN;
};

const pad = (n: number) => String(n).padStart(2, "0");

/** `"2026-10-31"` → `"Sat 31 Oct"`. */
export function formatOfferDay(date: string): string {
  const p = split(date);
  if (!p) return date;
  return `${WEEKDAYS[new Date(utcMidnight(date)).getUTCDay()]} ${p.d} ${MONTHS[p.m - 1]}`;
}

/** `"2026-10-31"` → `"Sat 31 Oct 2026"`. */
export const formatOfferDayYear = (date: string): string => {
  const p = split(date);
  return p ? `${formatOfferDay(date)} ${p.y}` : date;
};

/** `"2026-10-31"` → `"Saturday 31 October"`, the email's own way of saying it. */
export function formatOfferDayWords(date: string): string {
  const p = split(date);
  if (!p) return date;
  return `${WEEKDAYS_LONG[new Date(utcMidnight(date)).getUTCDay()]} ${p.d} ${MONTHS_LONG[p.m - 1]}`;
}

/** `"2026-10-31"` → `"Saturday"`. */
export const weekdayOf = (date: string): string => WEEKDAYS_LONG[new Date(utcMidnight(date)).getUTCDay()] ?? date;

/** Calendar days from `from` to `to` (negative when `to` is earlier). */
export const daysBetween = (from: string, to: string): number => Math.round((utcMidnight(to) - utcMidnight(from)) / DAY_MS);

/** `"2026-10-31"` shifted by whole days. */
export function addCalendarDays(date: string, days: number): string {
  const shifted = new Date(utcMidnight(date) + days * DAY_MS);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** An instant's calendar date and wall-clock time in a zone. */
export function zoneWall(iso: string | number, timeZone: string = UK_ZONE): { date: string; time: string } {
  const ms = typeof iso === "number" ? iso : new Date(iso).getTime();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/** Today's date in the UK. */
export const ukToday = (now: number = Date.now()): string => zoneWall(now).date;

function offsetAt(ms: number, timeZone: string): number {
  const minute = Math.floor(ms / 60_000) * 60_000;
  const wall = zoneWall(minute, timeZone);
  const [h, mi] = wall.time.split(":").map(Number) as [number, number];
  return utcMidnight(wall.date) + h * 3_600_000 + mi * 60_000 - minute;
}

/**
 * The instant a wall-clock date and time in a zone falls on, as ISO: `("2026-10-26", "09:00")` in London is
 * `"2026-10-26T09:00:00.000Z"` (GMT from 25 Oct), and `("2026-10-19", "09:00")` is 08:00Z (BST).
 */
export function wallToUtc(date: string, time: string, timeZone: string = UK_ZONE): string {
  const [h = 0, mi = 0] = time.split(":").map(Number);
  const guess = utcMidnight(date) + h * 3_600_000 + mi * 60_000;
  let utc = guess - offsetAt(guess, timeZone);
  const second = offsetAt(utc, timeZone);
  if (guess - second !== utc) utc = guess - second;
  return new Date(utc).toISOString();
}

/** When the offer ends for someone in this zone: the midnight after its last day. */
export const endInZone = (lastDay: string, timeZone: string): string => wallToUtc(addCalendarDays(lastDay, 1), "00:00", timeZone);

/** The offer's first and last ends among the people it reaches: New Zealand first, Hawaii last, in UK time. */
export function endsAcrossTheWorld(lastDay: string): { first: { date: string; time: string }; last: { date: string; time: string } } {
  return {
    first: zoneWall(endInZone(lastDay, "Pacific/Auckland")),
    last: zoneWall(endInZone(lastDay, "Pacific/Honolulu")),
  };
}

/** US cents as a price: whole dollars without cents (`$79`), otherwise two places (`$9.99`). */
export function formatPrice(minor: number): string {
  const whole = minor % 100 === 0;
  return `$${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 })}`;
}

/** US cents as revenue, always two places: `$704.76`, `$495.00`. */
export const formatRevenue = (minor: number): string =>
  `$${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The words with `{pct}` filled in, as the email will read. */
export const fillPercent = (text: string, percent: number): string => text.replaceAll("{pct}", String(percent));

/** How many of the days' sends are drawn as bars, and how many are left waiting when the offer ends. */
export interface SendingDay {
  date: string;
  count: number;
}

/**
 * The per-day bar under the estimate: from the first sending day to the last day, today's room first and a full
 * day's after it, never more in all than the server says go out in time (`reachedBeforeEnd`), so the bars and the
 * sentence agree. The rest of the people are the "never sent" end of the bar.
 */
export function sendingDays({
  today,
  startDay,
  lastDay,
  total,
  reached,
  roomToday,
  perDay,
}: {
  today: string;
  startDay: string;
  lastDay: string;
  total: number;
  reached: number;
  roomToday: number;
  perDay: number;
}): { days: SendingDay[]; waiting: number } {
  const first = daysBetween(today, startDay) > 0 ? startDay : today;
  const count = Math.max(0, daysBetween(first, lastDay) + 1);
  let left = Math.max(0, Math.min(reached, total));
  const days: SendingDay[] = [];
  for (let i = 0; i < count; i++) {
    const date = addCalendarDays(first, i);
    const room = Math.max(0, date === today ? roomToday : perDay);
    const sent = Math.min(left, room);
    left -= sent;
    days.push({ date, count: sent });
  }
  const drawn = days.reduce((sum, day) => sum + day.count, 0);
  return { days, waiting: Math.max(0, total - drawn) };
}

/**
 * What raising the limits would do: `Email__DailyLimit` at `dailyLimit` and the optional share as now (the line over
 * the limit), counted from the first sending day. `allBy` is the day the last one goes, or null when even that
 * would not reach everyone before the last day; `inTime` is then how many would.
 */
export function atRaisedLimits({
  total,
  share,
  firstDay,
  lastDay,
  dailyLimit = 1000,
}: {
  total: number;
  share: number;
  firstDay: string;
  lastDay: string;
  dailyLimit?: number;
}): { perDay: number; allBy: string | null; inTime: number } {
  const perDay = Math.max(1, Math.floor(dailyLimit * share));
  const daysNeeded = Math.max(1, Math.ceil(total / perDay));
  const allBy = addCalendarDays(firstDay, daysNeeded - 1);
  const daysLeft = Math.max(0, daysBetween(firstDay, lastDay) + 1);
  return daysBetween(allBy, lastDay) >= 0
    ? { perDay, allBy, inTime: total }
    : { perDay, allBy: null, inTime: Math.min(total, perDay * daysLeft) };
}
