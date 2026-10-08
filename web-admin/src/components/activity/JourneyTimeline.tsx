import { CreditCard, Eye, MousePointerClick, Music2, UserPlus, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { JourneyItem, JourneyItemType } from "@/api/types";
import { formatInstantDateTime } from "@/lib/format";

const ICONS: Record<JourneyItemType, LucideIcon> = {
  pageview: Eye,
  click: MousePointerClick,
  action: Zap,
  transcription: Music2,
  payment: CreditCard,
  signup: UserPlus,
};

const TONE: Record<JourneyItem["tone"], string> = {
  ok: "bg-muted text-muted-foreground",
  warn: "bg-warning/15 text-warning-deep",
  error: "bg-danger/15 text-danger-deep",
};

/** Two things more than this far apart belong to different visits. */
const VISIT_GAP_MS = 30 * 60 * 1000;

function visits(items: JourneyItem[]): JourneyItem[][] {
  const groups: JourneyItem[][] = [];
  let last = Number.NaN;
  for (const item of items) {
    const at = Date.parse(item.atUtc);
    if (groups.length === 0 || last - at > VISIT_GAP_MS) groups.push([]);
    groups[groups.length - 1]!.push(item);
    last = at;
  }
  return groups;
}

function clock(iso: string, offset: number): string {
  return formatInstantDateTime(iso, offset).split(", ")[1] ?? "";
}

/**
 * A journey, newest first, grouped into visits: pages, clicks, app actions, every transcription
 * (saved or not) and payment attempts. Failures are coloured so a broken checkout stands out.
 */
export function JourneyTimeline({
  items,
  offset,
  limit,
}: {
  items: JourneyItem[];
  offset: number;
  /** Show only the newest this many; the full journey page shows everything. */
  limit?: number;
}) {
  const shown = limit ? items.slice(0, limit) : items;
  if (shown.length === 0) {
    return <p className="px-5 pb-5 text-[13px] text-muted-foreground">Nothing recorded in this window.</p>;
  }

  return (
    <div className="space-y-5 px-5 pb-5">
      {visits(shown).map((visit) => {
        const newest = visit[0]!;
        const oldest = visit[visit.length - 1]!;
        const device = visit.find((i) => i.device)?.device;
        return (
          <section key={`${oldest.atUtc}-${newest.atUtc}`} className="rounded-lg border border-border">
            <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2 text-xs">
              <span className="font-semibold text-foreground">
                {formatInstantDateTime(oldest.atUtc, offset)}
                {oldest !== newest && ` – ${clock(newest.atUtc, offset)}`}
              </span>
              <span className="text-muted-foreground">
                {visit.length} {visit.length === 1 ? "event" : "events"}
                {device && ` · ${device}`}
              </span>
            </header>
            <ol className="divide-y divide-border">
              {visit.map((item, index) => {
                const Icon = ICONS[item.type] ?? Zap;
                return (
                  <li key={`${item.atUtc}-${index}`} className="flex items-start gap-3 px-4 py-2.5">
                    <span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${TONE[item.tone]}`}>
                      <Icon className="size-3.5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-foreground [overflow-wrap:anywhere]">{item.title}</div>
                      {item.detail && (
                        <div
                          className={`text-xs [overflow-wrap:anywhere] ${item.tone === "error" ? "text-danger-deep" : "text-muted-foreground"}`}
                        >
                          {item.detail}
                        </div>
                      )}
                      {item.path && item.type !== "pageview" && (
                        <div className="text-[11px] text-muted-foreground">on {item.path}</div>
                      )}
                    </div>
                    <time className="shrink-0 pt-0.5 text-[11px] tabular-nums text-muted-foreground" dateTime={item.atUtc}>
                      {clock(item.atUtc, offset)}
                    </time>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
