"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CreditCard, LogIn, Music2, Save, Search, UserRoundPlus, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { getActivityFeed, getCheckoutFunnel, getTranscriptionLog } from "@/api/endpoints";
import type { CategoryCount, FeedItem, FeedKind, TranscriptionLogFilters } from "@/api/types";
import { EngagementTab } from "@/components/activity/Engagement";
import { TranscriptionLogTable } from "@/components/activity/TranscriptionLogTable";
import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { Pager } from "@/components/Pager";
import { RangePicker } from "@/components/RangePicker";
import type { Range } from "@/components/RangePicker";
import { Segmented } from "@/components/Segmented";
import { StateView } from "@/components/StateView";
import { Input } from "@/components/ui/input";
import { addDays, formatBytes, formatInstantDateTime, formatRelative, reportingToday } from "@/lib/format";
import { getReportingOffset } from "@/lib/reporting";
import { useClampPage } from "@/lib/useClampPage";
import { useDebounced } from "@/lib/useDebounced";

const PAGE_SIZE = 20;
const SELECT =
  "h-9 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground shadow-xs outline-none";

type Tab = "feed" | "engagement" | "transcriptions" | "checkout";
const TABS: readonly Tab[] = ["feed", "engagement", "transcriptions", "checkout"];

export function ActivityView() {
  const requested = useSearchParams().get("tab");
  const [tab, setTabState] = useState<Tab>(TABS.includes(requested as Tab) ? (requested as Tab) : "feed");
  // Kept in the address so a link (the overview's "View all") and a reload land on the same tab.
  const setTab = (next: Tab) => {
    setTabState(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", next);
      window.history.replaceState(window.history.state, "", url.pathname + url.search);
    } catch {
      /* the tab still changes; only the address does not */
    }
  };
  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Activity"
        breadcrumb={["Dashboard", "Activity"]}
        actions={
          <Segmented
            label="Activity view"
            options={[
              { value: "feed", label: "Feed" },
              { value: "engagement", label: "Engagement" },
              { value: "transcriptions", label: "Transcriptions" },
              { value: "checkout", label: "Checkout" },
            ]}
            value={tab}
            onChange={setTab}
          />
        }
      />
      {tab === "feed" ? (
        <FeedTab />
      ) : tab === "engagement" ? (
        <EngagementTab />
      ) : tab === "transcriptions" ? (
        <TranscriptionsTab />
      ) : (
        <CheckoutTab />
      )}
    </div>
  );
}

/* ── The full user activity feed ─────────────────────────────────────────── */

const FEED_ICONS: Record<FeedKind, LucideIcon> = {
  signup: UserRoundPlus,
  login: LogIn,
  transcription: Music2,
  saved: Save,
  payment: CreditCard,
  action: Zap,
};

const FEED_TONE: Record<FeedItem["tone"], string> = {
  ok: "bg-muted text-muted-foreground",
  warn: "bg-warning/15 text-warning-deep",
  error: "bg-danger/15 text-danger-deep",
};

function FeedTab() {
  const [kind, setKind] = useState<FeedKind | "">("");
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [kind]);

  const state = useQuery({
    queryKey: ["activity-feed", page, kind],
    queryFn: ({ signal }) => getActivityFeed(page, 30, kind || undefined, signal),
    placeholderData: keepPreviousData,
  });
  useClampPage(page, state.data?.totalPages, setPage);
  const offset = getReportingOffset();
  const now = Date.now();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13px] text-muted-foreground">
          Everything users do, newest first: sign-ups, sign-ins, every transcription asked for (saved or not),
          saved sheets, payments, and the actions signed-in web users take. Sign-ins show each account&apos;s
          latest only.
        </p>
        <select aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value as FeedKind | "")} className={SELECT}>
          <option value="">Everything</option>
          <option value="signup">Sign-ups</option>
          <option value="login">Sign-ins</option>
          <option value="transcription">Transcriptions</option>
          <option value="saved">Saved sheets</option>
          <option value="payment">Payments</option>
          <option value="action">Web app actions</option>
        </select>
      </div>

      <Card bleed>
        <StateView
          state={state}
          isEmpty={(d) => d.items.length === 0}
          emptyMessage="No activity recorded yet"
          loadingLabel="Loading activity"
        >
          {(d) => (
            <>
              <ol className="divide-y divide-border">
                {d.items.map((item, index) => {
                  const Icon = FEED_ICONS[item.kind] ?? Zap;
                  return (
                    <li key={`${item.atUtc}-${item.kind}-${index}`} className="flex items-start gap-3 px-5 py-3">
                      <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg ${FEED_TONE[item.tone]}`}>
                        <Icon className="size-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold text-foreground [overflow-wrap:anywhere]">{item.title}</div>
                        <div className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                          {item.userId ? (
                            <Link href={`/users/${item.userId}`} className="font-medium text-foreground hover:text-brand">
                              {item.userName || item.userEmail || "Account"}
                            </Link>
                          ) : (
                            "Anonymous visitor"
                          )}
                          {item.country && ` · ${item.country}`}
                          {item.detail && (
                            <span className={item.tone === "error" ? "text-danger-deep" : undefined}> · {item.detail}</span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 text-right text-[11px] text-muted-foreground">
                        <div>{formatRelative(item.atUtc, now)}</div>
                        <div className="tabular-nums">{formatInstantDateTime(item.atUtc, offset)}</div>
                        {item.userId && (
                          <Link href={`/activity/journey?userId=${item.userId}`} className="text-brand hover:underline">
                            Journey
                          </Link>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
              <Pager
                page={d.page}
                pageSize={d.pageSize}
                totalCount={d.totalCount}
                totalPages={d.totalPages}
                busy={state.isFetching}
                onPage={setPage}
              />
            </>
          )}
        </StateView>
      </Card>
    </div>
  );
}

/* ── Every transcription, saved or not ───────────────────────────────────── */

function TranscriptionsTab() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [origin, setOrigin] = useState("");
  const [client, setClient] = useState("");
  const [saved, setSaved] = useState("");
  const [page, setPage] = useState(1);
  const term = useDebounced(search).trim();

  useEffect(() => setPage(1), [term, status, kind, origin, client, saved]);

  const filters: TranscriptionLogFilters = {
    search: term || undefined,
    status: status || undefined,
    kind: kind || undefined,
    origin: origin || undefined,
    client: client || undefined,
    saved: saved === "" ? undefined : saved === "yes",
  };
  const state = useQuery({
    queryKey: ["activity-log", page, filters],
    queryFn: ({ signal }) => getTranscriptionLog(page, PAGE_SIZE, filters, signal),
    placeholderData: keepPreviousData,
  });
  useClampPage(page, state.data?.page.totalPages, setPage);
  const offset = getReportingOffset();
  const s = state.data?.summary;

  return (
    <div className="space-y-5">
      <p className="text-[13px] text-muted-foreground">
        Every transcription anyone asked for, from the website and the app, whether or not it was saved:
        the file&apos;s name, type and size or the song link, the settings it was sent with, and how it ended.
        The audio itself is never kept. Rows are deleted after 180 days.
      </p>

      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative w-full max-w-xs">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="File name, song, link, email, error…"
            className="h-9 pl-9 text-xs"
          />
        </div>
        <select aria-label="Outcome" value={status} onChange={(e) => setStatus(e.target.value)} className={SELECT}>
          <option value="">Any outcome</option>
          <option value="done">Done</option>
          <option value="failed">Failed</option>
          <option value="refused">Refused</option>
          <option value="submitted">Running</option>
        </select>
        <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)} className={SELECT}>
          <option value="">Any kind</option>
          <option value="upload">Recording / file</option>
          <option value="song">Song (voice isolated)</option>
          <option value="link">Song link</option>
          <option value="score">Score file</option>
        </select>
        <select aria-label="Saved" value={saved} onChange={(e) => setSaved(e.target.value)} className={SELECT}>
          <option value="">Saved or not</option>
          <option value="yes">Saved</option>
          <option value="no">Not saved</option>
        </select>
        <select aria-label="Who" value={origin} onChange={(e) => setOrigin(e.target.value)} className={SELECT}>
          <option value="">Accounts and previews</option>
          <option value="account">Accounts only</option>
          <option value="preview">Free previews only</option>
        </select>
        <select aria-label="Client" value={client} onChange={(e) => setClient(e.target.value)} className={SELECT}>
          <option value="">Web and app</option>
          <option value="web">Web</option>
          <option value="app">Mobile app</option>
        </select>
      </div>

      {s && (
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge tone="neutral">{`${s.total} total`}</Badge>
          <Badge tone="success">{`${s.done} done`}</Badge>
          <Badge tone="danger">{`${s.failed} failed`}</Badge>
          <Badge tone="danger">{`${s.refused} refused`}</Badge>
          <Badge tone="neutral">{`${s.running} running`}</Badge>
          <Badge tone="blue">{`${s.saved} saved (${s.total ? Math.round((s.saved / s.total) * 100) : 0}%)`}</Badge>
          <Badge tone="warning">{`${s.storePreviews} store previews`}</Badge>
          <Badge tone="neutral">{`${formatBytes(s.totalBytes)} uploaded`}</Badge>
        </div>
      )}

      <Card bleed>
        <StateView
          state={state}
          isEmpty={(d) => d.page.items.length === 0}
          emptyMessage="No transcriptions match these filters"
          loadingLabel="Loading activity"
        >
          {(d) => (
            <>
              <TranscriptionLogTable rows={d.page.items} offset={offset} />
              <Pager
                page={d.page.page}
                pageSize={d.page.pageSize}
                totalCount={d.page.totalCount}
                totalPages={d.page.totalPages}
                busy={state.isFetching}
                onPage={setPage}
              />
            </>
          )}
        </StateView>
      </Card>
    </div>
  );
}

/* ── Checkout funnel ─────────────────────────────────────────────────────── */

function Ranked({ title, rows, empty }: { title: string; rows: CategoryCount[]; empty: string }) {
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-1.5 text-[13px]">
          {rows.map((r) => (
            <li key={r.label} className="flex items-start justify-between gap-3">
              <span className="min-w-0 [overflow-wrap:anywhere] text-foreground">{r.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{r.count}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function CheckoutTab() {
  const offset = getReportingOffset();
  const today = reportingToday(offset);
  const [range, setRange] = useState<Range>({ from: addDays(today, -29), to: today });
  const state = useQuery({
    queryKey: ["activity-checkout", range.from, range.to],
    queryFn: ({ signal }) => getCheckoutFunnel(range.from, range.to, signal),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13px] text-muted-foreground">
          Each step counts browser sessions that reached it, from the website&apos;s tracker. A big drop between
          &ldquo;Checkout started&rdquo; and &ldquo;Checkout opened&rdquo;, or a run of the same error code, means the
          payment page is failing. The provider columns come from the payment records themselves.
        </p>
        <RangePicker value={range} offsetMinutes={offset} onChange={setRange} />
      </div>

      <StateView state={state} loadingLabel="Loading checkout">
        {(f) => {
          const top = Math.max(1, ...f.steps.map((s) => s.sessions));
          return (
            <div className="space-y-5">
              <Card title="Checkout funnel" hint="Browser sessions per step">
                <ul className="space-y-3">
                  {f.steps.map((step) => {
                    const bad = step.step === "Checkout failed" || step.step === "Payment not confirmed";
                    return (
                      <li key={step.step}>
                        <div className="flex items-baseline justify-between gap-3 text-[13px]">
                          <span className={`font-medium ${bad ? "text-danger-deep" : "text-foreground"}`}>{step.step}</span>
                          <span className="tabular-nums text-muted-foreground">
                            {step.sessions} {step.sessions === 1 ? "session" : "sessions"}
                            {step.events !== step.sessions && ` · ${step.events} times`}
                          </span>
                        </div>
                        <div className="mt-1 h-2 rounded-full bg-muted">
                          <div
                            className={`h-2 rounded-full ${bad ? "bg-danger" : "bg-brand"}`}
                            style={{ width: `${Math.round((step.sessions / top) * 100)}%` }}
                          />
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">{step.description}</p>
                      </li>
                    );
                  })}
                </ul>
              </Card>

              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                <Ranked title="Checkout error codes" rows={f.errorCodes} empty="No checkout errors in this window" />
                <Ranked title="Script errors on the site" rows={f.pageErrors} empty="No script errors reported" />
                <Ranked title="Provider failure reasons" rows={f.failureReasons} empty="No failed payments" />
                <Ranked title="Payments by status" rows={f.paymentsByStatus} empty="No payment attempts" />
                <Ranked title="Payments by provider" rows={f.paymentsByProvider} empty="No payment attempts" />
              </div>

              <Card title="Recent problems" hint="Newest first, from the browser and from the providers" bleed>
                {f.recentProblems.length === 0 ? (
                  <p className="px-5 pb-5 text-[13px] text-muted-foreground">No problems in this window.</p>
                ) : (
                  <div className="w-full overflow-x-auto border-t border-border">
                    <table className="w-full min-w-[44rem] text-left text-xs">
                      <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                        <tr>
                          <th className="px-4 py-3 font-medium">When</th>
                          <th className="px-4 py-3 font-medium">Problem</th>
                          <th className="px-4 py-3 font-medium">Detail</th>
                          <th className="px-4 py-3 font-medium">Who</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {f.recentProblems.map((p, i) => (
                          <tr key={`${p.atUtc}-${i}`}>
                            <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                              {formatInstantDateTime(p.atUtc, offset)}
                            </td>
                            <td className="px-4 py-3">
                              <div className="font-medium text-foreground">{p.problem}</div>
                              <Badge tone={p.source === "provider" ? "warning" : "neutral"}>
                                {p.source === "provider" ? "Payment provider" : "Browser"}
                              </Badge>
                            </td>
                            <td className="max-w-[24rem] px-4 py-3 text-muted-foreground [overflow-wrap:anywhere]">
                              {p.detail ?? "—"}
                              {p.reference && <div className="text-[11px]">Ref {p.reference}</div>}
                            </td>
                            <td className="px-4 py-3">
                              {p.userId ? (
                                <Link href={`/activity/journey?userId=${p.userId}`} className="font-medium text-foreground hover:text-brand">
                                  {p.userName || p.userEmail}
                                </Link>
                              ) : p.visitorId ? (
                                <Link
                                  href={`/activity/journey?visitor=${encodeURIComponent(p.visitorId)}`}
                                  className="text-brand hover:underline"
                                >
                                  Anonymous visitor
                                </Link>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          );
        }}
      </StateView>
    </div>
  );
}
