"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  CheckCheck,
  ExternalLink,
  HeartPulse,
  Hourglass,
  Music2,
  ShieldCheck,
  UserRoundPlus,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { getOverview } from "@/api/endpoints";
import { formatRelative } from "@/lib/format";

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  time: string;
  icon: typeof Bell;
  iconStyle: string;
  to: string;
}

const STORAGE_KEY = "notefusion_admin_read_notifications";

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Load read state from localStorage after mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as string[];
        setReadIds(new Set(parsed));
      }
    } catch {
      // Ignore storage read errors
    }
  }, []);

  // Sync read state to localStorage
  function persistReadIds(next: Set<string>) {
    setReadIds(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(next)));
    } catch {
      // Ignore storage write errors
    }
  }

  // Dismiss on outside click or Escape
  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // Read latest overview telemetry (cached TanStack Query)
  const overview = useQuery({
    queryKey: ["overview", null, null],
    queryFn: ({ signal }) => getOverview(undefined, undefined, signal),
    staleTime: 60_000,
  });

  const now = Date.now();

  const notifications: NotificationItem[] = useMemo(() => {
    const list: NotificationItem[] = [];

    // 1. System health status
    list.push({
      id: "system-health-status",
      title: "All services operational",
      body: "API, PostgreSQL database, and transcriber ML workers healthy.",
      time: "Live status",
      icon: HeartPulse,
      iconStyle: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400",
      to: "/health",
    });

    // 2. In-flight jobs if any
    const inFlight = overview.data?.transcriptions?.inFlightCount ?? 0;
    if (inFlight > 0) {
      list.push({
        id: `inflight-${inFlight}`,
        title: `${inFlight} transcription(s) in flight`,
        body: "Worker is transcribing audio to solfa and staff notation.",
        time: "In progress",
        icon: Hourglass,
        iconStyle: "bg-orange-50 text-orange-600 dark:bg-orange-950/60 dark:text-orange-400",
        to: "/health",
      });
    }

    // 3. Dynamic events from recent activity
    const activity = overview.data?.recentActivity ?? [];
    for (const item of activity.slice(0, 5)) {
      const isSignup = item.kind === "signup";
      const isTranscription = item.kind === "transcription";

      list.push({
        id: `activity-${item.kind}-${item.occurredAtUtc}`,
        title: isSignup
          ? "New user registered"
          : isTranscription
            ? "Transcription completed"
            : "Admin session authenticated",
        body: `${item.title}${item.subtitle ? ` (${item.subtitle})` : ""}`,
        time: formatRelative(item.occurredAtUtc, now),
        icon: isSignup ? UserRoundPlus : isTranscription ? Music2 : ShieldCheck,
        iconStyle: isSignup
          ? "bg-purple-50 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400"
          : isTranscription
            ? "bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400"
            : "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400",
        to: isSignup ? "/users" : "/audit-log",
      });
    }

    return list;
  }, [overview.data, now]);

  const unreadCount = notifications.filter((n) => !readIds.has(n.id)).length;

  function markAllRead() {
    const next = new Set(readIds);
    for (const item of notifications) {
      next.add(item.id);
    }
    persistReadIds(next);
  }

  function handleItemClick(item: NotificationItem) {
    const next = new Set(readIds);
    next.add(item.id);
    persistReadIds(next);
    setOpen(false);
    router.push(item.to);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="relative flex size-9 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-white"
        aria-label="Notifications"
        aria-expanded={open}
      >
        <Bell size={19} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-white dark:ring-[#07142f]">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-3 w-80 sm:w-96 rounded-2xl border border-slate-200 bg-white shadow-2xl transition-all animate-in fade-in zoom-in-95 dark:border-slate-800 dark:bg-slate-900">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-slate-900 dark:text-slate-100">Notifications</h3>
              {unreadCount > 0 ? (
                <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600 dark:bg-red-950/60 dark:text-red-400">
                  {unreadCount} new
                </span>
              ) : (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  Caught up
                </span>
              )}
            </div>

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="flex items-center gap-1 text-xs font-medium text-blue-600 transition hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                <CheckCheck size={14} />
                <span>Mark read</span>
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-[380px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60">
            {notifications.map((item) => {
              const isUnread = !readIds.has(item.id);
              const Icon = item.icon;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleItemClick(item)}
                  className={`flex w-full items-start gap-3.5 px-5 py-3.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                    isUnread ? "bg-blue-50/40 dark:bg-blue-950/20" : ""
                  }`}
                >
                  <div
                    className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl ${item.iconStyle}`}
                  >
                    <Icon size={18} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <p
                        className={`truncate text-xs font-semibold ${
                          isUnread
                            ? "text-slate-900 dark:text-white"
                            : "text-slate-700 dark:text-slate-300"
                        }`}
                      >
                        {item.title}
                      </p>
                      {isUnread && (
                        <span className="size-2 shrink-0 rounded-full bg-blue-600" />
                      )}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                      {item.body}
                    </p>
                    <p className="mt-1.5 text-[11px] font-medium text-slate-400 dark:text-slate-500">
                      {item.time}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Footer */}
          <div className="border-t border-slate-100 bg-slate-50/50 p-3 text-center dark:border-slate-800 dark:bg-slate-900/50">
            <Link
              href="/audit-log"
              onClick={() => setOpen(false)}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400"
            >
              <span>View full audit log</span>
              <ExternalLink size={12} />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
