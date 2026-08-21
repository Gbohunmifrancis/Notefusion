/**
 * Field metrics for the two pages that sit outside the console shell — sign-in and password
 * reset. Both are the same object visually: a 44 px field at radius 8 with a hairline border
 * that takes the accent on focus, and a 13.5 px value inside it.
 *
 * They live here for the same reason the table classes do: retyped in each page they drift,
 * and these two pages are the first thing anyone sees.
 */

/** The bordered box. Wraps the leading icon, the input, and any trailing button. */
export const FIELD =
  "mt-1.5 flex h-11 items-center gap-2.5 rounded-sm border border-border bg-surface px-3.5 transition focus-within:border-accent";

/** The `input` itself, which owns no border of its own. */
export const INPUT =
  "w-full bg-transparent text-[13.5px] text-ink outline-none placeholder:text-faint";

/** The label above the field. */
export const LABEL = "block text-xs font-medium text-muted";

/** The primary submit. Full width, and the only filled button on these pages. */
export const SUBMIT =
  "mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-sm bg-blue text-[13.5px] font-semibold text-white transition hover:bg-blue-deep disabled:cursor-not-allowed disabled:opacity-45";
