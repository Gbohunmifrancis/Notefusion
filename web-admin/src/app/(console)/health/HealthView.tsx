"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Database,
  DatabaseBackup,
  HeartPulse,
  Layers,
  RefreshCw,
  Server,
  Webhook,
  type LucideIcon,
} from "lucide-react";

import { getAuditLog, getHealth, getWebhooks } from "@/api/endpoints";
import type {
  BackupHealthStatus,
  BackupRun,
  BackupStatus,
  EmailWindowUsage,
  HealthPanel,
  HealthStatus,
  SystemHealth,
} from "@/api/types";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { StateView } from "@/components/StateView";
import { Button } from "@/components/ui/button";
import { formatBytes, formatCount, formatInstantDateTime, formatRelative } from "@/lib/format";
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

const BACKUP_SKINS: Record<BackupHealthStatus, { dot: string; text: string }> = {
  ...STATUS_SKINS,
  off: { dot: "bg-faint", text: "text-muted-foreground" },
};

const BACKUP_LABELS: Record<BackupHealthStatus, string> = {
  ...STATUS_LABELS,
  off: "Not set up",
};

/** "Sunday" within the last week (how a weekly drill is talked about), else "3w ago". */
function dayOrRelative(iso: string, nowMs: number): string {
  const age = nowMs - new Date(iso).getTime();
  if (age >= 0 && age < 7 * 24 * 3600 * 1000) {
    return new Date(iso).toLocaleDateString("en-GB", { weekday: "long" });
  }
  return formatRelative(iso, nowMs);
}

/** "3h ago" for a run that worked, "Failed 3h ago" for one that did not, "Never" for none. */
function runLine(run: BackupRun | null, nowMs: number): string {
  if (!run) return "Never";
  const when = formatRelative(run.finishedAtUtc, nowMs);
  return run.ok ? when : `Failed ${when}`;
}

/**
 * The backups (docs/BACKUP_AND_MIGRATION.md): what the backup container last recorded for each job.
 * Outside the page's rollup — a late backup does not stop the product — but with its own status, and
 * the problems listed here are the ones the backup alert pushes and emails.
 */
function BackupsCard({ backups, nowMs }: { backups: BackupStatus; nowMs: number }) {
  const skin = BACKUP_SKINS[backups.status];
  const dump = backups.lastVerifiedDump;
  const dumpSize = dump?.sizeBytes == null ? "size unknown" : formatBytes(dump.sizeBytes);
  const rows: { label: string; value: string; bad: boolean }[] = [
    {
      label: "Last database backup",
      value: dump ? `${formatRelative(dump.finishedAtUtc, nowMs)} · ${dumpSize} · verified` : "None verified yet",
      bad: !dump,
    },
    {
      label: "WAL archived",
      value: backups.walArchivedAtUtc ? formatRelative(backups.walArchivedAtUtc, nowMs) : "Not yet",
      bad: !backups.lastWalReport?.ok,
    },
    { label: "Base backup", value: runLine(backups.lastBaseBackup, nowMs), bad: backups.lastBaseBackup?.ok === false },
    { label: "Photos and keys", value: runLine(backups.lastFiles, nowMs), bad: backups.lastFiles?.ok === false },
    { label: "Repository check", value: runLine(backups.lastCheck, nowMs), bad: backups.lastCheck?.ok === false },
  ];
  if (backups.lastMirror) {
    rows.push({ label: "Second copy", value: runLine(backups.lastMirror, nowMs), bad: !backups.lastMirror.ok });
  }
  const drill = backups.lastDrill;
  rows.push({
    label: "Last restore drill",
    value: drill
      ? `${drill.ok ? "Passed" : "FAILED"} ${dayOrRelative(drill.finishedAtUtc, nowMs)}`
      : "Not run yet (weekly, GitHub Actions)",
    bad: drill ? !drill.ok : false,
  });

  return (
    <Card
      title="Backups"
      hint="Encrypted copies kept off this server, as the backup service last recorded them."
      action={
        <span className={`flex items-center gap-1.5 text-xs font-semibold ${skin.text}`}>
          <span className={`h-2 w-2 rounded-full ${skin.dot}`} aria-hidden="true" />
          {BACKUP_LABELS[backups.status]}
        </span>
      }
    >
      <div className="space-y-4">
        <p className="flex items-start gap-2 text-[13px] font-medium text-foreground">
          <DatabaseBackup size={16} className="mt-0.5 shrink-0 text-faint" aria-hidden="true" />
          <span className="min-w-0 break-words">{backups.summary}</span>
        </p>

        {backups.status !== "off" && (
          <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
            {rows.map((row) => (
              <div key={row.label} className="flex min-w-0 items-baseline justify-between gap-3">
                <dt className="shrink-0 text-xs text-muted-foreground">{row.label}</dt>
                <dd
                  className={`min-w-0 truncate text-right text-xs font-semibold tabular-nums ${
                    row.bad ? "text-danger-deep" : "text-foreground"
                  }`}
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {backups.problems.length > 0 && (
          <ul className="space-y-1.5 rounded-[8px] border border-warning/30 bg-warning/10 px-3.5 py-3 text-[12px] leading-relaxed text-warning-deep">
            {backups.problems.map((problem) => (
              <li key={problem} className="flex gap-2">
                <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 break-words">{problem}</span>
              </li>
            ))}
          </ul>
        )}

        {backups.drillUrl && (
          <a
            href={backups.drillUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#2563EB] hover:text-[#1D4ED8] dark:text-blue-400"
          >
            Restore drill run in GitHub
            <ArrowRight size={14} aria-hidden="true" />
          </a>
        )}
      </div>
    </Card>
  );
}

const EMAIL_WINDOW_LABELS: Record<EmailWindowUsage["window"], string> = {
  day: "Last 24 hours",
  week: "Last 7 days",
  month: "Last 31 days",
};

/** Mail sent against the email plan's caps (`EmailBudget`), one tile per capped window. */
function EmailQuotaCard({ windows }: { windows: EmailWindowUsage[] }) {
  return (
    <Card
      title="Email quota"
      hint="Mail the provider accepted, against the plan's caps. Optional mail (welcome, tips, reminders, outreach) waits once a window reaches its optional line; codes, resets, receipts and security notices always send."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {windows.map((w) => {
          const held = w.sent >= w.optionalCeiling;
          return (
            <StatCard
              key={w.window}
              label={EMAIL_WINDOW_LABELS[w.window] ?? w.window}
              value={`${formatCount(w.sent)} / ${formatCount(w.limit)}`}
              sub={
                held
                  ? `Optional mail waiting (line at ${formatCount(w.optionalCeiling)})`
                  : `Optional mail until ${formatCount(w.optionalCeiling)}`
              }
              tone={w.sent >= w.limit ? "danger" : held ? "warning" : "success"}
              share={w.limit > 0 ? w.sent / w.limit : null}
            />
          );
        })}
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

interface WebhookRowItem {
  id: string;
  event: string;
  status: string;
  isSuccess: boolean;
  time: string;
}

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
  const health = healthState.data;

  // Format real timeline events from audit query
  const timelineEvents: TimelineEvent[] = useMemo(() => {
    const raw = auditQuery.data?.items ?? [];
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

  // Format real webhook rows from webhooks query
  const webhookRows: WebhookRowItem[] = useMemo(() => {
    const raw = webhooksQuery.data?.items ?? [];
    return raw.slice(0, 5).map((wh) => ({
      id: wh.id,
      event: wh.eventType || "webhook.event",
      status: wh.status === "Processed" ? "200 OK" : wh.status === "Failed" ? "500 Error" : wh.status,
      isSuccess: wh.status === "Processed",
      time: formatRelative(wh.receivedAtUtc, nowMs),
    }));
  }, [webhooksQuery.data?.items, nowMs]);

  const totalWebhookDeliveries = webhooksQuery.data?.totalCount ?? 0;
  const processedWebhookCount = useMemo(() => {
    if (!webhooksQuery.data?.items) return 0;
    return webhooksQuery.data.items.filter((i) => i.status === "Processed").length;
  }, [webhooksQuery.data]);
  const failedWebhookCount = useMemo(() => {
    if (!webhooksQuery.data?.items) return 0;
    return webhooksQuery.data.items.filter((i) => i.status === "Failed").length;
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
            className="h-9 px-3.5 text-[13px] font-semibold rounded-lg shadow-xs hover:bg-slate-50 dark:hover:bg-zinc-900 dark:border-zinc-800"
          >
            <RefreshCw
              size={16}
              className={healthState.isFetching ? "animate-spin mr-2" : "mr-2"}
              aria-hidden="true"
            />
            Re-check
          </Button>
        }
      />

      {/* 4 Top Metric KPI Cards (100% Server Scoped) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* API Status */}
        <div className="nf-panel p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">API status</span>
            <Activity size={16} aria-hidden="true" className="text-faint" />
          </div>
          <div className="mt-3 text-2xl font-semibold tracking-[-0.02em] tabular-nums text-foreground">
            {health ? (health.status === "healthy" ? "Operational" : health.status === "degraded" ? "Degraded" : "Offline") : "Probing..."}
          </div>
          <div className="mt-2 flex items-center text-xs">
            <span className={`inline-flex items-center gap-0.5 font-semibold px-1.5 py-0.5 rounded text-[11px] ${
              health?.status === "healthy"
                ? "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40"
                : "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40"
            }`}>
              {health?.status === "healthy" ? "Healthy" : "Check status"}
            </span>
            <span className="text-slate-400 dark:text-slate-500 ml-1.5 truncate">
              {health ? `Checked ${formatInstantDateTime(health.checkedAtUtc, offset)}` : "Polling tiers"}
            </span>
          </div>
        </div>

        {/* Database */}
        <div className="nf-panel p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Database</span>
            <Database size={16} aria-hidden="true" className="text-faint" />
          </div>
          <div className="mt-3 text-2xl font-semibold tracking-[-0.02em] tabular-nums text-foreground">
            {health ? (health.database.latencyMs !== null ? `${formatCount(health.database.latencyMs)} ms` : STATUS_LABELS[health.database.status]) : "..."}
          </div>
          <div className="mt-2 flex items-center text-xs">
            <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded text-[11px]">
              {health?.database.status === "healthy" ? "Operational" : "Check logs"}
            </span>
            <span className="text-slate-400 dark:text-slate-500 ml-1.5 truncate">
              {health?.database.latencyMs !== null ? "Round trip latency" : (health?.database.detail ?? "Probe answered")}
            </span>
          </div>
        </div>

        {/* Background Jobs */}
        <div className="nf-panel p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Background jobs</span>
            <Layers size={16} aria-hidden="true" className="text-faint" />
          </div>
          <div className="mt-3 text-2xl font-semibold tracking-[-0.02em] tabular-nums text-foreground">
            {health ? formatCount(health.activity.jobsLast24Hours) : "..."}
          </div>
          <div className="mt-2 flex items-center text-xs">
            <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded text-[11px]">
              Last 24h
            </span>
            <span className="text-slate-400 dark:text-slate-500 ml-1.5">
              {health ? `${formatCount(health.activity.jobsLast7Days)} in 7 days` : "Job executions"}
            </span>
          </div>
        </div>

        {/* Webhooks */}
        <div className="nf-panel p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Webhooks</span>
            <Webhook size={16} aria-hidden="true" className="text-faint" />
          </div>
          <div className="mt-3 text-2xl font-semibold tracking-[-0.02em] tabular-nums text-foreground">
            {health ? (health.webhookBacklog.status === "healthy" ? "Clear" : "Backlog") : "..."}
          </div>
          <div className="mt-2 flex items-center text-xs">
            <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded text-[11px]">
              {health?.webhookBacklog.status === "healthy" ? "Normal" : "Backlog"}
            </span>
            <span className="text-slate-400 dark:text-slate-500 ml-1.5">
              {formatCount(totalWebhookDeliveries)} total events
            </span>
          </div>
        </div>
      </div>

      {/* Middle 2-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: Recent Events Timeline (Server Scoped) */}
        <div className="nf-panel p-6 flex flex-col">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Recent events</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Timeline of operational and audit activity</p>
            </div>
            <Link
              href="/audit-log"
              className="text-xs font-semibold text-[#2563EB] hover:text-[#1D4ED8] dark:text-blue-400 flex items-center gap-1 group"
            >
              View all
              <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>

          <div className="relative pl-1 flex-1">
            {timelineEvents.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-400 dark:text-zinc-500">
                No audit log events recorded yet
              </div>
            ) : (
              timelineEvents.map((evt, idx) => {
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
                    {!isLast && (
                      <span
                        className="absolute left-[7px] top-[14px] bottom-0 w-0.5 bg-slate-200 dark:bg-zinc-800"
                        aria-hidden="true"
                      />
                    )}

                    <div className="relative flex items-center justify-center shrink-0 mt-1">
                      <span className={`w-3.5 h-3.5 rounded-full ring-4 ${dotColor}`} />
                    </div>

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
              })
            )}
          </div>
        </div>

        {/* Right Column: Webhook Delivery Overview (Server Scoped) */}
        <div className="nf-panel p-6 flex flex-col">
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
              <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>

          {/* Top 3 mini stats (Server Scoped) */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-zinc-950/60 border border-slate-200/60 dark:border-zinc-800">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">Total</span>
              <span className="text-base font-bold text-slate-900 dark:text-slate-100 block mt-1">
                {formatCount(totalWebhookDeliveries)}
              </span>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-zinc-950/60 border border-slate-200/60 dark:border-zinc-800">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">Processed</span>
              <div className="flex items-center gap-1 mt-1">
                <span className="text-base font-bold text-slate-900 dark:text-slate-100">{formatCount(processedWebhookCount)}</span>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              </div>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-zinc-950/60 border border-slate-200/60 dark:border-zinc-800">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">Failed</span>
              <div className="flex items-center gap-1 mt-1">
                <span className="text-base font-bold text-slate-900 dark:text-slate-100">{formatCount(failedWebhookCount)}</span>
                <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
              </div>
            </div>
          </div>

          {/* Webhook mini table (Server Scoped) */}
          <div className="overflow-x-auto flex-1">
            {webhookRows.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-400 dark:text-zinc-500">
                No webhook deliveries recorded yet
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-zinc-800 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <th className="pb-2.5">Event</th>
                    <th className="pb-2.5">Status</th>
                    <th className="pb-2.5 text-right">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-zinc-800 text-xs">
                  {webhookRows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/50 dark:hover:bg-zinc-900/40 transition-colors">
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
            )}
          </div>
        </div>
      </div>

      {/* Real-time Probed Tiers & Subscriptions Telemetry */}
      <StateView state={healthState} loadingLabel="Probing every tier">
        {(health) => (
          <div className="space-y-5 pt-2">
            <div
              className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-[8px] border px-4 py-3.5 ${
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

            {health.backups && <BackupsCard backups={health.backups} nowMs={nowMs} />}

            {health.emailUsage && health.emailUsage.length > 0 && (
              <EmailQuotaCard windows={health.emailUsage} />
            )}

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

            {health.workerHeartbeats && health.workerHeartbeats.length > 0 && (
              <Card
                title="Background Workers"
                hint="Heartbeats and execution durations tracked across asynchronous operations."
              >
                <div className="grid gap-4 sm:grid-cols-3">
                  {health.workerHeartbeats.map((w) => (
                    <div
                      key={w.workerName}
                      className="rounded-lg border border-slate-200/80 dark:border-zinc-800 p-4 bg-slate-50/50 dark:bg-zinc-950/40 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground truncate">
                          {w.workerName}
                        </span>
                        <span
                          className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                            w.status.toLowerCase() === "success" || w.status.toLowerCase() === "healthy"
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400 border border-emerald-200/60"
                              : "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400 border border-rose-200/60"
                          }`}
                        >
                          {w.status}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Last run: {formatRelative(w.lastRunUtc, nowMs)} · {w.durationMs}ms
                      </div>
                      {w.detail && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">
                          {w.detail}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            )}

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

