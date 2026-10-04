/**
 * The section of a linked song to transcribe: the arithmetic behind `RangePicker` and the
 * "1:05–1:35 of 3:33" credit line, kept free of React so it can be unit-tested on Node.
 *
 * A range is two whole-second marks on the song. Moving a thumb snaps it to the second,
 * keeps the window at least `MIN_WINDOW` wide (so the song can still be read) and at most
 * `maxSeconds` (the caller's allowance): when a thumb is dragged past that, the other
 * follows. Moving the window keeps its length and slides it within the song.
 *
 * No imports: the tests run on Node's own type stripping.
 */

export interface ClipRange {
  start: number;
  end: number;
}

/** The shortest section worth transcribing, in seconds. */
export const MIN_WINDOW = 5;

/**
 * m:ss, or h:mm:ss from an hour up; never negative. Whole seconds are floored, as a player's
 * clock does and as the web's `fmtClock` does, so a 213.6 s song reads 3:33 both as its total
 * length and at the end thumb, which stops on whole seconds.
 */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** The smallest window a song this long allows: five seconds, or the whole of a shorter clip. */
function minWindow(duration: number): number {
  return Math.min(MIN_WINDOW, Math.max(1, Math.floor(duration)));
}

/** The longest window: the allowance, or the whole song when it is shorter. */
function maxWindow(duration: number, maxSeconds: number): number {
  return Math.max(minWindow(duration), Math.min(Math.floor(duration), Math.floor(maxSeconds)));
}

/** The first `maxSeconds` of the song — the whole song when it fits. */
export function defaultRange(duration: number, maxSeconds: number): ClipRange {
  return { start: 0, end: maxWindow(duration, maxSeconds) };
}

/** True when the whole song fits inside the allowance. */
export function fitsWhole(duration: number, maxSeconds: number): boolean {
  return Math.floor(duration) <= Math.floor(maxSeconds);
}

/** True when the range covers the song from start to end. */
export function isWholeSong(range: ClipRange, duration: number): boolean {
  return range.start <= 0 && range.end >= Math.floor(duration);
}

/** The start thumb moved to `start`; the end follows when the window would get too short or too long. */
export function moveStart(range: ClipRange, start: number, duration: number, maxSeconds: number): ClipRange {
  const lo = minWindow(duration);
  const hi = maxWindow(duration, maxSeconds);
  const songEnd = Math.floor(duration);
  const s = clamp(Math.round(start), 0, songEnd - lo);
  let e = range.end;
  if (e - s < lo) e = s + lo;
  if (e - s > hi) e = s + hi;
  return { start: s, end: clamp(e, lo, songEnd) };
}

/** The end thumb moved to `end`; the start follows when the window would get too short or too long. */
export function moveEnd(range: ClipRange, end: number, duration: number, maxSeconds: number): ClipRange {
  const lo = minWindow(duration);
  const hi = maxWindow(duration, maxSeconds);
  const songEnd = Math.floor(duration);
  const e = clamp(Math.round(end), lo, songEnd);
  let s = range.start;
  if (e - s < lo) s = e - lo;
  if (e - s > hi) s = e - hi;
  return { start: clamp(s, 0, songEnd - lo), end: e };
}

/** The whole window slid so it starts at `start`, its length kept, held inside the song. */
export function moveWindow(range: ClipRange, start: number, duration: number): ClipRange {
  const length = range.end - range.start;
  const s = clamp(Math.round(start), 0, Math.max(0, Math.floor(duration) - length));
  return { start: s, end: s + length };
}

/** "1:05–1:35 of 3:33"; "1:05–1:35" when the song's length is not known. */
export function sectionLabel(start: number, end: number, duration?: number | null): string {
  const span = `${formatClock(start)}–${formatClock(end)}`;
  return duration != null && duration > 0 ? `${span} of ${formatClock(duration)}` : span;
}

/** "Selected 0:30 of 3:33" — the window's length against the song's. */
export function selectedLabel(range: ClipRange, duration: number): string {
  return `Selected ${formatClock(range.end - range.start)} of ${formatClock(duration)}`;
}

/**
 * The credit line's section, from the worker's record of what was fetched: null when no
 * section was chosen, or when the one chosen was the whole song.
 */
export function sectionOf(source: {
  startSeconds?: number | null;
  endSeconds?: number | null;
  durationSeconds?: number | null;
}): string | null {
  const start = source.startSeconds ?? 0;
  const end = source.endSeconds;
  const duration = source.durationSeconds ?? null;
  if (end == null || end <= start) return null;
  if (start <= 0 && duration != null && end >= Math.floor(duration)) return null;
  return sectionLabel(start, end, duration);
}
