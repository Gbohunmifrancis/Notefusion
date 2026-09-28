import { useCallback, useEffect, useRef, useState } from "react";
import { HubConnection, HubConnectionBuilder, LogLevel } from "@microsoft/signalr";
import { transcriptionsApi } from "../api/endpoints";
import { baseURL, toApiError } from "../api/client";
import { tokenStore } from "./tokenStore";
import type { TranscriptionResult, TranscriptionStatus } from "../api/types";

export interface JobState {
  status: TranscriptionStatus | "idle";
  progress: number;
  result: TranscriptionResult | null;
  error: string | null;
  errorCode: string | null;
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
 * Listens via SignalR for job completion instead of HTTP polling.
 */
export function useJobPolling() {
  const [state, setState] = useState<JobState>({
    status: "idle",
    progress: 0,
    result: null,
    error: null,
    errorCode: null,
  });
  const activeJobId = useRef<string | null>(null);
  const connectionRef = useRef<HubConnection | null>(null);

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
      if (activeJobId.current !== job.jobId) return;

      const status = normalizeStatus(job.status);
      let error: string | null = null;
      if (status === "failed") {
        error =
          job.error && job.error.trim().length > 0
            ? job.error.trim()
            : "Transcription failed — please try a cleaner recording, closer to the microphone.";
      }

      setState({
        status,
        progress: job.progress ?? 1,
        result: job.result ?? null,
        error,
        errorCode: null, // webhook failures don't carry the HTTP error code
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

  const start = useCallback(
    async (
      fileUri: string,
      fileName: string,
      opts: { mode: "melody" | "poly"; key?: string; tempo?: number },
    ) => {
      setState({
        status: "pending",
        progress: 0,
        result: null,
        error: null,
        errorCode: null,
      });
      activeJobId.current = null;
      try {
        const res = await transcriptionsApi.submit(fileUri, fileName, opts);

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

        if (typeof res !== "string" && inlineStatus === "done" && res.result) {
          setState({
            status: "done",
            progress: 1,
            result: res.result,
            error: null,
            errorCode: null,
          });
        }
        // If not inline resolved, we rely entirely on SignalR JobCompleted event

        return jobId;
      } catch (e) {
        const err = toApiError(e);
        setState({
          status: "failed",
          progress: 0,
          result: null,
          error: err.message,
          errorCode: err.code,
        });
        activeJobId.current = null;
        return null;
      }
    },
    [],
  );

  const reset = useCallback(() => {
    activeJobId.current = null;
    setState({
      status: "idle",
      progress: 0,
      result: null,
      error: null,
      errorCode: null,
    });
  }, []);

  return { state, start, reset };
}
