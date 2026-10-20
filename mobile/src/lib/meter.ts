/**
 * "Beats in a bar": the meters a person may name before transcribing. Without one the worker
 * writes its own meter (4/4 today), so a 3/4 hymn came back barred in fours. The API accepts
 * exactly these (`Meters.Supported` in src/NoteFusion.Application/Transcriptions/Meters.cs) and the
 * website offers the same (web-site/assets/meter.js) — keep the three in lock-step;
 * web-site/tests/meter.test.mjs checks them. "Not sure" (null) sends nothing.
 *
 * The choice is not remembered between songs: it belongs to the piece, not the person, and a 3/4
 * left over from last week's hymn would silently bar this week's chorus in threes.
 */

export const METERS = ["2/4", "3/4", "4/4", "6/8"] as const;

export type Meter = (typeof METERS)[number];

export interface MeterChoice {
  value: Meter | null;
  /** What the chip says. */
  short: string;
  /** The line under the chips once it is chosen. */
  label: string;
}

export const METER_CHOICES: readonly MeterChoice[] = [
  { value: null, short: "Not sure", label: "Not sure — leave it to us." },
  { value: "2/4", short: "2", label: "2 (2/4)" },
  { value: "3/4", short: "3", label: "3 (3/4 — waltz, many hymns)" },
  { value: "4/4", short: "4", label: "4 (4/4 — most songs)" },
  { value: "6/8", short: "6", label: "6 (6/8 — lilting)" },
];

/** The line describing a choice. */
export function meterLabel(meter: Meter | null): string {
  return (METER_CHOICES.find((c) => c.value === meter) ?? METER_CHOICES[0]).label;
}

/** The choice as Song link's "More options" row shows it while folded: "Beats in a bar: Not sure". */
export function meterSummary(meter: Meter | null): string {
  return `Beats in a bar: ${(METER_CHOICES.find((c) => c.value === meter) ?? METER_CHOICES[0]).short}`;
}

/** The analytics value for a submission: the meter, or "not_sure". */
export function meterEventValue(meter: Meter | null): string {
  return meter ?? "not_sure";
}
