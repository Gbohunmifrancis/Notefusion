/**
 * The Sessions page's small rules (board k-sessions), apart from the views so they read on their own: the recording's
 * clock, which video piece covers a moment, and where the player is in what happened.
 */
import type { SessionStep, SessionVideo } from "@/api/types";

/** `221000` → `"3:41"`; an hour or more → `"1:02:05"`. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** How long the recording runs: its own duration, or its last piece's end when a live session has outrun it. */
export function recordingLength(durationSeconds: number, videos: readonly SessionVideo[]): number {
  const lastEnd = videos.reduce((end, v) => Math.max(end, v.startMs + v.durationMs), 0);
  return Math.max(durationSeconds * 1000, lastEnd);
}

/**
 * The piece to play for a moment: the one covering it, else the next one after it (a gap is skipped), else none.
 * `videos` are in time order.
 */
export function pieceAt(videos: readonly SessionVideo[], atMs: number): number {
  const covering = videos.findIndex((v) => atMs >= v.startMs && atMs < v.startMs + v.durationMs);
  if (covering >= 0) return covering;
  return videos.findIndex((v) => v.startMs > atMs);
}

/** The step the player has reached: the last one at or before the moment, or -1 before the first. */
export function stepAt(steps: readonly SessionStep[], atMs: number): number {
  let reached = -1;
  for (let i = 0; i < steps.length; i++) {
    if (steps[i]!.atMs <= atMs) reached = i;
    else break;
  }
  return reached;
}

/** "Home → Record → Result", at most four screens, the rest counted. */
export function screensLine(screens: readonly string[]): string {
  if (screens.length === 0) return "—";
  const shown = screens.slice(0, 4).join(" → ");
  return screens.length > 4 ? `${shown} +${screens.length - 4}` : shown;
}
