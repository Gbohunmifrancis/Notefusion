"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Pause, Play, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getSessionRecording, getSessionVideo } from "@/api/endpoints";
import type { SessionRecordingDetail } from "@/api/types";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { Segmented } from "@/components/Segmented";
import { StateView } from "@/components/StateView";
import { formatInstantDateTime } from "@/lib/format";
import { getReportingOffset } from "@/lib/reporting";
import { clock, pieceAt, recordingLength, stepAt } from "@/lib/sessions";
import { cn } from "@/lib/utils";

/** A session still recording is read again this often while the page is open, so new pieces and steps appear. */
const LIVE_REFRESH_MS = 15_000;

/**
 * One phone recording (board k-sessions): Sentry's video pieces played one after another on the recording's own
 * clock, the timeline with its screens and errors marked, what happened beside it (a step seeks the player there),
 * the errors with their stacks, and whose session it was.
 */
export function SessionPlayerView({ id }: { id: string }) {
  const state = useQuery({
    queryKey: ["sessions", "recording", id],
    queryFn: ({ signal }) => getSessionRecording(id, signal),
    refetchInterval: (query) => (query.state.data?.recording.recordingNow ? LIVE_REFRESH_MS : false),
  });
  const offset = getReportingOffset();
  const r = state.data?.recording;

  return (
    <div className="animate-fade-in space-y-5">
      <Link href="/sessions" className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground transition hover:text-foreground">
        <ArrowLeft size={14} aria-hidden="true" /> Sessions
      </Link>
      <PageHeader
        title={r ? `${r.person?.name || r.person?.email || "Not signed in"} · ${formatInstantDateTime(r.startedAt, offset)}` : "Recording"}
        {...(r
          ? {
              subtitle: [r.device, r.os, r.build ? `build ${r.build}` : null, clock(r.durationSeconds * 1000)]
                .filter(Boolean)
                .join(" · "),
            }
          : {})}
        breadcrumb={["Dashboard", "Sessions", "Recording"]}
        actions={
          state.data ? (
            <a
              href={state.data.sentryUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[12.5px] font-medium text-brand hover:underline"
            >
              Open in Sentry <ExternalLink size={13} aria-hidden="true" />
            </a>
          ) : null
        }
      />
      <StateView state={state} loadingLabel="Loading the recording">
        {(detail) => <Player detail={detail} />}
      </StateView>
    </div>
  );
}

function Player({ detail }: { detail: SessionRecordingDetail }) {
  const { recording, videos, steps, errors } = detail;
  const length = recordingLength(recording.durationSeconds, videos);
  const video = useRef<HTMLVideoElement>(null);
  const urls = useRef(new Map<number, string>());
  const [piece, setPiece] = useState(videos.length > 0 ? 0 : -1);
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<"1" | "2">("1");
  const [failed, setFailed] = useState<string | null>(null);
  const pendingSeek = useRef<number | null>(null);

  // Object URLs are let go with the page.
  useEffect(() => {
    const held = urls.current;
    return () => held.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const load = useCallback(
    async (index: number): Promise<string | null> => {
      const v = videos[index];
      if (!v) return null;
      const known = urls.current.get(v.segmentId);
      if (known) return known;
      const blob = await getSessionVideo(recording.id, recording.project, v.segmentId);
      const url = URL.createObjectURL(blob);
      urls.current.set(v.segmentId, url);
      return url;
    },
    [videos, recording.id, recording.project],
  );

  // The current piece is loaded into the player, and the next one fetched behind it.
  useEffect(() => {
    if (piece < 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const url = await load(piece);
        const el = video.current;
        if (cancelled || !url || !el) return;
        if (el.src !== url) el.src = url;
        el.playbackRate = Number(speed);
        const seekTo = pendingSeek.current;
        pendingSeek.current = null;
        el.currentTime = seekTo === null ? 0 : Math.max(0, (seekTo - videos[piece]!.startMs) / 1000);
        if (playing) await el.play().catch(() => setPlaying(false));
        void load(piece + 1).catch(() => undefined);
        setFailed(null);
      } catch (error) {
        if (!cancelled) setFailed(error instanceof Error ? error.message : "This part of the recording couldn't be loaded.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // `playing` and `speed` are applied where they change; a new piece reads them as they are.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piece, load]);

  useEffect(() => {
    if (video.current) video.current.playbackRate = Number(speed);
  }, [speed]);

  const seek = (ms: number) => {
    const target = Math.min(Math.max(0, ms), length);
    const index = pieceAt(videos, target);
    setAt(target);
    if (index < 0) return;
    if (index === piece && video.current) {
      video.current.currentTime = Math.max(0, (target - videos[index]!.startMs) / 1000);
    } else {
      pendingSeek.current = target;
      setPiece(index);
    }
  };

  const toggle = async () => {
    const el = video.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      setPlaying(true);
      await el.play().catch(() => setPlaying(false));
    }
  };

  const reached = stepAt(steps, at);
  const markers = useMemo(() => steps.filter((s) => s.kind === "screen"), [steps]);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
      <div className="flex flex-col items-center">
        <div className="w-[270px] rounded-[34px] bg-[#05070b] p-2 shadow-lg">
          {videos.length === 0 ? (
            <div className="grid aspect-[9/19.5] place-items-center rounded-[26px] bg-[#0d1117] px-6 text-center text-[12.5px] text-slate-400">
              <p>
                No video for this session here yet.
                <a href={detail.sentryUrl} target="_blank" rel="noreferrer" className="mt-2 block font-medium text-sky-300 hover:underline">
                  Watch it in Sentry ↗
                </a>
              </p>
            </div>
          ) : (
            <video
              ref={video}
              className="aspect-[9/19.5] w-full rounded-[26px] bg-black object-contain"
              playsInline
              muted
              onTimeUpdate={(e) => {
                const v = videos[piece];
                if (v) setAt(v.startMs + e.currentTarget.currentTime * 1000);
              }}
              onEnded={() => {
                if (piece + 1 < videos.length) setPiece(piece + 1);
                else setPlaying(false);
              }}
            />
          )}
        </div>

        <div className="mt-3 w-[300px]">
          <div
            role="slider"
            tabIndex={0}
            aria-label="Position in the recording"
            aria-valuemin={0}
            aria-valuemax={length}
            aria-valuenow={Math.round(at)}
            className="relative h-2 cursor-pointer rounded-full bg-border"
            onClick={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              seek(((e.clientX - box.left) / box.width) * length);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") seek(at + 5000);
              if (e.key === "ArrowLeft") seek(at - 5000);
            }}
          >
            <div className="absolute inset-y-0 left-0 rounded-full bg-brand" style={{ width: `${(at / Math.max(1, length)) * 100}%` }} />
            {markers.map((m, i) => (
              <span
                key={`s${i}`}
                className="absolute -top-0.5 h-3 w-0.5 bg-slate-400"
                style={{ left: `${(m.atMs / Math.max(1, length)) * 100}%` }}
                title={m.text}
              />
            ))}
            {errors.map((e) => (
              <span
                key={e.id}
                className="absolute -top-1 size-3.5 -translate-x-1/2 rounded-full border-2 border-card bg-warning"
                style={{ left: `${(e.atMs / Math.max(1, length)) * 100}%` }}
                title={e.title}
              />
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between text-[12px] text-muted-foreground">
            <button
              type="button"
              onClick={() => void toggle()}
              disabled={videos.length === 0}
              className="inline-flex items-center gap-2 font-medium text-foreground disabled:opacity-40"
            >
              {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
              {clock(at)} / {clock(length)}
            </button>
            <Segmented
              label="Speed"
              value={speed}
              onChange={setSpeed}
              options={[
                { value: "1", label: "1×" },
                { value: "2", label: "2×" },
              ]}
            />
          </div>
          {recording.recordingNow && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-success-deep">
              <span className="size-1.5 animate-pulse rounded-full bg-success" aria-hidden="true" />
              Still recording: new parts appear as they arrive.
            </p>
          )}
          {failed && (
            <p className="mt-2 text-[12px] text-warning-deep">
              {failed}{" "}
              <a href={detail.sentryUrl} target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline">
                Watch it in Sentry ↗
              </a>
            </p>
          )}
        </div>
      </div>

      <div className="min-w-0 space-y-4">
        <Card title="What happened" bleed>
          {steps.length === 0 && errors.length === 0 ? (
            <p className="px-5 py-4 text-[13px] text-muted-foreground">Nothing was noted in this session.</p>
          ) : (
            <ol className="max-h-[460px] overflow-y-auto py-1">
              {timeline(detail).map((item, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => seek(item.atMs)}
                    className={cn(
                      "flex w-full gap-3 px-5 py-1.5 text-left text-[12.5px] transition hover:bg-muted",
                      item.error ? "bg-warning/10" : item.index === reached ? "bg-brand/10" : "",
                    )}
                  >
                    <span className="w-10 flex-none pt-px font-mono text-[11.5px] text-faint">{clock(item.atMs)}</span>
                    {item.error ? (
                      <span className="min-w-0">
                        <span className="flex items-start gap-1.5 font-medium text-warning-deep">
                          <TriangleAlert size={14} className="mt-0.5 flex-none" aria-hidden="true" />
                          {item.error.title}
                        </span>
                        {item.error.frames.length > 0 && (
                          <span className="mt-1 block rounded-sm border border-border bg-muted/40 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-foreground">
                            {item.error.frames.map((f) => (
                              <span key={f} className="block truncate">
                                {f}
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className={cn("min-w-0 truncate", item.kind === "screen" ? "font-medium text-foreground" : "text-muted-foreground")}>
                        {item.kind === "screen" ? `Screen: ${item.text}` : item.text}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card title="Account">
          {recording.person ? (
            <div className="flex items-center justify-between text-[13px]">
              <div className="min-w-0">
                <p className="font-medium text-foreground">{recording.person.name || recording.person.email}</p>
                <p className="truncate text-faint">{recording.person.email}</p>
              </div>
              <Link href={`/users/${recording.person.id}`} className="text-[12.5px] font-medium text-brand hover:underline">
                Open account
              </Link>
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">Not signed in during this session.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

type TimelineItem = {
  atMs: number;
  index: number;
  kind: string;
  text: string;
  error?: SessionRecordingDetail["errors"][number];
};

/** Steps and errors together, in time order; an error sorts after a step at the same moment. */
function timeline({ steps, errors }: SessionRecordingDetail): TimelineItem[] {
  const items: TimelineItem[] = steps.map((s, index) => ({ atMs: s.atMs, index, kind: s.kind, text: s.text }));
  for (const error of errors) items.push({ atMs: error.atMs, index: -1, kind: "error", text: error.title, error });
  return items.sort((a, b) => a.atMs - b.atMs || (a.error ? 1 : 0) - (b.error ? 1 : 0));
}
