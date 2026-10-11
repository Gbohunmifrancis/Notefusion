import { useCallback, useEffect, useRef, useState } from "react";
import { HubConnection, HubConnectionBuilder, LogLevel } from "@microsoft/signalr";
import { transcriptionsApi, type SubmitOptions } from "../api/endpoints";
import { baseURL, safeReason, toApiError } from "../api/client";
import { tokenStore } from "./tokenStore";
import {
  canRetry,
  isOffline,
  isStalled,
  markProgress,
  normalizeStage,
  type ClientStage,
  type ProgressMark,
} from "./jobProgress";
import type {
  TranscriptionResult,
  TranscriptionSource,
  TranscriptionStatus,
} from "../api/types";
import { rating } from "./rating";

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
};

/** How often the job is re-read over HTTP while it runs; SignalR still delivers the finish. */
const POLL_MS = 2500;

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

/**
 * Listens via SignalR for job completion instead of HTTP polling.
 */
export function useJobPolling() {
  const [state, setState] = useState<JobState>(IDLE);
  const activeJobId = useRef<string | null>(null);
  /**
   * Jobs this screen submitted and then resubmitted past ("Try again"): the server still
   * finishes them, and whichever job finishes first is the result the person is waiting for.
   */
  const supersededJobs = useRef<Set<string>>(new Set());
  const bufferedJobsRef = useRef<Record<string, any>>({});
  const connectionRef = useRef<HubConnection | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** When the current submit began — the twelve-minute clock behind "Try again". */
  const startedAt = useRef<number | null>(null);
  /** The last visible movement — the ninety-second clock behind the "server is busy" line. */
  const markRef = useRef<ProgressMark | null>(null);
  const failedPolls = useRef(0);
  const lastSubmit = useRef<LastSubmit | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const finish = useCallback((job: any, fallback: string) => {
    const status = normalizeStatus(job.status);
    // Whatever clock was running — the upload's or the poll's — has nothing left to measure.
    stopPolling();
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
    });
  }, [stopPolling]);

  /**
   * Progress over HTTP while the job runs. SignalR only speaks at the end, and a
   * linked song spends minutes fetching and isolating vocals before that — time the
   * screen has to account for with a stage and a bar, not a spinner. Stops itself on
   * a terminal status, on reset, and whenever the job it was watching is replaced.
   *
   * A dropped poll is not a failed job: it is counted, and after three in a row the
   * screen says the API cannot be reached; the next good poll clears that. Nothing the
   * server says about a poll failure is ever shown.
   */
  const pollProgress = useCallback((jobId: string) => {
    stopPolling();
    const tick = async () => {
      if (activeJobId.current !== jobId) return;
      const now = Date.now();
      try {
        const job = await transcriptionsApi.getJob(jobId);
        if (activeJobId.current !== jobId) return;
        failedPolls.current = 0;
        const status = normalizeStatus(job.status);
        if (TERMINAL.includes(status)) {
          finish(job, "Transcription failed — please try again.");
          return;
        }
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
      } catch {
        if (activeJobId.current !== jobId) return;
        failedPolls.current += 1;
        setState((prev) => ({
          ...prev,
          stalled: isStalled(markRef.current, now),
          offline: isOffline(failedPolls.current),
          canRetry: canRetry(startedAt.current, now),
        }));
      }
      if (activeJobId.current === jobId) pollTimer.current = setTimeout(tick, POLL_MS);
    };
    pollTimer.current = setTimeout(tick, POLL_MS);
  }, [stopPolling, finish]);

  /**
   * The clocks while the file is still leaving the phone. There is no job to poll yet, but
   * the bytes can all be sent long before the API answers — on a busy server that answer
   * is what takes the time — and the card would otherwise sit at "100%" without a word.
   * Stops when the server answers (`track` replaces it), on failure, reset and unmount.
   */
  const tickUploadClocks = useCallback(
    (token: number) => {
      stopPolling();
      const tick = () => {
        if (startedAt.current !== token) return;
        const now = Date.now();
        setState((prev) => ({
          ...prev,
          stalled: isStalled(markRef.current, now),
          canRetry: canRetry(startedAt.current, now),
        }));
        pollTimer.current = setTimeout(tick, POLL_MS);
      };
      pollTimer.current = setTimeout(tick, POLL_MS);
    },
    [stopPolling],
  );

  useEffect(() => {
    let active = true;

    const connection = new HubConnectionBuilder()
      .withUrl(`${baseURL}/hubs/transcription`, {
        accessTokenFactory: async () => (await tokenStore.getAccess()) || "",
      })
      .configureLogging(LogLevel.Warning)
      .withAutomaticReconnect()
      .build();

    connection.on("JobCompleted", (job: any) => {
      if (!active) return;
      if (activeJobId.current !== job.jobId) {
        // A job this screen resubmitted past still counts when it finishes well; its failure
        // says nothing about the fresh job, so that is dropped.
        if (supersededJobs.current.has(job.jobId)) {
          supersededJobs.current.delete(job.jobId);
          if (normalizeStatus(job.status) !== "done") return;
        } else {
          bufferedJobsRef.current[job.jobId] = job;
          return;
        }
      }
      // A finish from either the watched job or one it replaced ends the wait.
      activeJobId.current = null;
      supersededJobs.current.clear();
      finish(job, "Transcription failed — please try a cleaner recording, closer to the microphone.");
    });

    connection.start().catch((err) => {
      console.warn("SignalR connection failed:", err);
    });

    connectionRef.current = connection;

    return () => {
      active = false;
      connection.stop();
    };
  }, [finish]);

  /** Shared tail of `start` and `startLink`: bind the job, drain any early finish, start polling. */
  const track = useCallback(
    (res: Awaited<ReturnType<typeof transcriptionsApi.submit>> | string) => {
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
        // Process any buffered job that arrived before the HTTP response resolved
        if (bufferedJobsRef.current[jobId]) {
          const job = bufferedJobsRef.current[jobId];
          delete bufferedJobsRef.current[jobId];
          finish(job, "Transcription failed — please try again.");
          return jobId;
        }

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
        pollProgress(jobId);
        return jobId;
    },
    [pollProgress, finish],
  );

  const fail = useCallback((e: unknown) => {
    const err = toApiError(e);
    stopPolling();
    setState({
      ...IDLE,
      status: "failed",
      error: err.message,
      errorCode: err.code,
    });
    activeJobId.current = null;
    return null;
  }, [stopPolling]);

  /** Opens a fresh wait: the clocks start, nothing counted against the last job carries over. */
  const begin = useCallback(
    (stage: ClientStage) => {
      stopPolling();
      const now = Date.now();
      startedAt.current = now;
      markRef.current = markProgress(null, stage, 0, now);
      failedPolls.current = 0;
      setState({ ...IDLE, status: "pending", stage });
      activeJobId.current = null;
    },
    [stopPolling],
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

  const start = useCallback(
    async (
      fileUri: string,
      fileName: string,
      opts: SubmitOptions,
    ) => {
      lastSubmit.current = { kind: "upload", fileUri, fileName, opts };
      begin("uploading");
      const token = startedAt.current as number;
      tickUploadClocks(token);
      try {
        const res = await transcriptionsApi.submit(fileUri, fileName, opts, {
          onUploadProgress: (fraction) => {
            // Only while this very upload is the one on screen, and only before the server answered.
            if (startedAt.current !== token) return;
            setState((prev) => {
              if (prev.stage !== "uploading") return prev;
              const progress = Math.max(prev.progress, fraction);
              // Bytes leaving the phone are movement; the stall clock measures from the last of them.
              markRef.current = markProgress(markRef.current, "uploading", progress, Date.now());
              return { ...prev, progress };
            });
          },
        });
        if (startedAt.current !== token) return null;
        return track(res);
      } catch (e) {
        if (startedAt.current !== token) return null;
        return fail(e);
      }
    },
    [track, fail, begin, tickUploadClocks],
  );

  /**
   * "Try again" after a long wait: the same recording or link is submitted afresh. The job
   * being left behind keeps running on the server, and its finish — over SignalR, or the
   * completion push — still counts, so nothing the person already paid for is thrown away.
   */
  const retry = useCallback(async () => {
    const last = lastSubmit.current;
    if (!last) return null;
    if (activeJobId.current) supersededJobs.current.add(activeJobId.current);
    return last.kind === "upload"
      ? start(last.fileUri, last.fileName, last.opts)
      : startLink(last.url, last.opts);
  }, [start, startLink]);

  const reset = useCallback(() => {
    activeJobId.current = null;
    supersededJobs.current.clear();
    startedAt.current = null;
    markRef.current = null;
    failedPolls.current = 0;
    stopPolling();
    setState(IDLE);
  }, [stopPolling]);

  useEffect(
    () => () => {
      // Unmounted mid-job: a poll or submit still in flight must not reschedule itself or
      // bind a job to a screen that is gone. The server finishes the job and pushes as usual.
      activeJobId.current = null;
      startedAt.current = null;
      stopPolling();
    },
    [stopPolling],
  );

  return { state, start, startLink, retry, reset };
}
