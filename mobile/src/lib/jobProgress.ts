/**
 * The words and the clock behind a running job's progress card — shared by the record
 * screen (uploads) and the link screen (songs), and kept pure so the rules are testable.
 *
 * The worker names its stage (`queued`, `fetching`, `separating`, `transcribing`); the
 * client adds one of its own, `uploading`, for the time the file is still leaving the phone.
 * Nothing here is ever the server's text: every line is written for the person waiting.
 */

import type { TranscriptionStage, TranscriptionStatus } from "../api/types";

/** A worker stage, or the client's own `uploading` before the server has answered. */
export type ClientStage = TranscriptionStage | "uploading";

const WORKER_STAGES: readonly TranscriptionStage[] = ["queued", "fetching", "separating", "transcribing"];

/** No change in stage or progress for this long reads as the server being busy. */
export const STALLED_AFTER_MS = 90_000;
/** No finish after this long offers a fresh submit. */
export const RETRY_AFTER_MS = 12 * 60_000;
/** Polls that must fail in a row before the screen admits it cannot reach the API. */
export const OFFLINE_AFTER_FAILED_POLLS = 3;

export const STALLED_LINE = "Taking longer than usual — the server is busy, your place is kept.";
export const OFFLINE_LINE = "Can't reach NoteFusion right now. Still trying…";

/**
 * The worker's stage as the screen should treat it. Unknown words are a stage this build
 * has not heard of, so the safe reading is the longest one; nothing at all is still
 * `queued` while the job is pending and `transcribing` once it is processing.
 */
export function normalizeStage(stage: unknown, status: TranscriptionStatus | "idle"): TranscriptionStage | null {
  if (typeof stage === "string" && stage.length > 0) {
    return (WORKER_STAGES as readonly string[]).includes(stage) ? (stage as TranscriptionStage) : "transcribing";
  }
  if (status === "pending") return "queued";
  if (status === "processing") return "transcribing";
  return null;
}

/** What the stage is called on screen; the queue adds how many jobs are ahead. */
export function stageLabel(stage: ClientStage | null, queuePosition?: number | null): string {
  switch (stage) {
    case "uploading":
      return "Uploading your recording";
    case "queued":
      return typeof queuePosition === "number" && queuePosition > 0
        ? `Waiting in line · ${queuePosition} ahead`
        : "Waiting in line";
    case "fetching":
      return "Fetching audio";
    case "separating":
      return "Isolating the voice";
    case "transcribing":
      return "Writing the solfa";
    default:
      return "Working on it";
  }
}

/** "42%" — whole numbers, clamped, never NaN. */
export function percentLabel(progress: number): string {
  const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  return `${Math.round(p * 100)}%`;
}

/** The last moment the job visibly moved, and what it looked like then. */
export interface ProgressMark {
  stage: ClientStage | null;
  progress: number;
  changedAt: number;
}

/**
 * Carries the mark forward: a new stage or a new progress figure restarts the clock, the
 * same reading keeps the old timestamp so the stall can be measured from it.
 */
export function markProgress(prev: ProgressMark | null, stage: ClientStage | null, progress: number, now: number): ProgressMark {
  if (prev && prev.stage === stage && prev.progress === progress) return prev;
  return { stage, progress, changedAt: now };
}

export function isStalled(mark: ProgressMark | null, now: number): boolean {
  return mark !== null && now - mark.changedAt >= STALLED_AFTER_MS;
}

export function canRetry(startedAt: number | null, now: number): boolean {
  return startedAt !== null && now - startedAt >= RETRY_AFTER_MS;
}

/**
 * The next moment the card's clocks change on their own — the stall line appearing, or "Try again" being
 * offered — so the screen can wake once then instead of re-reading the clock on a timer. Null when neither
 * is still to come.
 */
export function nextClockAt(mark: ProgressMark | null, startedAt: number | null, now: number): number | null {
  const due: number[] = [];
  if (mark !== null && !isStalled(mark, now)) due.push(mark.changedAt + STALLED_AFTER_MS);
  if (startedAt !== null && !canRetry(startedAt, now)) due.push(startedAt + RETRY_AFTER_MS);
  return due.length > 0 ? Math.min(...due) : null;
}

export function isOffline(failedPollsInARow: number): boolean {
  return failedPollsInARow >= OFFLINE_AFTER_FAILED_POLLS;
}
