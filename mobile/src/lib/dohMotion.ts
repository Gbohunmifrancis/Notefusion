/**
 * How Doh moves outside Practice (board c-practice/8c): five short moves and a calm idle. The timings, and when the
 * idle moves fall, are here (pure; tests: dohMotion.test.ts); `components/doh/Doh` plays them with Reanimated.
 *
 *  - hop in   480 ms, when a card, toast or empty state first shows Doh;
 *  - blink    140 ms, every 4–7 s at random while Doh is on screen;
 *  - tilt     240 ms in, a hold with one blink, 240 ms out (1140 ms in all), at most once every 10 s;
 *  - cheer    520 ms, a sheet just arrived;
 *  - tap      300 ms, squish and bounce, then a tip's bubble opens over 200 ms.
 *
 * Idle moves stop 30 s after Doh appears and never run while the screen is away, recording or playing. With Reduce
 * Motion Doh only fades in (150 ms) and keeps still.
 */

export const DOH_MS = {
  hop: 480,
  blink: 140,
  tiltIn: 240,
  /** The tilt's hold, between leaning in and coming back. */
  tiltHold: 660,
  tiltOut: 240,
  /** The tilt's one blink, from the start of the tilt. */
  tiltBlinkAt: 700,
  cheer: 520,
  tap: 300,
  /** Reduce Motion: a fade, nothing else. */
  fade: 150,
  /** A tip's bubble opening. */
  bubble: 200,
  /** A tip's bubble closes by itself after this. */
  bubbleFor: 6000,
} as const;

export const TILT_MS = DOH_MS.tiltIn + DOH_MS.tiltHold + DOH_MS.tiltOut;
/** Idle moves stop this long after Doh appears. */
export const IDLE_FOR_MS = 30_000;
export const BLINK_GAP_MS: readonly [number, number] = [4000, 7000];
export const TILT_GAP_MS = 10_000;
/** The first tilt waits for Doh to settle and blink once. */
const FIRST_TILT_MS: readonly [number, number] = [7000, 10_000];

export type IdleMove = { at: number; move: "blink" | "tilt" };

const between = (random: () => number, [lo, hi]: readonly [number, number]) => lo + random() * (hi - lo);

/**
 * The idle moves for one 30 s stay on screen, in order. Blinks every 4–7 s; tilts (when the pose has words beside
 * it to lean toward) at least 10 s apart, each with its own blink, so no other blink falls inside one.
 */
export function idleSchedule(random: () => number, tilt = true): IdleMove[] {
  const tilts: number[] = [];
  if (tilt) {
    for (let at = between(random, FIRST_TILT_MS); at + TILT_MS <= IDLE_FOR_MS; at += TILT_GAP_MS + between(random, [0, 4000])) {
      tilts.push(Math.round(at));
    }
  }
  const inTilt = (t: number) => tilts.some((a) => t + DOH_MS.blink >= a && t <= a + TILT_MS);
  const moves: IdleMove[] = tilts.map((at) => ({ at, move: "tilt" as const }));
  for (let at = between(random, BLINK_GAP_MS); at + DOH_MS.blink <= IDLE_FOR_MS; at += between(random, BLINK_GAP_MS)) {
    if (!inTilt(at)) moves.push({ at: Math.round(at), move: "blink" });
  }
  return moves.sort((a, b) => a.at - b.at);
}
