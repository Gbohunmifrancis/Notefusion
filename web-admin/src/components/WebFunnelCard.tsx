"use client";

import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Clock3, Eye, MousePointer2, RefreshCw, Sparkles, UsersRound } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { WebFunnel } from "@/api/types";
import { Card } from "@/components/Card";
import { useChartPalette } from "@/lib/chart";
import { formatCount, formatPercent } from "@/lib/format";

interface WebFunnelCardProps {
  data?: WebFunnel | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

interface FunnelStep {
  label: string;
  value: number;
  color: string;
  icon: typeof Eye;
}

const eventLabels: Record<string, string> = {
  landing_view: "Landing views",
  upload_started: "Uploads started",
  job_created: "Jobs created",
  preview_ready: "Preview ready",
  mobile_opened: "Opened in mobile",
  upgrade_viewed: "Upgrade viewed",
  checkout_started: "Checkout started",
  subscription_started: "Subscriptions",
  quota_hit: "Quota reached",
};

function eventCount(data: WebFunnel, name: string): number {
  return data.events.find((event) => event.event === name)?.count ?? 0;
}

function conversion(value: number, base: number): string {
  if (base <= 0) return "—";
  return formatPercent(value / base);
}

function Kpi({ label, value, detail, icon: Icon, tone }: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Eye;
  tone: string;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/30 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-md ${tone}`}>
          <Icon size={15} aria-hidden="true" />
        </span>
        <span className="text-[11px] font-medium text-muted-foreground">{detail}</span>
      </div>
      <p className="mt-3 text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xl font-bold tracking-tight text-foreground">{value}</p>
    </div>
  );
}

function FunnelTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: FunnelStep }> }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="rounded-sm border border-border bg-popover px-3 py-2 shadow-lift">
      <p className="text-[11px] font-semibold text-foreground">{point.label}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{formatCount(point.value)} visitors</p>
    </div>
  );
}

function EventTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { label: string; count: number } }> }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="rounded-sm border border-border bg-popover px-3 py-2 shadow-lift">
      <p className="text-[11px] font-semibold text-foreground">{point.label}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{formatCount(point.count)} events</p>
    </div>
  );
}

export function WebFunnelCard({ data, isLoading, isError, onRetry }: WebFunnelCardProps) {
  const chart = useChartPalette();

  if (isLoading && !data) {
    return (
      <Card title="Web preview funnel" hint="Anonymous web-to-mobile conversion">
        <div className="space-y-4 animate-pulse">
          <div className="grid gap-3 sm:grid-cols-4">
            {[1, 2, 3, 4].map((item) => <div key={item} className="h-24 rounded-lg bg-muted" />)}
          </div>
          <div className="h-56 rounded-lg bg-muted" />
        </div>
      </Card>
    );
  }

  if (isError && !data) {
    return (
      <Card title="Web preview funnel" hint="Anonymous web-to-mobile conversion">
        <div className="flex min-h-56 flex-col items-center justify-center text-center">
          <AlertTriangle size={22} className="text-warning" aria-hidden="true" />
          <p className="mt-3 text-sm font-semibold text-foreground">Funnel data is unavailable</p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">The dashboard could not load the preview telemetry for this range.</p>
          <button type="button" onClick={onRetry} className="mt-4 inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-muted">
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      </Card>
    );
  }

  if (!data || data.previewJobs === 0) {
    return (
      <Card title="Web preview funnel" hint="Anonymous web-to-mobile conversion">
        <div className="flex min-h-56 flex-col items-center justify-center text-center">
          <Sparkles size={22} className="text-brand" aria-hidden="true" />
          <p className="mt-3 text-sm font-semibold text-foreground">No preview activity yet</p>
          <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">Once visitors try the free web transcription, this card will show where they convert or drop off.</p>
        </div>
      </Card>
    );
  }

  const landingViews = eventCount(data, "landing_view");
  const uploadStarts = eventCount(data, "upload_started");
  const previewReady = eventCount(data, "preview_ready") || data.completedPreviews;
  const mobileOpened = eventCount(data, "mobile_opened");
  const subscriptions = eventCount(data, "subscription_started");
  const funnel: FunnelStep[] = [
    { label: "Landing views", value: landingViews || data.previewJobs, color: chart.series, icon: Eye },
    { label: "Upload started", value: uploadStarts || data.previewJobs, color: chart.sky, icon: MousePointer2 },
    { label: "Preview ready", value: previewReady, color: chart.success, icon: CheckCircle2 },
    { label: "Opened in mobile", value: mobileOpened, color: "#8b5cf6", icon: UsersRound },
  ];
  const eventData = data.events
    .filter((event) => event.count > 0)
    .map((event) => ({ label: eventLabels[event.event] ?? event.event.replaceAll("_", " "), count: event.count }))
    .slice(0, 8);
  const readyRate = conversion(previewReady, uploadStarts || data.previewJobs);
  const mobileRate = conversion(mobileOpened, previewReady);
  const subscriptionRate = conversion(subscriptions, mobileOpened || previewReady);

  return (
    <Card
      title="Web preview funnel"
      hint="Anonymous web-to-mobile conversion"
      info="Tracks the free web transcription proof loop. Counts are aggregated from bounded product events; no audio, tokens, or anonymous identifiers are shown here."
      action={isError ? <button type="button" onClick={onRetry} className="inline-flex items-center gap-1.5 text-xs font-medium text-warning hover:text-warning-deep"><RefreshCw size={13} /> Refresh</button> : <span className="text-xs text-muted-foreground">{formatCount(data.previewJobs)} preview jobs</span>}
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-4">
          <Kpi label="Preview jobs" value={formatCount(data.previewJobs)} detail="submitted" icon={Activity} tone="bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300" />
          <Kpi label="Ready rate" value={readyRate} detail={`${formatCount(data.completedPreviews)} ready`} icon={CheckCircle2} tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" />
          <Kpi label="Mobile handoff" value={mobileRate} detail={`${formatCount(mobileOpened)} opens`} icon={ArrowUpRight} tone="bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300" />
          <Kpi label="Subscriptions" value={subscriptionRate} detail={`${formatCount(subscriptions)} started`} icon={Sparkles} tone="bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" />
        </div>

        <div className="grid gap-5 xl:grid-cols-[1.25fr_1fr]">
          <div className="min-w-0">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold text-foreground">Conversion path</h3>
                <p className="mt-0.5 text-[11px] text-muted-foreground">Each step compared with the previous step</p>
              </div>
              <span className="text-[11px] text-muted-foreground">{formatCount(data.failedPreviews)} failed · {formatCount(data.expiredPreviews)} expired</span>
            </div>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnel} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 6 }}>
                  <CartesianGrid horizontal={false} stroke={chart.grid} />
                  <XAxis type="number" allowDecimals={false} tick={{ fill: chart.tick, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="label" width={92} tick={{ fill: chart.tick, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: chart.grid, opacity: 0.45 }} content={<FunnelTooltip />} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={22} isAnimationActive={false}>
                    {funnel.map((step) => <Cell key={step.label} fill={step.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="min-w-0">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold text-foreground">Event volume</h3>
                <p className="mt-0.5 text-[11px] text-muted-foreground">Tracked actions in this period</p>
              </div>
              <Clock3 size={14} className="text-muted-foreground" aria-hidden="true" />
            </div>
            <div className="h-56 w-full">
              {eventData.length === 0 ? (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No product events recorded yet</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={eventData} margin={{ top: 4, right: 6, bottom: 24, left: -18 }}>
                    <CartesianGrid vertical={false} stroke={chart.grid} />
                    <XAxis dataKey="label" angle={-28} textAnchor="end" interval={0} height={52} tick={{ fill: chart.tick, fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fill: chart.tick, fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: chart.grid, opacity: 0.45 }} content={<EventTooltip />} />
                    <Bar dataKey="count" fill={chart.sky} radius={[4, 4, 0, 0]} barSize={24} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Preview ready {readyRate}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-violet-500" /> Mobile handoff {mobileRate}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" /> Paid conversion {subscriptionRate}</span>
          {data.failedPreviews > 0 && <span className="inline-flex items-center gap-1.5 text-warning"><ArrowDownRight size={13} /> {formatCount(data.failedPreviews)} failures need review</span>}
        </div>
      </div>
    </Card>
  );
}
