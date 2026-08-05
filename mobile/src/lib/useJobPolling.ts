import { useCallback, useEffect, useRef, useState } from "react";
import { transcriptionsApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import type { TranscriptionResult, TranscriptionStatus } from "../api/types";

export interface JobState {
  status: TranscriptionStatus | "idle";
  progress: number;
  result: TranscriptionResult | null;
  error: string | null;
}

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
 * Polls GET /api/transcriptions/jobs/{id} until the job reaches a terminal state.
 *
 * Bug fixes applied here:
 *
 *  Bug 6 — The previous implementation hardcoded the failure message as
 *  "Transcription failed. Try a cleaner clip." regardless of what the Python
 *  worker actually said.  The Python worker sets a rich error string on the job
 *  (e.g. "No confident notes detected in the recording") that now flows through:
 *
 *    Python job.error
 *      → C# JobResponse.Error  (previously missing — fixed in TranscriptionApiContracts.cs)
 *      → C# TranscriptionJobDto.Error  (field added to DTO)
 *      → JSON wire field "error"
 *      → TranscriptionJob.error  (field added to TS type)
 *      → JobState.error  (used directly here instead of hardcoded string)
 *
 *  Fallback: if the server error field is absent or empty (e.g. an old deploy),
 *  a sensible generic message is still shown.
 *
 * Backend transcription is async (queued single-worker inference), so the client
 * polls every ~1 s.  The timer is cleaned up on unmount so a backgrounded screen
 * never leaks.
 */
export function useJobPolling(intervalMs = 1000) {
  const [state, setState] = useState<JobState>({
    status: "idle",
    progress: 0,
    result: null,
    error: null,
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const poll = useCallback(
    (jobId: string) => {
      transcriptionsApi
        .getJob(jobId)
        .then((job) => {
          if (!active.current) return;

          const status = normalizeStatus(job.status);

          // Resolve the error message:
          //   1. Use the server-supplied message if present (Bug 6 fix).
          //   2. Fall back to a generic hint only when the server sends nothing.
          let error: string | null = null;
          if (status === "failed") {
            error =
              job.error && job.error.trim().length > 0
                ? job.error.trim()
                : "Transcription failed — please try a cleaner recording, closer to the microphone.";
          }

          setState({
            status,
            progress: job.progress ?? 0,
            result: job.result ?? null,
            error,
          });

          if (!TERMINAL.includes(status)) {
            timer.current = setTimeout(() => poll(jobId), intervalMs);
          }
        })
        .catch((e) => {
          if (!active.current) return;
          setState((s) => ({
            ...s,
            status: "failed",
            error: toApiError(e).message,
          }));
        });
    },
    [intervalMs],
  );

  /**
   * Upload a clip and begin polling.
   * Resolves to the job id string (or null on immediate failure).
   */
  const start = useCallback(
    async (
      fileUri: string,
      fileName: string,
      opts: { mode: "melody" | "poly"; key?: string; tempo?: number },
    ) => {
      setState({ status: "pending", progress: 0, result: null, error: null });
      try {
        const res = await transcriptionsApi.submit(fileUri, fileName, opts);

        // The C# API returns a TranscriptionJob envelope.
        // jobId lives at res.jobId (camelCase from JsonNamingPolicy.CamelCase).
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

        // If the server already resolved the job inline (edge case: synchronous fast path),
        // accept the result immediately without kicking off a polling loop.
        const inlineStatus =
          typeof res !== "string" ? normalizeStatus(res.status) : "pending";

        if (typeof res !== "string" && inlineStatus === "done" && res.result) {
          setState({
            status: "done",
            progress: 1,
            result: res.result,
            error: null,
          });
        } else {
          poll(jobId);
        }

        return jobId;
      } catch (e) {
        setState({
          status: "failed",
          progress: 0,
          result: null,
          error: toApiError(e).message,
        });
        return null;
      }
    },
    [poll],
  );

  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setState({ status: "idle", progress: 0, result: null, error: null });
  }, []);

  return { state, start, reset };
}
