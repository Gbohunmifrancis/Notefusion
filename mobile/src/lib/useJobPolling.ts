import { useCallback, useEffect, useRef, useState } from 'react';
import { transcriptionsApi } from '../api/endpoints';
import { toApiError } from '../api/client';
import type { TranscriptionResult, TranscriptionStatus } from '../api/types';

export interface JobState {
  status: TranscriptionStatus | 'idle';
  progress: number;
  result: TranscriptionResult | null;
  error: string | null;
}

const TERMINAL: TranscriptionStatus[] = ['done', 'failed'];

function normalizeStatus(status: unknown): TranscriptionStatus {
  if (status === 2 || status === 'done' || status === 'Done') return 'done';
  if (status === 3 || status === 'failed' || status === 'Failed') return 'failed';
  if (status === 1 || status === 'processing' || status === 'Processing') return 'processing';
  return 'pending';
}

/**
 * Polls GET /api/transcriptions/jobs/{id} until the job reaches a terminal state.
 * Backend transcription is async (queued single-worker inference), so the client
 * polls ~1s. Cleans up its timer on unmount so a backgrounded screen never leaks.
 */
export function useJobPolling(intervalMs = 1000) {
  const [state, setState] = useState<JobState>({
    status: 'idle',
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
          setState({
            status,
            progress: job.progress,
            result: job.result ?? null,
            error: status === 'failed' ? 'Transcription failed. Try a cleaner clip.' : null,
          });
          if (!TERMINAL.includes(status)) {
            timer.current = setTimeout(() => poll(jobId), intervalMs);
          }
        })
        .catch((e) => {
          if (!active.current) return;
          setState((s) => ({ ...s, status: 'failed', error: toApiError(e).message }));
        });
    },
    [intervalMs],
  );

  /** Upload a clip and begin polling. Resolves the job id (not the result). */
  const start = useCallback(
    async (fileUri: string, fileName: string, opts: { mode: 'melody' | 'poly'; key?: string; tempo?: number }) => {
      setState({ status: 'pending', progress: 0, result: null, error: null });
      try {
        const res = await transcriptionsApi.submit(fileUri, fileName, opts);
        const jobId = typeof res === 'string' ? res : (res?.jobId || (res as any)?.value);
        if (!jobId) {
          throw new Error('Invalid transcription response from server');
        }
        const status = typeof res !== 'string' ? normalizeStatus(res.status) : 'pending';
        if (typeof res !== 'string' && status === 'done' && res.result) {
          setState({ status: 'done', progress: 1, result: res.result, error: null });
        } else {
          poll(jobId);
        }
        return jobId;
      } catch (e) {
        setState({ status: 'failed', progress: 0, result: null, error: toApiError(e).message });
        return null;
      }
    },
    [poll],
  );

  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setState({ status: 'idle', progress: 0, result: null, error: null });
  }, []);

  return { state, start, reset };
}
