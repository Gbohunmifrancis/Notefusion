/**
 * A saved sheet's line under its title in the actions sheet (board a-core/11): "72 BPM · 4/4 · saved Sunday", and the
 * reading of the API's dates it needs. Pure; tests: sheetMeta.test.ts.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A date the API wrote, in ms. One with no zone is UTC: whether the JSON carries a `Z` depends on the `DateTime.Kind`
 * EF handed back, and `Date.parse` would read it as the phone's local time (as `screens/admin/parts` notes too).
 */
export function parseUtc(iso: string): number {
  return Date.parse(/(Z|[+-]\d\d:?\d\d)$/i.test(iso) ? iso : `${iso}Z`);
}

/** When it was saved, as a person says it: today, yesterday, a weekday this past week, else "12 Oct" (and the year if not this one). */
export function savedWhen(savedAt: Date, now: Date): string {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(savedAt)) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return WEEKDAYS[savedAt.getDay()]!;
  const date = `${savedAt.getDate()} ${MONTHS[savedAt.getMonth()]}`;
  return savedAt.getFullYear() === now.getFullYear() ? date : `${date} ${savedAt.getFullYear()}`;
}

export function sheetMetaLine(sheet: { tempoBpm: number; timeSignature: string; createdAtUtc: string }, now: Date): string {
  const at = parseUtc(sheet.createdAtUtc);
  return [
    `${Math.round(sheet.tempoBpm)} BPM`,
    sheet.timeSignature,
    Number.isFinite(at) ? `saved ${savedWhen(new Date(at), now)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * A Library row's line when it has no opening solfa to show: "Sunday · Easter service · 72 BPM", in the actions
 * sheet's words for the day and the tempo. `withFolder`: on "All" the folder says where the sheet lives; inside a
 * folder it would repeat the tab.
 */
export function libraryRowLine(
  sheet: { tempoBpm: number; createdAtUtc: string; folder?: string | null },
  withFolder: boolean,
  now: Date,
): string {
  const at = parseUtc(sheet.createdAtUtc);
  const when = Number.isFinite(at) ? savedWhen(new Date(at), now) : null;
  return [
    when ? when.charAt(0).toUpperCase() + when.slice(1) : null,
    withFolder ? sheet.folder : null,
    `${Math.round(sheet.tempoBpm)} BPM`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The Library's line over its name (board n-ux-low Q4d, as Hymns says "789 hymns and tunes"): "12 sheets", "1 sheet",
 * "No sheets yet".
 */
export function sheetCount(count: number): string {
  if (count <= 0) return "No sheets yet";
  return count === 1 ? "1 sheet" : `${count} sheets`;
}
