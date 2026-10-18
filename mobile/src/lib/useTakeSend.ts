import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { AxiosError } from "axios";
import { transcriptionsApi } from "../api/endpoints";
import type { TranscriptionResult, TranscriptionStatus } from "../api/types";
import type { JobState } from "./useJobPolling";
import { canRetry, isOffline, isStalled, markProgress, normalizeStage, type ProgressMark } from "./jobProgress";
import { jobPollMs } from "./dataPolicy";
import { dataSaverOn } from "./dataSaver";
import { rating } from "./rating";
import {
  onSendProgress,
  onTakeChange,
  releaseTake,
  removeTake,
  resendTake,
  sendTakeNow,
  settleTake,
  takeById,
} from "./outbox";
import type { QueuedSend, SendEvent } from "./sendQueue";

export interface TakeState extends JobState {
  /** The take being followed (an outbox id), or null when none is. */
  takeId: string | null;
  /**
   * The connection dropped (or was gone before the upload began): the take is kept on the phone and goes by
   * itself once the API answers (board 13, "Kept on this phone"). `progress` stays where the upload stopped.
   * Still followed: when the queue sends it, the screen follows the upload again.
   */
  kept: boolean;
  /**
   * Our failure, and the take is being sent again (board 13, "Sending it again"): "lost" when the service lost
   * its job (or never answered), "server" when the upload got a 5xx. Null otherwise.
   */
  resending: "lost" | "server" | null;
}

const IDLE: TakeState = {
  status: "idle",
  progress: 0,
  result: null,
  jobId: null,
  error: null,
  errorCode: null,
  stage: null,
  queuePosition: null,
  source: null,
  stalled: false,
  offline: false,
  canRetry: false,
  savedId: null,
  savedTitle: null,
  takeId: null,
  kept: false,
  resending: null,
};

function normalizeStatus(status: unknown): TranscriptionStatus {
  if (status === 2 || status === "done" || status === "Done") return "done";
  if (status === 3 || status === "failed" || status === "Failed") return "failed";
  if (status === 1 || status === "processing" || status === "Processing") return "processing";
  return "pending";
}

interface Finished {
  jobId: string;
  result: TranscriptionResult;
  savedId: string | null;
  savedTitle: string | null;
}

/**
 * The record screen's view of one take on its way. The outbox sends it (`lib/outbox`); this follows it — the
 * upload's own progress, then the job's stage, place in line and progress, read every 2.5 s (5 s on data
 * saver) — in the same `JobState` the screen has always drawn, with the same clocks behind "the server is
 * busy" and "Try again" (`lib/jobProgress`). Every reading of the job goes back to the outbox, which decides
 * what happens next (`settleTake`); a finished take hands its result over (with the sheet it was filed as)
 * and leaves the queue. A take whose connection dropped, or that is being sent again after our failure, stays
 * followed: the screen shows it kept or re-sending, then follows the upload again.
 */
export function useTakeSend() {
  const [state, setState] = useState<TakeState>(IDLE);
  const watched = useRef<string | null>(null);
  /** Jobs this screen sent the take as before a "Try again": the first of them all to finish is the result. */
  const superseded = useRef<Set<string>>(new Set());
  const result = useRef<Finished | null>(null);
  const startedAt = useRef<number | null>(null);
  const markRef = useRef<ProgressMark | null>(null);
  const failedPolls = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** A 5xx re-send's wait, so it goes at its time even between the queue's ticks. */
  const resendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Bumped by every start and stop, so a tick still in flight when the loop restarts does not start a second one. */
  const loopGen = useRef(0);
  /** Mirrors `state.kept` / `state.resending` for the callbacks, which see the state they were made with. */
  const flags = useRef<{ kept: boolean; resending: TakeState["resending"] }>({ kept: false, resending: null });

  const stopTimer = useCallback(() => {
    loopGen.current += 1;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const clearResendTimer = useCallback(() => {
    if (resendTimer.current) clearTimeout(resendTimer.current);
    resendTimer.current = null;
  }, []);

  /** Lets go of the take (it stays in the queue); the screen shows `next`. */
  const release = useCallback(
    (next: TakeState) => {
      stopTimer();
      clearResendTimer();
      watched.current = null;
      superseded.current.clear();
      flags.current = { kept: next.kept, resending: next.resending };
      setState(next);
    },
    [stopTimer, clearResendTimer],
  );

  const finish = useCallback(
    (id: string, done: Finished) => {
      // The result is in hand: the take is finished with, and the job that is still running (a "Try again"
      // overtaken by the first send) finishes on the server and is pushed as usual.
      removeTake(id);
      release({
        ...IDLE,
        status: "done",
        progress: 1,
        result: done.result,
        jobId: done.jobId,
        savedId: done.savedId,
        savedTitle: done.savedTitle,
        takeId: id,
      });
    },
    [release],
  );

  /** One tick: the job's progress (and the end of it, handed to the outbox), then the clocks. */
  const tick = useCallback(async () => {
    const id = watched.current;
    if (!id) return;
    // In the background the job is the server's to announce: a poll that saw it done would settle it, and a
    // settled job gets no push (as in useJobPolling). The loop keeps running and reads it once the app is back.
    if (AppState.currentState !== "active") return;
    const take = takeById(id);
    const now = Date.now();
    if (take && (take.status === "sent" || take.status === "done") && take.jobId) {
      const jobId = take.jobId;
      try {
        const job = await transcriptionsApi.getJob(jobId);
        if (watched.current !== id) return;
        failedPolls.current = 0;
        const status = normalizeStatus(job.status);
        if (status === "done" && job.result) {
          result.current = { jobId, result: job.result, savedId: job.savedId ?? null, savedTitle: job.savedTitle ?? null };
          if (take.status === "done") finish(id, result.current);
          else settleTake(id, job); // → done → finish
          return;
        }
        if (status === "failed") {
          settleTake(id, job); // → waiting (sent again: lost on our side) or failed
          return;
        }
        // Still on its way; past `NEVER_ANSWERED_MS` the outbox sends it again.
        if (settleTake(id, job)?.status !== "sent") return;
        const stage = normalizeStage(job.stage, status);
        setState((prev) => {
          const progress = Math.max(prev.progress, job.progress ?? 0);
          markRef.current = markProgress(markRef.current, stage, progress, now);
          return {
            ...prev,
            status,
            progress,
            stage,
            queuePosition: stage === "queued" ? job.queuePosition ?? null : null,
            source: job.source ?? prev.source,
            offline: false,
          };
        });
      } catch (e) {
        if (watched.current !== id) return;
        // A job the API does not know is lost: the outbox sends it again.
        if ((e as AxiosError)?.response?.status === 404) {
          settleTake(id, { status: "failed", error: null, errorCode: "JOB_LOST" });
          return;
        }
        failedPolls.current += 1;
      }
    }
    // A "Try again" past a long wait: the job left behind still counts if it finishes first.
    for (const old of [...superseded.current]) {
      try {
        const job = await transcriptionsApi.getJob(old);
        if (watched.current !== id) return;
        const status = normalizeStatus(job.status);
        if (status === "done" && job.result) {
          finish(id, { jobId: old, result: job.result, savedId: job.savedId ?? null, savedTitle: job.savedTitle ?? null });
          return;
        }
        if (status === "failed") superseded.current.delete(old);
      } catch {
        // Asked again next tick.
      }
    }
    if (watched.current !== id) return;
    setState((prev) => ({
      ...prev,
      stalled: isStalled(markRef.current, now),
      offline: isOffline(failedPolls.current),
      canRetry: canRetry(startedAt.current, now),
    }));
  }, [finish]);

  const startTimer = useCallback(() => {
    stopTimer();
    const gen = loopGen.current;
    const loop = () => {
      timer.current = setTimeout(async () => {
        await tick();
        if (watched.current && loopGen.current === gen) loop();
      }, jobPollMs(dataSaverOn()));
    };
    loop();
  }, [stopTimer, tick]);

  /** Kept on the phone: nothing to poll until the queue sends it. */
  const keepOnPhone = useCallback(
    (id: string) => {
      stopTimer();
      flags.current.kept = true;
      setState((prev) => ({ ...prev, takeId: id, kept: true, stalled: false, offline: false, canRetry: false }));
    },
    [stopTimer],
  );

  const apply = useCallback(
    (before: QueuedSend, after: QueuedSend, ev: SendEvent) => {
      const now = Date.now();
      switch (after.status) {
        case "sending":
          // Sent at last (the connection came back, or it is being sent again): follow the upload.
          markRef.current = markProgress(null, "uploading", 0, now);
          flags.current.kept = false;
          if (!timer.current) startTimer();
          setState((prev) => ({ ...prev, kept: false, status: "pending", stage: "uploading", progress: 0, error: null, errorCode: null }));
          return;
        case "sent":
          markRef.current = markProgress(null, "queued", 0, now);
          failedPolls.current = 0;
          setState((prev) => ({ ...prev, status: "pending", stage: "queued", progress: 0, queuePosition: null, offline: false }));
          return;
        case "waiting":
          if (ev.type === "network_error") {
            keepOnPhone(after.id);
          } else if (ev.type === "server_error" || (ev.type === "job_failed" && before.status === "sent")) {
            // Our failure, sent again by itself: a lost job at once (the queue pumps it), a 5xx after its wait.
            const why = ev.type === "server_error" ? "server" : "lost";
            flags.current.resending = why;
            markRef.current = markProgress(null, "uploading", 0, now);
            setState((prev) => ({ ...prev, resending: why, kept: false, status: "pending", stage: "uploading", progress: 0, queuePosition: null }));
            clearResendTimer();
            if (ev.type === "server_error") {
              resendTimer.current = setTimeout(() => {
                if (watched.current === after.id) void sendTakeNow(after.id);
              }, Math.max(0, after.nextAttemptAt - now));
            }
          }
          return;
        case "refused":
        case "failed":
          // Shown with its reason; no longer followed (a Try again in the Library is the queue's), but
          // remembered in `takeId` for the screen's own Retry.
          stopTimer();
          clearResendTimer();
          watched.current = null;
          flags.current = { kept: false, resending: null };
          if (after.status === "failed") void rating.recordFailure();
          setState({
            ...IDLE,
            status: "failed",
            takeId: after.id,
            error: after.message ?? "Transcription failed — please try again.",
            errorCode: after.status === "refused" ? after.code : null,
          });
          return;
        case "done":
          // Found done by this screen's poll (the result in hand), or by the outbox's own: the next tick reads it.
          if (result.current?.jobId === after.jobId) finish(after.id, result.current);
          return;
      }
    },
    [finish, stopTimer, startTimer, keepOnPhone, clearResendTimer],
  );

  // The outbox's word on the take, and its upload's progress.
  useEffect(() => {
    const offChange = onTakeChange((before, after, ev) => {
      if (after.id === watched.current) apply(before, after, ev);
    });
    const offProgress = onSendProgress((id, fraction) => {
      if (id !== watched.current) return;
      setState((prev) => {
        if (prev.stage !== "uploading") return prev;
        const progress = Math.max(prev.progress, fraction);
        // Bytes leaving the phone are movement; the stall clock measures from the last of them.
        markRef.current = markProgress(markRef.current, "uploading", progress, Date.now());
        return { ...prev, progress };
      });
    });
    return () => {
      offChange();
      offProgress();
    };
  }, [apply]);

  /**
   * Sends a take that is already in the outbox (written ahead, ready to send) and follows it. Resolves with
   * the take once its upload has an answer: `sent` (with its job id), refused, or back in the queue.
   */
  const send = useCallback(
    async (id: string, fresh = true): Promise<QueuedSend | null> => {
      if (fresh) superseded.current.clear();
      clearResendTimer();
      watched.current = id;
      result.current = null;
      failedPolls.current = 0;
      flags.current = { kept: false, resending: null };
      const now = Date.now();
      startedAt.current = now;
      markRef.current = markProgress(null, "uploading", 0, now);
      setState({ ...IDLE, status: "pending", stage: "uploading", takeId: id });
      startTimer();
      const take = await sendTakeNow(id);
      // Never tried: the API was known to be out of reach. Kept on the phone until it answers.
      if (watched.current === id && take?.status === "waiting" && !flags.current.kept && !flags.current.resending) {
        keepOnPhone(id);
      }
      return take;
    },
    [startTimer, keepOnPhone, clearResendTimer],
  );

  /** Follows a take already in the queue that could not be sent (the old direct send's fallback): kept on the phone. */
  const keep = useCallback(
    (id: string) => {
      watched.current = id;
      superseded.current.clear();
      result.current = null;
      setState({ ...IDLE, status: "pending", stage: "uploading", takeId: id });
      keepOnPhone(id);
    },
    [keepOnPhone],
  );

  /**
   * "Try again": a failed or refused take is sent again; one still running past the long wait is sent as a
   * fresh job, and whichever of the two finishes first is the result. One that moved on without this screen
   * (tried again from the Library) is followed from where it is.
   */
  const retry = useCallback(async (): Promise<QueuedSend | null> => {
    const id = watched.current ?? state.takeId;
    const take = id ? takeById(id) : null;
    if (!id || !take) {
      release(IDLE);
      return null;
    }
    if (take.status === "failed" || take.status === "refused") {
      if (!releaseTake(id)) return null;
    } else if (take.status === "sent" && watched.current === id) {
      if (take.jobId) superseded.current.add(take.jobId);
      if (!resendTake(id)) return null;
    }
    return send(id, false);
  }, [state.takeId, send, release]);

  /** Stops following; the take itself stays in the queue (and the Library) until it is done or deleted. */
  const reset = useCallback(() => release(IDLE), [release]);

  useEffect(
    () => () => {
      // Unmounted mid-take: the outbox carries on with it, and the server finishes and pushes as usual.
      watched.current = null;
      stopTimer();
      clearResendTimer();
    },
    [stopTimer, clearResendTimer],
  );

  return { state, send, keep, retry, reset };
}
