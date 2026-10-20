import { useCallback, useEffect, useRef, useState } from "react";
import type { AxiosError } from "axios";
import { previewApi, transcriptionsApi, type SubmitOptions } from "../api/endpoints";
import { safeReason, toApiError } from "../api/client";
import { previewRefusal, type PreviewRefusal } from "./guestPreview";
import {
  canRetry,
  isOffline,
  isStalled,
  markProgress,
  nextClockAt,
  normalizeStage,
  type ClientStage,
  type ProgressMark,
} from "./jobProgress";
import type {
  TranscriptionJob,
  TranscriptionResult,
  TranscriptionSource,
  TranscriptionStatus,
} from "../api/types";
import { rating } from "./rating";
import { watchJob } from "./jobStream";

export interface JobState {
  status: TranscriptionStatus | "idle";
  progress: number;
  result: TranscriptionResult | null;
  /**
   * The finished job's id. Saving passes it on as `sourceJobId`, which is what ties the sheet to its
   * job on the server (the activity log's "saved", the completion sweep). Null until a job ends.
   */
  jobId: string | null;
  error: string | null;
  errorCode: string | null;
  /** Which step the job is on — the client's own `uploading` first; null once finished. */
  stage: ClientStage | null;
  /** How many jobs are ahead while this one waits; null otherwise. */
  queuePosition: number | null;
  /** The song behind a link, as soon as the worker has read it. */
  source: TranscriptionSource | null;
  /** Nothing has moved for a while: the server is busy, the place is kept. */
  stalled: boolean;
  /** Several polls in a row have failed; the job itself is not known to have. */
  offline: boolean;
  /** Long enough without a finish that submitting again is offered. */
  canRetry: boolean;
  /**
   * The library sheet the finished job was filed as (every finished transcription is, at once), and its title;
   * the Result screen then treats the sheet as saved. Null until a job ends, and from a server that does not file.
   */
  savedId: string | null;
  savedTitle: string | null;
}

const IDLE: JobState = {
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
};

const TERMINAL: TranscriptionStatus[] = ["done", "failed"];

function normalizeStatus(status: unknown): TranscriptionStatus {
  if (status === 2 || status === "done" || status === "Done") return "done";
  if (status === 3 || status === "failed" || status === "Failed")
    return "failed";
  if (status === 1 || status === "processing" || status === "Processing")
    return "processing";
  return "pending";
}

type LastSubmit =
  | { kind: "upload"; fileUri: string; fileName: string; opts: SubmitOptions }
  | { kind: "link"; url: string; opts: Parameters<typeof transcriptionsApi.submitLink>[1] };

/** What the guest preview's send came to: the job the API made, or why it would not (`lib/guestPreview`). */
export type PreviewSent = { jobId: string } | { refusal: PreviewRefusal; message: string };

/**
 * Follows the job the record or link screen submitted, as it happens: its live stream (`lib/jobStream`)
 * carries every change of stage, place in line and progress, and its end, and the job is read over HTTP only
 * when the stream says so (listening, ended) or cannot be held. Nothing is read on a timer while it holds.
 */
export function useJobPolling() {
  const [state, setState] = useState<JobState>(IDLE);
  const activeJobId = useRef<string | null>(null);
  /**
   * Jobs this screen submitted and then resubmitted past ("Try again"), each still followed: the server still
   * finishes them, and whichever job finishes first is the result the person is waiting for.
   */
  const superseded = useRef<Map<string, () => void>>(new Map());
  /** Stops following the current job. */
  const stopWatch = useRef<(() => void) | null>(null);
  /** Wakes the card when its clocks next change (the stall line, "Try again"). */
  const clockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** When the current submit began — the twelve-minute clock behind "Try again". */
  const startedAt = useRef<number | null>(null);
  /** The last visible movement — the ninety-second clock behind the "server is busy" line. */
  const markRef = useRef<ProgressMark | null>(null);
  /** Reads and stream connections that failed in a row: three say the API cannot be reached. */
  const failedPolls = useRef(0);
  const lastSubmit = useRef<LastSubmit | null>(null);
  /** False once the screen has gone: a read that answers after that starts nothing. */
  const mounted = useRef(true);

  const stopClocks = useCallback(() => {
    if (clockTimer.current) clearTimeout(clockTimer.current);
    clockTimer.current = null;
  }, []);

  /**
   * The stall line and "Try again" are clocks, not news from the server: the card wakes once, when the next
   * of them is due (`nextClockAt`), instead of re-reading the time on a timer. Rescheduled on every movement.
   */
  const scheduleClocks = useCallback(function schedule() {
    if (clockTimer.current) clearTimeout(clockTimer.current);
    clockTimer.current = null;
    const at = nextClockAt(markRef.current, startedAt.current, Date.now());
    if (at === null) return;
    clockTimer.current = setTimeout(() => {
      clockTimer.current = null;
      const now = Date.now();
      setState((prev) =>
        prev.status === "pending" || prev.status === "processing"
          ? { ...prev, stalled: isStalled(markRef.current, now), canRetry: canRetry(startedAt.current, now) }
          : prev,
      );
      schedule();
    }, Math.max(0, at - Date.now()) + 50);
  }, []);

  /** Stops following the current job, and its clocks. Jobs left behind by "Try again" are still followed. */
  const stopFollowing = useCallback(() => {
    stopWatch.current?.();
    stopWatch.current = null;
    stopClocks();
  }, [stopClocks]);

  const stopSuperseded = useCallback(() => {
    for (const stop of superseded.current.values()) stop();
    superseded.current.clear();
  }, []);

  const finish = useCallback((job: any, fallback: string) => {
    const status = normalizeStatus(job.status);
    // Nothing left to follow or to measure; a job left behind by "Try again" finishes on the server and is pushed.
    stopFollowing();
    stopSuperseded();
    // Keeps the store-rating ask away from someone whose last job just failed.
    if (status === "failed") void rating.recordFailure();
    setState({
      ...IDLE,
      status,
      progress: status === "done" ? 1 : 0,
      result: job.result ?? null,
      jobId: typeof job.jobId === "string" ? job.jobId : null,
      error: status === "failed" ? safeReason(job.error, fallback) : null,
      source: job.source ?? job.result?.source ?? null,
      savedId: typeof job.savedId === "string" ? job.savedId : null,
      savedTitle: typeof job.savedTitle === "string" ? job.savedTitle : null,
    });
  }, [stopFollowing, stopSuperseded]);

  /** A read or a stream that got no answer: after three in a row the screen says the API cannot be reached. */
  const missed = useCallback((jobId: string) => {
    if (activeJobId.current !== jobId) return;
    failedPolls.current += 1;
    const now = Date.now();
    setState((prev) => ({
      ...prev,
      stalled: isStalled(markRef.current, now),
      offline: isOffline(failedPolls.current),
      canRetry: canRetry(startedAt.current, now),
    }));
  }, []);

  /**
   * The job's stage and progress while it runs, and its end. A linked song spends minutes fetching and
   * isolating vocals before it ends — time the screen accounts for with a stage and a bar, not a spinner.
   * Stops itself on a terminal reading, on reset, and whenever the job it was following is replaced.
   *
   * A dropped stream or read is not a failed job: it is counted, and after three in a row the screen says
   * the API cannot be reached; the next good word clears that. Nothing the server says about a failure to
   * read the job is ever shown.
   *
   * Only while the app is in front (`jobStream`): a stream that heard the job end means the server sends no
   * push ("they are looking at the result"), so in the background nothing listens and the push comes.
   */
  const follow = useCallback((jobId: string, preview: boolean) => {
    stopFollowing();
    stopWatch.current = watchJob(jobId, {
      onJob: (job: TranscriptionJob) => {
        if (activeJobId.current !== jobId) return;
        failedPolls.current = 0;
        const status = normalizeStatus(job.status);
        if (TERMINAL.includes(status)) {
          activeJobId.current = null;
          finish(job, "Transcription failed — please try again.");
          return;
        }
        const now = Date.now();
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
            stalled: isStalled(markRef.current, now),
            offline: false,
            canRetry: canRetry(startedAt.current, now),
          };
        });
        scheduleClocks();
      },
      onReadFailed: () => missed(jobId),
      onLink: (up) => {
        if (activeJobId.current !== jobId) return;
        if (!up) {
          missed(jobId);
          return;
        }
        failedPolls.current = 0;
        setState((prev) => (prev.offline ? { ...prev, offline: false } : prev));
      },
    }, { preview });
  }, [stopFollowing, finish, missed, scheduleClocks]);

  /**
   * A job left behind by "Try again" is still followed: if it finishes well before the fresh one, that is the
   * result. Its failure says nothing about the fresh job, so it is only let go.
   */
  const followSuperseded = useCallback((jobId: string) => {
    if (superseded.current.has(jobId)) return;
    const stop = watchJob(jobId, {
      onJob: (job: TranscriptionJob) => {
        const status = normalizeStatus(job.status);
        if (!TERMINAL.includes(status)) return;
        superseded.current.get(jobId)?.();
        superseded.current.delete(jobId);
        if (status !== "done" || !job.result || startedAt.current === null) return;
        activeJobId.current = null;
        finish(job, "Transcription failed — please try a cleaner recording, closer to the microphone.");
      },
    });
    superseded.current.set(jobId, stop);
  }, [finish]);

  /** Shared tail of `start`, `startLink` and `startPreview`: bind the job, drain any early finish, start polling. */
  const track = useCallback(
    (res: Awaited<ReturnType<typeof transcriptionsApi.submit>> | string, preview = false) => {
        const jobId =
          typeof res === "string"
            ? res
            : (res?.jobId ??
              ((res as unknown as Record<string, unknown>)?.["value"] as
                string | undefined));

        if (!jobId) {
          throw new Error(
            "Server did not return a job identifier — please try again.",
          );
        }

        activeJobId.current = jobId;
        const inlineStatus =
          typeof res !== "string" ? normalizeStatus(res.status) : "pending";

        if (
          typeof res !== "string" &&
          ((inlineStatus === "done" && res.result) || inlineStatus === "failed")
        ) {
          finish(res, "Transcription failed — please try again.");
          return jobId;
        }
        // The upload is over: from here the bar follows the worker, starting where it says.
        const stage = typeof res !== "string" ? normalizeStage(res.stage, inlineStatus) : "queued";
        const progress = typeof res !== "string" ? res.progress ?? 0 : 0;
        const now = Date.now();
        markRef.current = markProgress(null, stage, progress, now);
        setState((prev) => ({
          ...prev,
          status: inlineStatus,
          progress,
          stage,
          queuePosition:
            typeof res !== "string" && stage === "queued" ? res.queuePosition ?? null : null,
          source: (typeof res !== "string" ? res.source : null) ?? prev.source,
          stalled: false,
          offline: false,
        }));
        scheduleClocks();
        follow(jobId, preview);
        return jobId;
    },
    [follow, finish, scheduleClocks],
  );

  const fail = useCallback((e: unknown) => {
    const err = toApiError(e);
    stopFollowing();
    setState({
      ...IDLE,
      status: "failed",
      error: err.message,
      errorCode: err.code,
    });
    activeJobId.current = null;
    return null;
  }, [stopFollowing]);

  /** Opens a fresh wait: the clocks start, nothing counted against the last job carries over. */
  const begin = useCallback(
    (stage: ClientStage) => {
      stopFollowing();
      const now = Date.now();
      startedAt.current = now;
      markRef.current = markProgress(null, stage, 0, now);
      failedPolls.current = 0;
      setState({ ...IDLE, status: "pending", stage });
      activeJobId.current = null;
      scheduleClocks();
    },
    [stopFollowing, scheduleClocks],
  );

  /**
   * A song behind a link, or the section of it in `opts.startSeconds`/`endSeconds`. Same
   * lifecycle as `start`; the worker reports its stages.
   */
  const startLink = useCallback(
    async (url: string, opts: Parameters<typeof transcriptionsApi.submitLink>[1]) => {
      lastSubmit.current = { kind: "link", url, opts };
      begin("queued");
      const token = startedAt.current;
      try {
        const res = await transcriptionsApi.submitLink(url, opts);
        // Reset, resubmitted or unmounted while the link was being sent: this answer is nobody's.
        if (startedAt.current !== token) return null;
        return track(res);
      } catch (e) {
        if (startedAt.current !== token) return null;
        return fail(e);
      }
    },
    [track, fail, begin],
  );

  /** The upload's own progress for the card, while the upload begun at `token` is the one on screen. */
  const uploadProgress = useCallback(
    (token: number) => (fraction: number) => {
      // Only while this very upload is the one on screen, and only before the server answered.
      if (startedAt.current !== token) return;
      setState((prev) => {
        if (prev.stage !== "uploading") return prev;
        const progress = Math.max(prev.progress, fraction);
        // Bytes leaving the phone are movement; the stall clock measures from the last of them.
        markRef.current = markProgress(markRef.current, "uploading", progress, Date.now());
        return { ...prev, progress };
      });
      scheduleClocks();
    },
    [scheduleClocks],
  );

  const start = useCallback(
    async (
      fileUri: string,
      fileName: string,
      opts: SubmitOptions,
    ) => {
      lastSubmit.current = { kind: "upload", fileUri, fileName, opts };
      begin("uploading");
      const token = startedAt.current as number;
      try {
        const res = await transcriptionsApi.submit(fileUri, fileName, opts, {
          onUploadProgress: uploadProgress(token),
        });
        if (startedAt.current !== token) return null;
        return track(res);
      } catch (e) {
        if (startedAt.current !== token) return null;
        return fail(e);
      }
    },
    [track, fail, begin, uploadProgress],
  );

  /**
   * The guest preview (board l-ux-high/07): the take goes to `POST /api/preview` with no account and its job is
   * followed on the preview's routes, as any job is. A refused send leaves the card idle and says why
   * (`lib/guestPreview`), so the screen can keep the take when sending again could work. Never "Try again" after a
   * long wait: a second preview from this phone would be refused while the first one runs.
   *
   * A job the API made after the screen moved on (left mid-upload) is still handed back, unfollowed: it is this
   * phone's one preview, so the screen keeps its id for the guest to come back to.
   */
  const startPreview = useCallback(
    async (
      fileUri: string,
      fileName: string,
      opts: Parameters<typeof previewApi.submit>[2],
    ): Promise<PreviewSent | null> => {
      lastSubmit.current = null;
      begin("uploading");
      const token = startedAt.current as number;
      try {
        const res = await previewApi.submit(fileUri, fileName, opts, { onUploadProgress: uploadProgress(token) });
        if (startedAt.current !== token) return typeof res?.jobId === "string" ? { jobId: res.jobId } : null;
        return { jobId: track(res, true) };
      } catch (e) {
        if (startedAt.current !== token) return null;
        stopFollowing();
        activeJobId.current = null;
        startedAt.current = null;
        markRef.current = null;
        setState(IDLE);
        const err = toApiError(e);
        return { refusal: previewRefusal((e as AxiosError)?.response?.status, err.code), message: err.message };
      }
    },
    [track, begin, stopFollowing, uploadProgress],
  );

  /** A preview sent before (the guest left while it ran): followed again from where it stands. */
  const resumePreview = useCallback(
    (jobId: string) => {
      lastSubmit.current = null;
      begin("queued");
      track(jobId, true);
    },
    [begin, track],
  );

  /**
   * A song link sent before the screen was left (`lib/linkJob`): followed again from where it stands while it still
   * runs, as if the screen had never gone, and "Try again" sends the same link. A job that has already ended is not
   * taken up: its sheet is in the Library and its push has gone, so the screen opens as usual.
   * "unknown" when the job could not be read (offline), so the caller keeps it for next time.
   */
  const resumeLink = useCallback(
    async (
      jobId: string,
      url: string,
      opts: Parameters<typeof transcriptionsApi.submitLink>[1],
    ): Promise<"running" | "ended" | "unknown"> => {
      const before = startedAt.current;
      let job: TranscriptionJob;
      try {
        job = await transcriptionsApi.getJob(jobId);
      } catch (e) {
        return toApiError(e).code.startsWith("NETWORK_") ? "unknown" : "ended";
      }
      // The screen went, or something was sent from it meanwhile (that is the job on screen now).
      if (!mounted.current || startedAt.current !== before) return "unknown";
      const status = normalizeStatus(job.status);
      if (status === "done" || status === "failed") return "ended";
      lastSubmit.current = { kind: "link", url, opts };
      begin("queued");
      track({ ...job, jobId: job.jobId ?? jobId });
      return "running";
    },
    [begin, track],
  );

  /**
   * "Try again" after a long wait: the same recording or link is submitted afresh. The job
   * being left behind keeps running on the server and is still followed, and its finish — or
   * the completion push — still counts, so nothing the person already paid for is thrown away.
   */
  const retry = useCallback(async () => {
    const last = lastSubmit.current;
    if (!last) return null;
    if (activeJobId.current) followSuperseded(activeJobId.current);
    return last.kind === "upload"
      ? start(last.fileUri, last.fileName, last.opts)
      : startLink(last.url, last.opts);
  }, [start, startLink, followSuperseded]);

  const reset = useCallback(() => {
    activeJobId.current = null;
    startedAt.current = null;
    markRef.current = null;
    failedPolls.current = 0;
    stopFollowing();
    stopSuperseded();
    setState(IDLE);
  }, [stopFollowing, stopSuperseded]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      // Unmounted mid-job: a read or submit still in flight must not bind a job to a screen that is
      // gone, and nothing is followed any more. The server finishes the job and pushes as usual.
      mounted.current = false;
      activeJobId.current = null;
      startedAt.current = null;
      stopFollowing();
      stopSuperseded();
    };
  }, [stopFollowing, stopSuperseded]);

  return { state, start, startLink, startPreview, resumePreview, resumeLink, retry, reset };
}
