/**
 * The guest preview (board l-ux-high/07): a phone with no account hums up to thirty seconds, sees the sheet, and keeps
 * it by making an account. The API's anonymous preview is the website's try-it box (`web-site/assets/preview.js`), one
 * per phone ever (`X-Device-Id`), so these rules mirror that box and the API's `PreviewLimits`. Pure
 * (`guestPreview.test.ts`); the phone's copy of a preview is `guestPreviewStore`.
 */
import type { TranscriptionResult } from "../api/types";

/** The API transcribes a preview's first thirty seconds (`PreviewLimits.Seconds`), so a guest's take stops there. */
export const GUEST_MAX_SECONDS = 30;

/** How long before the stop the line under the clock counts down. */
export const GUEST_WARN_SECONDS = 10;

/** The largest file the preview takes (`PreviewController.MaxAudioBytes`). */
export const PREVIEW_MAX_BYTES = 25 * 1024 * 1024;

/** What the guest's sheet is called until an account keeps it. */
export const GUEST_PREVIEW_TITLE = "Your preview";

/** The API's refusal once this phone has had its preview, or an account has transcribed on it. */
export const PREVIEW_LIMIT_CODE = "PREVIEW_LIMIT_REACHED";

/** Whether a guest's take has run `elapsed` seconds to the cap and stops by itself. */
export function guestTakeFull(elapsed: number): boolean {
  return elapsed >= GUEST_MAX_SECONDS;
}

/** The line under the clock while a guest records: the countdown near the end, the plain hint before it. */
export function guestRecordingLine(elapsed: number): string {
  const left = Math.max(0, GUEST_MAX_SECONDS - elapsed);
  return left <= GUEST_WARN_SECONDS
    ? `Stopping in ${left}s · the free preview is ${GUEST_MAX_SECONDS} seconds`
    : "Recording · keep going to the end of the phrase";
}

/**
 * What a refused send means for the take, read as the website reads it:
 * - `used`: this phone has had its one preview (`PREVIEW_LIMIT_REACHED`), which sending again cannot change;
 * - `kept`: no answer, a timeout, too many at once or a fault on our side — the take stays, with Send it again;
 * - `said`: anything else, in the API's own words.
 */
export type PreviewRefusal = "used" | "kept" | "said";

export function previewRefusal(status: number | null | undefined, code: string | null | undefined): PreviewRefusal {
  if (code === PREVIEW_LIMIT_CODE) return "used";
  if (!status || status === 408 || status === 429 || status >= 500) return "kept";
  return "said";
}

/**
 * A preview this phone made and has not yet kept: the job, and the sheet once the guest has seen it. Kept until
 * an account is made or signed in to, which claims it and saves it to that account's Library.
 */
export interface PendingPreview {
  jobId: string;
  /** When the take was sent (ms): the kept sheet is named from it. */
  recordedAt: number;
  /** The take's file: "clip-12s.m4a" from the microphone, else the file that was picked. */
  fileName: string;
  /** The finished sheet; null while the job is still running. */
  result: TranscriptionResult | null;
}

/** The stored preview, or null when there is none or it cannot be read. */
export function readPendingPreview(raw: string | null | undefined): PendingPreview | null {
  if (!raw) return null;
  let p: unknown;
  try {
    p = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof p !== "object" || p === null) return null;
  const { jobId, recordedAt, fileName, result } = p as Record<string, unknown>;
  if (typeof jobId !== "string" || jobId.trim() === "") return null;
  if (typeof recordedAt !== "number" || !Number.isFinite(recordedAt)) return null;
  const sheet =
    typeof result === "object" && result !== null && Array.isArray((result as TranscriptionResult).notes)
      ? (result as TranscriptionResult)
      : null;
  return { jobId, recordedAt, fileName: typeof fileName === "string" ? fileName : "", result: sheet };
}

/**
 * What the kept sheet is called, as the Library names a take: "Recording · Sun 17:10" for one from the microphone
 * (`when` is that time, `sendQueue.recordedAt`), else the picked file's name without its ending.
 */
export function previewTitle(fileName: string, when: string): string {
  const dot = fileName.lastIndexOf(".");
  const base = (dot > 0 ? fileName.slice(0, dot) : fileName).trim();
  // The API keeps a title to 120 characters.
  return base === "" || fileName.startsWith("clip-") ? `Recording · ${when}` : base.slice(0, 120);
}
