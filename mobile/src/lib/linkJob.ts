/**
 * A song link sent from the Song link screen, kept until its job ends: leaving the screen while the song is
 * transcribed (it can take minutes) used to lose the job card, so coming back showed an empty screen while the job
 * still ran. The screen follows it again from here (`linkJobStore`, `useJobPolling.resumeLink`), and the Library lists
 * it in "On its way" with the takes (board m-ux-medium P2e, `linkJobRow`). Pure (`linkJob.test.ts`).
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

/** The song as the link was looked up before it was sent, so "On its way" names it before the worker has. */
export interface LinkSong {
  title: string;
  artist: string;
  thumbnailUrl: string | null;
}

export interface LinkJob {
  jobId: string;
  url: string;
  /** The account that sent it: another one signed in on this phone never takes it up. */
  userId: string;
  /** When it was sent (ms). */
  sentAt: number;
  opts: LinkJobOptions;
  song?: LinkSong;
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
  const { jobId, url, userId: owner, sentAt, opts, song } = p as Record<string, unknown>;
  if (typeof jobId !== "string" || !jobId || typeof url !== "string" || !url) return null;
  if (owner !== userId || typeof sentAt !== "number" || !Number.isFinite(sentAt)) return null;
  const age = now - sentAt;
  if (age < 0 || age >= LINK_JOB_KEEP_MS) return null;
  const o = typeof opts === "object" && opts !== null ? (opts as Record<string, unknown>) : {};
  const s = typeof song === "object" && song !== null ? (song as Record<string, unknown>) : null;
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
    ...(s && typeof s.title === "string" && s.title
      ? {
          song: {
            title: s.title,
            artist: typeof s.artist === "string" ? s.artist : "",
            thumbnailUrl: typeof s.thumbnailUrl === "string" && s.thumbnailUrl ? s.thumbnailUrl : null,
          },
        }
      : {}),
  };
}

/** Where a job stands, in any spelling the API has used for its status (the enum's number, its name). */
export function linkJobState(status: unknown): "running" | "done" | "failed" {
  if (status === 2 || status === "done" || status === "Done") return "done";
  if (status === 3 || status === "failed" || status === "Failed") return "failed";
  return "running";
}

/** What "On its way" draws for a song sent from Song link (board m-ux-medium P2e). */
export interface LinkJobRow {
  /** "Way Maker · Sinach"; "Song from a link" until the song is known. */
  title: string;
  /** The stage in the job's own words and the section picked ("Isolating the voice · 1:00–2:00"), or "Ready — tap to open". */
  line: string;
  state: "running" | "done" | "failed";
  /** 0..1, for the bar while it runs. */
  progress: number;
  /** The song's artwork, shown when Data saver is off. */
  thumbnailUrl: string | null;
}

/** The job as last read (null before the first reading): its status, stage, place in line, progress and song. */
export interface LinkJobReading {
  status: unknown;
  stage?: unknown;
  queuePosition?: number | null;
  progress?: number | null;
  source?: {
    title?: string | null;
    artist?: string | null;
    thumbnailUrl?: string | null;
    startSeconds?: number | null;
    endSeconds?: number | null;
  } | null;
}

/**
 * The words the row borrows, handed in so this stays free of other modules (the app passes `jobProgress`'s
 * `stageLabel`/`normalizeStage` and `clipRange`'s `formatClock`).
 */
export interface LinkJobWords {
  /** The stage in the job's own words; `status` null before the first reading. */
  stage: (stage: unknown, status: "pending" | "processing" | null, queuePosition: number | null | undefined) => string;
  /** m:ss. */
  clock: (seconds: number) => string;
}

export function linkJobRow(kept: LinkJob, job: LinkJobReading | null, words: LinkJobWords): LinkJobRow {
  const state = job ? linkJobState(job.status) : "running";
  const source = job?.source ?? null;
  const title = source?.title || kept.song?.title || "";
  const artist = source?.artist || kept.song?.artist || "";
  const start = source?.startSeconds ?? kept.opts.startSeconds ?? null;
  const end = source?.endSeconds ?? kept.opts.endSeconds ?? null;
  const section = end != null && end > (start ?? 0) ? `${words.clock(start ?? 0)}–${words.clock(end)}` : null;
  const pending = job?.status === 0 || job?.status === "pending" || job?.status === "Pending";
  const status = job ? (pending ? "pending" : "processing") : null;
  const line =
    state === "done"
      ? "Ready — tap to open"
      : state === "failed"
        ? "Couldn't be written"
        : [words.stage(job?.stage, status, job?.queuePosition), section].filter(Boolean).join(" · ");
  return {
    title: title ? (artist ? `${title} · ${artist}` : title) : "Song from a link",
    line,
    state,
    progress: Math.min(1, Math.max(0, job?.progress ?? 0)),
    thumbnailUrl: source?.thumbnailUrl || kept.song?.thumbnailUrl || null,
  };
}
