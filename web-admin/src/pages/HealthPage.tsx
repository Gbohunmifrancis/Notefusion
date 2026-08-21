import { Database, HeartPulse, RefreshCw, Server, Webhook, type LucideIcon } from "lucide-react";
import { useCallback } from "react";

import { getHealth } from "@/api/endpoints";
import type { HealthPanel, HealthStatus, SystemHealth } from "@/api/types";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { StateView } from "@/components/StateView";
import { formatCount, formatInstantDateTime } from "@/lib/format";
import { getReportingOffset } from "@/lib/reporting";
import { useAsync } from "@/lib/useAsync";

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
    <p className="text-[13px] leading-relaxed text-muted">
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
          <p className="truncate text-[13px] font-semibold text-ink">{panel.name}</p>
        </div>
        <span className={`flex shrink-0 items-center gap-1.5 text-xs font-semibold ${skin.text}`}>
          <span className={`h-2 w-2 rounded-full ${skin.dot}`} aria-hidden="true" />
          {STATUS_LABELS[panel.status]}
        </span>
      </div>

      <div className="mt-3 space-y-2">
        {panel.latencyMs !== null && (
          <p className="text-[22px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-ink">
            {formatCount(panel.latencyMs)}
            <span className="ml-1.5 text-[12px] font-medium text-muted">ms round trip</span>
          </p>
        )}
        <p className="text-[12px] leading-relaxed text-muted">
          {/* Null means there is nothing to report, which is not the same as reporting "OK". */}
          {panel.detail ?? "Nothing to report."}
        </p>
      </div>
    </Card>
  );
}

export function HealthPage() {
  const fetcher = useCallback((signal: AbortSignal) => getHealth(signal), []);
  const state = useAsync<SystemHealth>(fetcher);
  const offset = getReportingOffset();

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="System health"
        breadcrumb={["Dashboard", "Operations", "System health"]}
        actions={
          <button
            type="button"
            onClick={state.reload}
            disabled={state.loading}
            className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-border px-3.5 text-[13px] font-semibold text-ink transition hover:bg-surface-alt disabled:opacity-45"
          >
            <RefreshCw
              size={14}
              className={state.loading ? "animate-spin" : undefined}
              aria-hidden="true"
            />
            Re-check
          </button>
        }
      />

      <StateView state={state} loadingLabel="Probing every tier">
        {(health) => (
          <div className="space-y-5">
            {/* Every probe runs on request, so the timestamp is the whole shelf life of this page. */}
            <div
              className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-md border px-4 py-3 ${
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
              <p className="text-xs text-muted">
                Checked {formatInstantDateTime(health.checkedAtUtc, offset)}
              </p>
            </div>

            <div className="grid gap-5 lg:grid-cols-3">
              <TierPanel panel={health.database} icon={Database} />
              <TierPanel panel={health.transcriptionWorker} icon={Server} />
              <TierPanel panel={health.webhookBacklog} icon={Webhook} />
            </div>

            <Card
              title="Transcription jobs"
              {...(wasCounted(health)
                ? {
                    hint: "Submissions accepted by the API. The worker owns the outcome and the API never stores it, so this is volume, not a success rate.",
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
              title="Subscriptions"
              {...(wasCounted(health)
                ? {
                    hint: "A snapshot as of the check above, not a windowed count — a subscription belongs to an instant.",
                  }
                : {})}
            >
              {wasCounted(health) ? (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <StatCard
                    label="Active"
                    value={formatCount(health.subscriptions.activeCount)}
                    sub="Pro unlocked right now"
                    tone="success"
                  />
                  <StatCard
                    label="Gifted"
                    value={formatCount(health.subscriptions.giftedCount)}
                    sub="Granted, never charged"
                    hint="Counted inside Active, not beside it — a gift is one of the ways access is live."
                    tone="warning"
                  />
                  <StatCard
                    label="Expiring in 7 days"
                    value={formatCount(health.subscriptions.expiringWithinSevenDays)}
                    sub="Lifetime access excluded"
                    tone="blue"
                  />
                  <StatCard
                    label="Past due"
                    value={formatCount(health.subscriptions.pastDueCount)}
                    sub="A renewal the gateway did not settle"
                    tone="danger"
                  />
                </div>
              ) : (
                <NotCounted />
              )}
            </Card>

            {health.notMonitored.length > 0 && (
              <Card
                title="Not monitored"
                hint="Prose rather than empty panels: a tile reading “—” forever looks like a broken metric instead of an absent tier."
              >
                <ul className="space-y-2 text-[13px] leading-relaxed text-muted">
                  {health.notMonitored.map((line) => (
                    <li key={line} className="flex gap-2">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-faint" aria-hidden="true" />
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
