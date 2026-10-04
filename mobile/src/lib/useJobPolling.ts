import { useCallback, useEffect, useRef, useState } from "react";
import { HubConnection, HubConnectionBuilder, LogLevel } from "@microsoft/signalr";
import { transcriptionsApi, type SubmitOptions } from "../api/endpoints";
import { baseURL, safeReason, toApiError } from "../api/client";
import { linkInfoApi, type LinkSubmitOptions } from "./linkInfo";
import { tokenStore } from "./tokenStore";
import type {
  TranscriptionResult,
  TranscriptionSource,
  TranscriptionStage,
  TranscriptionStatus,
} from "../api/types";

export interface JobState {
  status: TranscriptionStatus | "idle";
  progress: number;
  result: TranscriptionResult | null;
  error: string | null;
  errorCode: string | null;
  /** Which step a linked song is on; null for an upload or once finished. */
  stage: TranscriptionStage | null;
  /** The song behind a link, as soon as the worker has read it. */
  source: TranscriptionSource | null;
}

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

/**
 * Listens via SignalR for job completion instead of HTTP polling.
 */
export function useJobPolling() {
  const [state, setState] = useState<JobState>({
    status: "idle",
    progress: 0,
    result: null,
    error: null,
    errorCode: null,
    stage: null,
    source: null,
  });
  const activeJobId = useRef<string | null>(null);
  const bufferedJobsRef = useRef<Record<string, any>>({});
  const connectionRef = useRef<HubConnection | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  /**
   * Progress over HTTP while the job runs. SignalR only speaks at the end, and a
   * linked song spends minutes fetching and isolating vocals before that — time the
   * screen has to account for with a stage and a bar, not a spinner. Stops itself on
   * a terminal status, on reset, and whenever the job it was watching is replaced.
   */
  const pollProgress = useCallback((jobId: string) => {
    stopPolling();
    const tick = async () => {
      if (activeJobId.current !== jobId) return;
      try {
        const job = await transcriptionsApi.getJob(jobId);
        if (activeJobId.current !== jobId) return;
        const status = normalizeStatus(job.status);
        if (status === "done" || status === "failed") {
          setState({
            status,
            progress: status === "done" ? 1 : 0,
            result: job.result ?? null,
            error:
              status === "failed"
                ? safeReason(job.error, "Transcription failed — please try again.")
                : null,
            errorCode: null,
            stage: null,
            source: job.source ?? job.result?.source ?? null,
          });
          return;
        }
        setState((prev) => ({
          ...prev,
          status,
          progress: Math.max(prev.progress, job.progress ?? 0),
          stage: job.stage ?? prev.stage,
          source: job.source ?? prev.source,
        }));
      } catch {
        // A dropped poll is not a failed job; the next tick, or SignalR, will say.
      }
      if (activeJobId.current === jobId) pollTimer.current = setTimeout(tick, POLL_MS);
    };
    pollTimer.current = setTimeout(tick, POLL_MS);
  }, [stopPolling]);

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
        bufferedJobsRef.current[job.jobId] = job;
        return;
      }

      const status = normalizeStatus(job.status);
      let error: string | null = null;
      if (status === "failed") {
        error = safeReason(job.error, "Transcription failed — please try a cleaner recording, closer to the microphone.");
      }

      setState({
        status,
        progress: job.progress ?? 1,
        result: job.result ?? null,
        error,
        errorCode: null, // webhook failures don't carry the HTTP error code
        stage: null,
        source: job.source ?? job.result?.source ?? null,
      });
    });

    connection.start().catch((err) => {
      console.warn("SignalR connection failed:", err);
    });
    
    connectionRef.current = connection;

    return () => {
      active = false;
      connection.stop();
    };
  }, []);

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
          const status = normalizeStatus(job.status);
          setState({
            status,
            progress: job.progress ?? 1,
            result: job.result ?? null,
            error: status === 'failed' ? safeReason(job.error, 'Transcription failed — please try again.') : null,
            errorCode: null,
            stage: null,
            source: job.source ?? job.result?.source ?? null,
          });
          return jobId;
        }

        const inlineStatus =
          typeof res !== "string" ? normalizeStatus(res.status) : "pending";

        if (typeof res !== "string" && inlineStatus === "done" && res.result) {
          setState({
            status: "done",
            progress: 1,
            result: res.result,
            error: null,
            errorCode: null,
            stage: null,
            source: res.source ?? res.result.source ?? null,
          });
          return jobId;
        }
        if (typeof res !== "string") {
          setState((prev) => ({
            ...prev,
            stage: res.stage ?? prev.stage,
            source: res.source ?? prev.source,
          }));
        }
        pollProgress(jobId);
        return jobId;
    },
    [pollProgress],
  );

  const fail = useCallback((e: unknown) => {
    const err = toApiError(e);
    setState({
      status: "failed",
      progress: 0,
      result: null,
      error: err.message,
      errorCode: err.code,
      stage: null,
      source: null,
    });
    activeJobId.current = null;
    return null;
  }, []);

  /**
   * A song behind a link, or the section of it in `opts.startSeconds`/`endSeconds`. Same
   * lifecycle as `start`; the worker reports its stages.
   */
  const startLink = useCallback(
    async (url: string, opts: LinkSubmitOptions) => {
      stopPolling();
      setState({
        status: "pending",
        progress: 0,
        result: null,
        error: null,
        errorCode: null,
        stage: "fetching",
        source: null,
      });
      activeJobId.current = null;
      try {
        return track(await linkInfoApi.submit(url, opts));
      } catch (e) {
        return fail(e);
      }
    },
    [track, fail, stopPolling],
  );

  const start = useCallback(
    async (
      fileUri: string,
      fileName: string,
      opts: SubmitOptions,
    ) => {
      stopPolling();
      setState({
        status: "pending",
        progress: 0,
        result: null,
        error: null,
        errorCode: null,
        stage: null,
        source: null,
      });
      activeJobId.current = null;
      try {
        const res = await transcriptionsApi.submit(fileUri, fileName, opts);
        return track(res);
      } catch (e) {
        return fail(e);
      }
    },
    [track, fail, stopPolling],
  );

  const reset = useCallback(() => {
    activeJobId.current = null;
    stopPolling();
    setState({
      status: "idle",
      progress: 0,
      result: null,
      error: null,
      errorCode: null,
      stage: null,
      source: null,
    });
  }, [stopPolling]);

  useEffect(() => stopPolling, [stopPolling]);

  return { state, start, startLink, reset };
}
