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
