/**
 * Formatting, with one rule running through all of it: the dashboard displays what the
 * server measured, in the zone the server measured it in.
 *
 * The API groups days in the reporting zone (West Africa Time, UTC+1) and echoes that
 * offset as `reportingOffsetMinutes`. If the browser reformatted timestamps in its own
 * zone, an admin in London would read a bar labelled "12 Aug" that the server built from
 * WAT days, and the label and the number would disagree.
 *
 * Two shapes come off the wire and they need opposite treatment:
 *
 *   - Calendar dates ("2026-07-12" in `DailyCount.date`, `RetentionCohort.cohortStart`)
 *     are *already* reporting-local. They must be formatted from their string parts.
 *     `new Date("2026-07-12")` parses as UTC midnight, which in any negative-offset
 *     browser renders as 11 July — the whole chart silently slides one day left.
 *
 *   - Instants (`fromUtc`, `createdAt`, `lastLoginAt`) are absolute, and must be shifted
 *     into the reporting zone before their wall-clock fields are read.
 */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** Placeholder for a value the API could not compute. Never render 0 in its place. */
export const UNKNOWN = "—";

const NUMBER = new Intl.NumberFormat("en-NG");

export const formatCount = (value: number) => NUMBER.format(value);

/** `1536` → `"1.5 KB"`. Binary units; three significant figures read cleanly on a tile. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${formatCount(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

/** `0.9412` → `"94.1%"`. Null means undefined, not zero. */
export function formatPercent(value: number | null, fractionDigits = 1): string {
  if (value === null) return UNKNOWN;
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

/**
 * `(750000, "NGN")` → `"₦7,500.00"`. The API stores minor units — kobo, cents — so this divides
 * before formatting. Dividing by a fixed 100 rather than asking Intl for the currency's exponent
 * is correct for both currencies this app charges in and wrong for a zero-decimal one like JPY;
 * that is a real limit, and it is here rather than spread across the pages that display money.
 */
export function formatMoney(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(
      amountMinor / 100,
    );
  } catch {
    // An unknown ISO code throws rather than degrading, and a payment row is not worth a blank page.
    return `${currency} ${(amountMinor / 100).toFixed(2)}`;
  }
}

/** A signed change against the previous period, or null when there is nothing to compare. */
export function changeAgainst(
  current: number,
  previous: number,
): { label: string; up: boolean } | null {
  if (previous === 0) {
    // A jump from nothing is not "+∞%", "+100%" would be a lie, and "+122 vs none" read as a
    // comparison when there was nothing to compare with. No previous figure: no comparison.
    return null;
  }
  // Off a handful, a percentage is noise ("+5550%" from 2 to 113): say the difference itself.
  if (previous < 10) {
    const diff = current - previous;
    return { label: `${diff >= 0 ? "+" : "−"}${formatCount(Math.abs(diff))} vs previous`, up: diff >= 0 };
  }
  const delta = (current - previous) / previous;
  const sign = delta >= 0 ? "+" : "";
  return { label: `${sign}${(delta * 100).toFixed(0)}% vs previous`, up: delta >= 0 };
}

// ── Calendar dates: format from the string, never through Date ───────────────────

interface DateParts {
  year: number;
  month: number;
  day: number;
}

function splitCalendarDate(value: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** `"2026-07-12"` → `"12 Jul"`. Chart axis labels. */
export function formatDayShort(value: string): string {
  const parts = splitCalendarDate(value);
  if (!parts) return value;
  return `${parts.day} ${MONTHS[parts.month - 1]}`;
}

/** `"2026-07-12"` → `"12 Jul 2026"`. */
export function formatDayLong(value: string): string {
  const parts = splitCalendarDate(value);
  if (!parts) return value;
  return `${parts.day} ${MONTHS[parts.month - 1]} ${parts.year}`;
}

/** `"2026-07-12"` → `"Jul"`. Axis labels once days are grouped by month. */
export function formatMonthShort(value: string): string {
  const parts = splitCalendarDate(value);
  if (!parts) return value;
  return MONTHS[parts.month - 1] ?? value;
}

/** `"2026-07-12"` → `"Jul 2026"`. */
export function formatMonthYear(value: string): string {
  const parts = splitCalendarDate(value);
  if (!parts) return value;
  return `${MONTHS[parts.month - 1] ?? ""} ${parts.year}`.trim();
}

/** `"2026-07-12"` → `"Week of 12 Jul"`. Retention cohort labels. */
export const formatWeekOf = (value: string) => `Week of ${formatDayShort(value)}`;

// ── Instants: shift into the reporting zone, then read wall-clock fields ─────────

function shiftToReporting(iso: string, offsetMinutes: number): Date | null {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;
  return new Date(instant.getTime() + offsetMinutes * 60_000);
}

/** An absolute timestamp as a reporting-local date, e.g. `"12 Jul 2026"`. */
export function formatInstantDate(iso: string, offsetMinutes: number): string {
  const shifted = shiftToReporting(iso, offsetMinutes);
  if (!shifted) return UNKNOWN;
  return `${shifted.getUTCDate()} ${MONTHS[shifted.getUTCMonth()]} ${shifted.getUTCFullYear()}`;
}

/** An absolute timestamp as a reporting-local date and time, e.g. `"12 Jul 2026, 14:05"`. */
export function formatInstantDateTime(
  iso: string | null,
  offsetMinutes: number,
): string {
  if (!iso) return UNKNOWN;
  const shifted = shiftToReporting(iso, offsetMinutes);
  if (!shifted) return UNKNOWN;
  const hours = String(shifted.getUTCHours()).padStart(2, "0");
  const minutes = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${formatInstantDate(iso, offsetMinutes)}, ${hours}:${minutes}`;
}

/**
 * A coarse "how long ago" label for the activity feed, e.g. `"3h ago"`. Zone-independent:
 * it is the elapsed span between two instants, so no reporting-offset shift is needed. `nowMs`
 * is passed in rather than read from the clock so the caller controls when "now" is sampled.
 */
export function formatRelative(iso: string, nowMs: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return UNKNOWN;
  const seconds = Math.max(0, Math.round((nowMs - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  return `${weeks}w ago`;
}

/** `60` → `"UTC+1"`. Shown once in the header so the reader knows the zone. */
export function formatOffset(offsetMinutes: number): string {
  if (offsetMinutes === 0) return "UTC";
  const sign = offsetMinutes > 0 ? "+" : "-";
  const total = Math.abs(offsetMinutes);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `UTC${sign}${hours}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""}`;
}

/**
 * Today in the reporting zone as `"YYYY-MM-DD"`, for seeding the date inputs. Built from
 * the shifted UTC fields rather than the browser's local date so the default range the
 * dashboard requests is the range the server would call "today".
 */
export function reportingToday(offsetMinutes: number): string {
  const shifted = new Date(Date.now() + offsetMinutes * 60_000);
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${month}-${day}`;
}

/** `"YYYY-MM-DD"` shifted by whole days, staying in calendar-date space. */
export function addDays(date: string, days: number): string {
  const parts = splitCalendarDate(date);
  if (!parts) return date;
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${month}-${day}`;
}

/**
 * The instant a reporting-local day begins, as UTC — in WAT (UTC+1), `"2026-08-23"` becomes
 * `"2026-08-22T23:00:00.000Z"`. Null when the date is not one.
 *
 * The date inputs speak reporting-local calendar days and the payment and ledger routes bound on
 * instants, so something has to do this conversion. Sending the bare date instead would have the
 * server read it as UTC midnight, which is an hour into the reporting day: a window on "23 August"
 * would silently drop that day's first hour and pick up an hour of the 22nd at the other end.
 *
 * Both bounds go through it. The upper one is exclusive server-side, so a window ending on the 23rd
 * passes the start of the 24th rather than the start of the 23rd.
 */
export function reportingDayStartUtc(date: string, offsetMinutes: number): string | null {
  const parts = splitCalendarDate(date);
  if (!parts) return null;
  const midnight = Date.UTC(parts.year, parts.month - 1, parts.day);
  return new Date(midnight - offsetMinutes * 60_000).toISOString();
}

export function getFlagEmoji(countryCode: string | null | undefined): string {
  if (!countryCode || countryCode.length !== 2) return "";
  const codePoints = countryCode
    .toUpperCase()
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}
