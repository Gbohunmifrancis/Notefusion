"use client";

import { useQuery } from "@tanstack/react-query";
import { Music2, Radio, Volume2, VolumeX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { getLiveActivity } from "@/api/endpoints";
import type { LiveActivity } from "@/api/types";

const SOUND_KEY = "notefusion_admin_live_sound";
const POLL_MS = 15_000;

/**
 * Live notices for the console: a pop-up and a short chime when someone comes online or starts a
 * transcription. It polls the live endpoint and announces only what is new since its last look; the
 * first look of a session is taken quietly, so opening the console does not ring for everyone who
 * was already there. The speaker button mutes the sound (remembered on this browser); the pop-ups stay.
 */
export function LiveNotices() {
  const router = useRouter();
  const [soundOn, setSoundOn] = useState(true);
  const seenOnline = useRef<Set<string> | null>(null);
  const seenJobs = useRef<Set<string> | null>(null);
  const audio = useRef<AudioContext | null>(null);

  useEffect(() => {
    try {
      setSoundOn(localStorage.getItem(SOUND_KEY) !== "off");
    } catch {
      /* private mode: sound on */
    }
    // Browsers only let a page play sound after the person has interacted with it, so the audio
    // context is created (or resumed) on the first click anywhere in the console.
    const unlock = () => {
      try {
        audio.current ??= new AudioContext();
        void audio.current.resume();
      } catch {
        /* no Web Audio: pop-ups only */
      }
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  const live = useQuery({
    queryKey: ["live-activity"],
    queryFn: ({ signal }) => getLiveActivity(signal),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: true,
    retry: false,
  });

  useEffect(() => {
    if (!live.data) return;
    announce(live.data);
    // announce reads refs and the latest soundOn; it runs once per fresh payload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.data]);

  function chime(kind: "online" | "job") {
    if (!soundOn || !audio.current || audio.current.state !== "running") return;
    const ctx = audio.current;
    // Two soft notes: rising for someone arriving, a fifth for a transcription starting.
    const notes = kind === "online" ? [659.25, 880] : [523.25, 783.99];
    notes.forEach((freq, i) => {
      const at = ctx.currentTime + i * 0.12;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.4);
    });
  }

  function announce(data: LiveActivity) {
    const onlineIds = new Set(data.online.map((u) => u.id));
    const jobIds = new Set(data.transcribing.map((j) => j.jobId));

    // First look: remember, say nothing.
    if (seenOnline.current === null || seenJobs.current === null) {
      seenOnline.current = onlineIds;
      seenJobs.current = jobIds;
      return;
    }

    const arrived = data.online.filter((u) => !seenOnline.current!.has(u.id));
    const started = data.transcribing.filter((j) => !seenJobs.current!.has(j.jobId) && !j.finished);
    seenOnline.current = onlineIds;
    for (const id of jobIds) seenJobs.current.add(id);

    // A burst (a deploy, a returning network) becomes one summary, not a stack of pop-ups.
    if (arrived.length > 3) {
      toast(`${arrived.length} people came online`, { icon: <Radio size={16} className="text-emerald-500" /> });
    } else {
      for (const u of arrived) {
        toast(`${u.fullName || u.email} came online`, {
          description: u.email,
          icon: <span className="block h-2.5 w-2.5 rounded-full bg-emerald-500" />,
          action: { label: "View", onClick: () => router.push(`/users/${u.id}`) },
        });
      }
    }
    if (arrived.length) chime("online");

    for (const j of started.slice(0, 3)) {
      const who = j.preview ? "Someone on the website" : j.fullName || j.email || "A user";
      toast(`${who} is transcribing`, {
        description: j.preview ? `A free preview · ${j.kind}` : `${j.kind}${j.email ? ` · ${j.email}` : ""}`,
        icon: <Music2 size={16} className="text-blue-600" />,
        ...(j.userId ? { action: { label: "Journey", onClick: () => router.push(`/activity/journey?userId=${j.userId}`) } } : {}),
      });
    }
    if (started.length > 3) toast(`${started.length - 3} more transcriptions started`);
    if (started.length) chime("job");
  }

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    try {
      localStorage.setItem(SOUND_KEY, next ? "on" : "off");
    } catch {
      /* private mode */
    }
    if (next) {
      try {
        audio.current ??= new AudioContext();
        void audio.current.resume();
      } catch {
        /* no Web Audio */
      }
    }
  }

  const online = live.data?.online.length ?? 0;
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="hidden items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 sm:inline-flex dark:bg-emerald-950/50 dark:text-emerald-400"
        title="Accounts seen in the last five minutes"
      >
        <span className="relative flex h-2 w-2">
          {online > 0 && <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 motion-safe:animate-ping" />}
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        {online} online
      </span>
      <button
        type="button"
        onClick={toggleSound}
        aria-pressed={soundOn}
        aria-label={soundOn ? "Mute live alert sounds" : "Turn on live alert sounds"}
        title={soundOn ? "Live alerts: sound on" : "Live alerts: sound off"}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-zinc-900 dark:hover:text-white"
      >
        {soundOn ? <Volume2 size={17} /> : <VolumeX size={17} />}
      </button>
    </div>
  );
}
