import { useEffect } from "react";
import type { AxiosError } from "axios";
import { libraryApi, previewApi } from "../api/endpoints";
import type { TranscriptionResult } from "../api/types";
import { previewTitle } from "./guestPreview";
import { guestPreviewStore } from "./guestPreviewStore";
import { watchJob } from "./jobStream";
import { navigationRef } from "./notificationLink";
import { recordedAt } from "./sendQueue";
import { isTerminalStatus } from "./streamPolicy";
import { showToast } from "./toast";

/**
 * A guest's preview kept by the account made or signed in to (board l-ux-high/07, frame 4), as the web app keeps
 * one after a guest signs up (`keepClaimedPreview`, web-site/assets/app.js): the preview is claimed for the account
 * (`POST /api/preview/jobs/{id}/claim`, the funnel's conversion), its sheet is saved to the Library, and the Library
 * opens with the usual toast. Runs whenever a session starts with a preview waiting on the phone. One that cannot be
 * saved now (no connection) waits on the phone for the next start; one the API no longer has, or that failed, is let go.
 */
export function usePreviewClaim(signedIn: boolean): void {
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    void keepPreview(() => live);
    return () => {
      live = false;
    };
  }, [signedIn]);
}

/** One keep at a time: a sign-in that flips twice must not save the sheet twice. */
let keeping = false;

async function keepPreview(live: () => boolean): Promise<void> {
  if (keeping) return;
  keeping = true;
  try {
    const pending = await guestPreviewStore.read();
    if (!pending || !live()) return;
    // Best effort, as the website's: the conversion is counted, and nothing waits on it.
    previewApi.claim(pending.jobId).catch(() => undefined);
    // Closed before it finished: its sheet is read once the job is over.
    const result = pending.result ?? (await finishedSheet(pending.jobId));
    if (!live()) return;
    if (result === null) {
      await guestPreviewStore.clear();
      return;
    }
    await libraryApi.save({
      title: previewTitle(result.hymnMatch?.title, recordedAt(pending.recordedAt)),
      key: result.key,
      tempoBpm: Math.round(result.tempo),
      timeSignature: result.timeSignature,
      musicXml: result.musicXml,
      notes: result.notes,
      overallConfidence: result.overallConfidence,
      // Ties the sheet to its preview, as the website's save does.
      sourceJobId: pending.jobId,
      lyrics: (result.lyrics ?? "").trim(),
      chords: result.chords ?? null,
    });
    await guestPreviewStore.clear();
    if (navigationRef.isReady()) navigationRef.navigate("Tabs", { screen: "Library" });
    showToast("Saved to your Library");
  } catch {
    // Kept on the phone and saved at the next start: a failed save loses nothing.
  } finally {
    keeping = false;
  }
}

/**
 * The preview's sheet once its job is over, followed on the preview's own routes: null when it failed or the API no
 * longer has it. Waits out a lost connection while the app is in front, as any followed job does.
 */
function finishedSheet(jobId: string): Promise<TranscriptionResult | null> {
  return new Promise((resolve) => {
    let settled = false;
    let stop: (() => void) | null = null;
    const settle = (sheet: TranscriptionResult | null) => {
      if (settled) return;
      settled = true;
      stop?.();
      resolve(sheet);
    };
    stop = watchJob(
      jobId,
      {
        onJob: (job) => {
          if (isTerminalStatus(job.status)) settle(job.result ?? null);
        },
        onReadFailed: (e) => {
          if ((e as AxiosError)?.response?.status === 404) settle(null);
        },
      },
      { preview: true },
    );
    if (settled) stop();
  });
}
