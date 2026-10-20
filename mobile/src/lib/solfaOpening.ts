import type { NoteEvent } from "../api/types";

/**
 * The opening of a sheet in solfa: the first bar, then the start of the next after a
 * bar line, so a list row reads like the top of the page ("d r m f │ s – l s").
 * Null when there are no notes to show. List rows pass the server's `preview` (the
 * first eight notes); a sheet that already has its notes passes those.
 */
export function solfaOpening(
  notes: readonly NoteEvent[] | null | undefined,
  timeSignature: string,
): { first: string; rest: string } | null {
  const sorted = [...(notes ?? [])].sort((a, b) => a.startBeat - b.startBeat).slice(0, 8);
  if (sorted.length === 0) return null;
  const [num, den] = timeSignature.split("/").map(Number);
  const perBar = num && den ? (num * 4) / den : 4;
  const firstBar = Math.floor(sorted[0]!.startBeat / perBar);
  const label = (n: NoteEvent) => n.solfa + n.octaveMark;
  const inFirst = sorted.filter((n) => Math.floor(n.startBeat / perBar) === firstBar);
  const after = sorted.slice(inFirst.length, inFirst.length + 4);
  return { first: inFirst.map(label).join(" "), rest: after.map(label).join(" ") };
}

/**
 * How a tune starts, bar by bar as its time signature writes it, a "–" for each further beat a note is held:
 * "s, d d r │ m – r d". The first `count` notes. Result's previews (board m-ux-medium P1e) set a doh to choose, or
 * the hymnbook version, beside the sheet as it is, so the change is seen before it is made. Null with no notes.
 */
export function openingBars(notes: readonly NoteEvent[] | null | undefined, timeSignature: string, count = 8): string | null {
  const sorted = [...(notes ?? [])].sort((a, b) => a.startBeat - b.startBeat).slice(0, count);
  if (sorted.length === 0) return null;
  const [num, den] = timeSignature.split("/").map(Number);
  const perBar = num && den ? (num * 4) / den : 4;
  // The beat a "–" stands for: the dotted crotchet in compound time, as a choir counts it (SheetGrid's columns).
  const beat = num && den ? (den === 8 && num % 3 === 0 && num > 3 ? 1.5 : 4 / den) : 1;
  const bars: string[][] = [];
  let lastBar: number | null = null;
  for (const n of sorted) {
    const bar = Math.floor(n.startBeat / perBar + 1e-6);
    if (bar !== lastBar) {
      bars.push([]);
      lastBar = bar;
    }
    const cells = bars[bars.length - 1]!;
    cells.push(n.solfa + n.octaveMark);
    const end = Math.min(n.startBeat + Math.max(0, n.durBeats), (bar + 1) * perBar);
    const held = Math.floor((end - n.startBeat) / beat + 1e-6) - 1;
    for (let k = 0; k < held; k++) cells.push("–");
  }
  return bars.map((cells) => cells.join(" ")).join(" │ ");
}
