import { useCallback, useEffect, useMemo, useState } from "react";
import type { TranscriptionJob } from "../api/types";
import { formatClock } from "./clipRange";
import { normalizeStage, stageLabel } from "./jobProgress";
import { watchJob } from "./jobStream";
import { linkJobRow, type LinkJob, type LinkJobRow } from "./linkJob";
import { linkJobStore } from "./linkJobStore";

const WORDS = {
  stage: (stage: unknown, status: "pending" | "processing" | null, queuePosition: number | null | undefined) =>
    stageLabel(status ? normalizeStage(stage, status) : null, queuePosition),
  clock: formatClock,
};

/**
 * The song sent from Song link, for the Library's "On its way" (board m-ux-medium P2e): the job `linkJobStore` keeps
 * until it is opened or dismissed, followed live while the Library is on show (`focused`) — off it, nothing listens,
 * so the finished push still comes. Null when there is none.
 */
export function useSongOnItsWay(userId: string | null | undefined, focused: boolean) {
  const [kept, setKept] = useState<LinkJob | null>(null);
  const [job, setJob] = useState<TranscriptionJob | null>(null);

  useEffect(() => {
    if (!userId || !focused) return;
    let live = true;
    void linkJobStore.read(userId).then((k) => {
      if (!live) return;
      setKept((prev) => (prev?.jobId === k?.jobId ? prev : k));
      if (!k) setJob(null);
    });
    return () => {
      live = false;
    };
  }, [userId, focused]);

  const jobId = kept?.jobId ?? null;
  useEffect(() => {
    if (!jobId || !focused) return;
    return watchJob(jobId, { onJob: (j) => setJob(j) });
  }, [jobId, focused]);

  const row: LinkJobRow | null = useMemo(() => (kept ? linkJobRow(kept, job, WORDS) : null), [kept, job]);

  /** Opened or dismissed: it leaves "On its way". */
  const forget = useCallback(() => {
    linkJobStore.clear();
    setKept(null);
    setJob(null);
  }, []);

  return { jobId, row, forget };
}
