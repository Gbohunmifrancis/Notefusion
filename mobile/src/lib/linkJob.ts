/**
 * A song link sent from the Song link screen, kept until its job ends: leaving the screen while the song is
 * transcribed (it can take minutes) used to lose the job card, so coming back showed an empty screen while the job
 * still ran. The screen follows it again from here (`linkJobStore`, `useJobPolling.resumeLink`). Pure
 * (`linkJob.test.ts`).
 */

/** Past this the job has long ended or been closed by the server's sweep: nothing to take up again. */
export const LINK_JOB_KEEP_MS = 6 * 60 * 60 * 1000;

/** What the link was sent with, so "Try again" after a long wait sends the same thing. */
export interface LinkJobOptions {
  mode: "melody";
  timeSignature?: string;
  keyboardTranspose?: number;
  startSeconds?: number;
  endSeconds?: number;
}

export interface LinkJob {
  jobId: string;
  url: string;
  /** The account that sent it: another one signed in on this phone never takes it up. */
  userId: string;
  /** When it was sent (ms). */
  sentAt: number;
  opts: LinkJobOptions;
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** The kept link job for `userId`, while it is recent at `now`; null when there is none, it is unreadable, old or another account's. */
export function readLinkJob(raw: string | null | undefined, now: number, userId: string): LinkJob | null {
  if (!raw) return null;
  let p: unknown;
  try {
    p = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof p !== "object" || p === null) return null;
  const { jobId, url, userId: owner, sentAt, opts } = p as Record<string, unknown>;
  if (typeof jobId !== "string" || !jobId || typeof url !== "string" || !url) return null;
  if (owner !== userId || typeof sentAt !== "number" || !Number.isFinite(sentAt)) return null;
  const age = now - sentAt;
  if (age < 0 || age >= LINK_JOB_KEEP_MS) return null;
  const o = typeof opts === "object" && opts !== null ? (opts as Record<string, unknown>) : {};
  return {
    jobId,
    url,
    userId,
    sentAt,
    opts: {
      mode: "melody",
      timeSignature: typeof o.timeSignature === "string" ? o.timeSignature : undefined,
      keyboardTranspose: num(o.keyboardTranspose),
      startSeconds: num(o.startSeconds),
      endSeconds: num(o.endSeconds),
    },
  };
}
