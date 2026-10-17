"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Star } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { getFeedbackList, getFeedbackSummary } from "@/api/endpoints";
import type { CategoryCount, FeedbackKind, FeedbackRow } from "@/api/types";
import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { OutreachCard } from "@/components/OutreachCard";
import { PageHeader } from "@/components/PageHeader";
import { Pager } from "@/components/Pager";
import { Segmented } from "@/components/Segmented";
import { StateView } from "@/components/StateView";
import { formatInstantDateTime } from "@/lib/format";
import { getReportingOffset } from "@/lib/reporting";
import { useClampPage } from "@/lib/useClampPage";

/** The labels the apps show, for the codes they send. */
const SOURCES: Record<string, string> = {
  friend: "Friend or family",
  church: "Church or choir",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  facebook: "Facebook",
  x: "X (Twitter)",
  google: "Google search",
  play_store: "Play Store",
  other: "Other",
};
const CATEGORIES: Record<string, string> = {
  bug: "Something's broken",
  idea: "Idea",
  accuracy: "Transcription accuracy",
  payments: "Payments",
  other: "Other",
};

/** What was off, for a transcription that was close or off. */
const ISSUES: Record<string, string> = {
  notes: "Wrong notes",
  key: "Wrong doh (key)",
  rhythm: "Rhythm or timing",
  missing: "Notes missing",
  other: "Something else",
};
const VERDICTS: Record<number, { label: string; tone: "success" | "warning" | "danger" }> = {
  5: { label: "Spot on", tone: "success" },
  3: { label: "Close", tone: "warning" },
  1: { label: "Off", tone: "danger" },
};

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((s) => (
        <Star key={s} className={`size-3.5 ${s <= value ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"}`} aria-hidden="true" />
      ))}
    </span>
  );
}

function Bars({ title, rows, labels, total }: { title: string; rows: CategoryCount[]; labels?: Record<string, string>; total: number }) {
  const top = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Card title={title} hint={`${total} ${total === 1 ? "answer" : "answers"}`}>
      {total === 0 ? (
        <p className="text-[13px] text-muted-foreground">Nothing yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.label} className="text-xs">
              <div className="flex justify-between gap-2">
                <span className="text-foreground">{labels?.[r.label] ?? r.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {r.count} · {Math.round((r.count / Math.max(1, total)) * 100)}%
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-muted">
                <div className="h-1.5 rounded-full bg-brand" style={{ width: `${(r.count / top) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function What({ row }: { row: FeedbackRow }) {
  switch (row.kind) {
    case "rating":
      return (
        <div>
          <Stars value={row.rating ?? 0} />
          {row.message && <p className="mt-1 text-[13px] text-foreground [overflow-wrap:anywhere]">{row.message}</p>}
        </div>
      );
    case "transcription": {
      const v = VERDICTS[row.rating ?? 0] ?? { label: "Close", tone: "warning" as const };
      return (
        <div>
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <Badge tone={v.tone}>{v.label}</Badge>
            {row.category && <span className="text-[13px] text-foreground">{ISSUES[row.category] ?? row.category}</span>}
            {row.jobId && <span className="font-mono text-[11px] text-muted-foreground">{row.jobId}</span>}
          </span>
          {row.message && <p className="mt-1 text-[13px] text-foreground [overflow-wrap:anywhere]">{row.message}</p>}
        </div>
      );
    }
    case "rating_dismissed":
      return <span className="text-muted-foreground">Chose &ldquo;Not now&rdquo; on the rating prompt</span>;
    case "heard_about":
      return (
        <div>
          <span className="font-medium text-foreground">{SOURCES[row.category ?? "other"] ?? row.category}</span>
          {row.message && <span className="text-muted-foreground"> · {row.message}</span>}
        </div>
      );
    default:
      return (
        <div>
          <Badge>{CATEGORIES[row.category ?? "other"] ?? row.category ?? "Other"}</Badge>
          <p className="mt-1 whitespace-pre-wrap text-[13px] text-foreground [overflow-wrap:anywhere]">{row.message}</p>
        </div>
      );
  }
}

type Filter = "all" | FeedbackKind;
const FILTERS = [
  { value: "all", label: "Everything" },
  { value: "feedback", label: "Feedback" },
  { value: "rating", label: "Ratings" },
  { value: "transcription", label: "Transcriptions" },
  { value: "heard_about", label: "Heard about us" },
] as const satisfies readonly { value: Filter; label: string }[];

/** What users told us: ratings from the app, verdicts on single transcriptions, where they heard about us, and feedback messages. */
export function FeedbackView() {
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [filter]);
  const offset = getReportingOffset();

  const summary = useQuery({ queryKey: ["feedback-summary"], queryFn: ({ signal }) => getFeedbackSummary(signal) });
  const list = useQuery({
    queryKey: ["feedback-list", page, filter],
    queryFn: ({ signal }) => getFeedbackList(page, 25, filter === "all" ? undefined : filter, undefined, signal),
    placeholderData: keepPreviousData,
  });
  useClampPage(page, list.data?.totalPages, setPage);

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader title="Feedback" breadcrumb={["Dashboard", "Feedback"]} />

      <StateView state={summary} loadingLabel="Loading feedback summary">
        {(s) => (
          <div className="grid gap-5 lg:grid-cols-3">
            <Card title="App rating" hint={`${s.ratings} ratings · ${s.dismissals} chose "Not now"`}>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold tabular-nums text-foreground">{s.averageRating?.toFixed(1) ?? "—"}</span>
                <span className="text-sm text-muted-foreground">out of 5</span>
              </div>
              {s.averageRating != null && <Stars value={Math.round(s.averageRating)} />}
              <ul className="mt-4 space-y-1.5">
                {s.ratingDistribution.map((r) => (
                  <li key={r.label} className="grid grid-cols-[2rem_1fr_2rem] items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-0.5 text-muted-foreground">{r.label}<Star size={14} aria-hidden="true" className="text-faint" /><span className="sr-only"> stars</span></span>
                    <span className="h-2 rounded-full bg-muted">
                      <span
                        className="block h-2 rounded-full bg-amber-400"
                        style={{ width: `${(r.count / Math.max(1, s.ratings)) * 100}%` }}
                      />
                    </span>
                    <span className="text-right tabular-nums text-foreground">{r.count}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Bars title="Where they heard about us" rows={s.heardAbout} labels={SOURCES} total={s.heardAboutAnswers} />
            <Bars title="Feedback by topic" rows={s.feedbackByCategory} labels={CATEGORIES} total={s.feedbackMessages} />
            <Bars
              title="How transcriptions came out"
              rows={s.transcriptionDistribution ?? []}
              total={s.transcriptionVerdicts ?? 0}
              labels={{ "spot on": "Spot on", close: "Close", off: "Off" }}
            />
            <Bars
              title="What was off"
              rows={s.transcriptionIssues ?? []}
              labels={ISSUES}
              total={(s.transcriptionIssues ?? []).reduce((n, r) => n + r.count, 0)}
            />
          </div>
        )}
      </StateView>

      <Card
        title="Everything users told us"
        hint="Newest first"
        action={<Segmented label="Show" options={FILTERS} value={filter} onChange={setFilter} />}
        bleed
      >
        <StateView state={list} isEmpty={(d) => d.items.length === 0} emptyMessage="Nothing here yet" loadingLabel="Loading feedback">
          {(d) => (
            <div className="border-t border-border">
              <ul className="divide-y divide-border">
                {d.items.map((row) => (
                  <li key={row.id} className="grid gap-2 px-5 py-3 sm:grid-cols-[12rem_1fr]">
                    <div className="text-xs">
                      <Link href={`/users/${row.userId}`} className="font-semibold text-foreground hover:text-brand">
                        {row.userName || row.userEmail}
                      </Link>
                      <div className="text-muted-foreground">{formatInstantDateTime(row.createdAtUtc, offset)}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {row.client === "web" ? "Web" : "Mobile app"}
                        {row.appVersion && ` ${row.appVersion}`}
                        {row.screen && ` · ${row.screen}`}
                      </div>
                    </div>
                    <What row={row} />
                  </li>
                ))}
              </ul>
              <Pager
                page={d.page}
                pageSize={d.pageSize}
                totalCount={d.totalCount}
                totalPages={d.totalPages}
                busy={list.isFetching}
                onPage={setPage}
              />
            </div>
          )}
        </StateView>
      </Card>

      <OutreachCard />
    </div>
  );
}
