"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { getBlogAnalytics, type BlogAnalytics, type BlogPostRow } from "@/api/blogAnalytics";
import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { ChartCard, DataTable, FunnelBars, RankedBars, StackedDaily } from "@/components/insights/Charts";
import { PageHeader } from "@/components/PageHeader";
import { RangePicker, type Range } from "@/components/RangePicker";
import { Segmented } from "@/components/Segmented";
import { StateView } from "@/components/StateView";
import { useChartPalette } from "@/lib/chart";
import { addDays, formatCount, formatDayLong, formatDayShort, formatPercent, reportingToday } from "@/lib/format";

/* Blog analytics: who reads the blog and the hymns, and whether they go on to open the app, sign up,
 * transcribe and pay. Everything here is first-party (assets/track.js + assets/blog-track.js on the site);
 * the funnel follows the window's new blog visitors with first-touch credit (see "How this is counted"). */

const SITE = "https://notefusion.studio";

const SOURCE_LABELS: Record<string, string> = {
  search: "Search",
  social: "Social",
  direct: "Direct",
  internal: "From the site",
  other: "Other sites",
};

const KINDS = [
  { value: "all", label: "All" },
  { value: "post", label: "Posts" },
  { value: "hymn", label: "Hymns" },
  { value: "index", label: "Lists" },
] as const;
type KindFilter = (typeof KINDS)[number]["value"];

type SortKey = "views" | "visitors" | "readRate" | "avgActiveSeconds" | "ctaClicks" | "entryVisitors" | "signups" | "transcribers" | "payers";
const COLUMNS: { key: SortKey; label: string; hint: string }[] = [
  { key: "views", label: "Views", hint: "Page views in the window" },
  { key: "visitors", label: "Visitors", hint: "Distinct browsers that viewed the page" },
  { key: "readRate", label: "Read rate", hint: "Visitors who read it: half the article and 30 s visible" },
  { key: "avgActiveSeconds", label: "Avg time", hint: "Mean seconds with the tab visible, per page view that reported it" },
  { key: "ctaClicks", label: "To app", hint: "Clicks on a link to /app from this page" },
  { key: "entryVisitors", label: "Entries", hint: "New visitors whose first blog page was this one" },
  { key: "signups", label: "Sign-ups", hint: "First-touch sign-ups credited to this page (a floor)" },
  { key: "transcribers", label: "Transcribed", hint: "First-touch first transcriptions or previews credited to this page" },
  { key: "payers", label: "Paid", hint: "First-touch payments credited to this page" },
];

function seconds(s: number | null): string {
  if (s == null) return "—";
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${Math.round(s - m * 60)} s`;
}

function pageName(path: string): string {
  if (path === "/blog") return "Blog front page";
  if (path === "/hymns") return "Hymn list";
  const slug = path.split("/").filter(Boolean).pop() ?? path;
  const words = slug.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function Kpi({ label, value, note, hint }: { label: string; value: string; note?: string | undefined; hint?: string }) {
  return (
    <div className="rounded-xl border border-border/80 bg-card p-4 shadow-xs" title={hint}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold tracking-tight text-foreground tabular-nums">{value}</div>
      {note && <div className="mt-1 text-[11px] text-muted-foreground">{note}</div>}
    </div>
  );
}

function Takeaway({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">{children}</p>;
}

export function BlogAnalyticsView() {
  const [range, setRange] = useState<Range | null>(null);
  const state = useQuery({
    queryKey: ["blog-analytics", range?.from, range?.to],
    queryFn: ({ signal }) => getBlogAnalytics(range?.from, range?.to, signal),
    placeholderData: keepPreviousData,
  });

  const offset = state.data?.reportingOffsetMinutes ?? 60;
  const picker: Range = range ?? { from: addDays(reportingToday(offset), -29), to: reportingToday(offset) };

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Blog analytics"
        subtitle="Blog and hymn readers, and whether they go on to try the app, transcribe and pay."
        breadcrumb={["Dashboard", "Blog analytics"]}
      />
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/80 bg-card p-3 shadow-xs">
        <RangePicker value={picker} offsetMinutes={offset} onChange={setRange} />
        {state.isFetching && <span className="text-xs text-muted-foreground">Updating…</span>}
      </div>
      <StateView state={state} loadingLabel="Loading blog analytics">
        {(d) => <BlogBody d={d} />}
      </StateView>
    </div>
  );
}

function BlogBody({ d }: { d: BlogAnalytics }) {
  const c = useChartPalette();
  const k = d.kpis;
  const w = d.attributionWindowDays;

  const steps = d.funnel.map((s) => ({ step: s.approximate ? `${s.label} (at least)` : s.label, count: s.count, hint: s.join }));
  const drop = d.funnel.slice(1).reduce<{ from: string; to: string; lost: number } | null>((worst, s, i) => {
    const prev = d.funnel[i]!;
    const lost = prev.count > 0 ? 1 - s.count / prev.count : 0;
    return !worst || lost > worst.lost ? { from: prev.label, to: s.label, lost } : worst;
  }, null);

  const totals = d.daily.reduce((t, x) => ({ views: t.views + x.views, reads: t.reads + x.reads, signups: t.signups + x.signups }), { views: 0, reads: 0, signups: 0 });
  const bestSource = [...d.sources].filter((s) => s.visitors >= 5).sort((a, b) => b.signups / b.visitors - a.signups / a.visitors)[0];

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Blog visitors"
          value={formatCount(k.visitors)}
          note={`${formatCount(k.newVisitors)} new · ${formatCount(k.views)} page views`}
          hint="Distinct browsers on a blog or hymn page in this window. New: their first blog page on record was in it."
        />
        <Kpi
          label="Read rate"
          value={k.readRate == null ? "—" : formatPercent(k.readRate, 0)}
          note={`${formatCount(k.readers)} readers · ${seconds(k.avgActiveSeconds)} average time on the page`}
          hint="Visitors with a genuine read: half the article scrolled past and 30 seconds with the tab visible."
        />
        <Kpi
          label="Sign-ups from the blog"
          value={formatCount(k.signupsFromBlog)}
          note={`First touch, within ${w} days · ${formatCount(k.assistedSignups)} assisted`}
          hint="First touch: new blog visitors who made an account within the window. Assisted: any account made in this window whose browser saw a blog page first."
        />
        <Kpi
          label="Transcriptions from the blog"
          value={formatCount(k.transcribersFromBlog)}
          note={`${formatCount(k.payersFromBlog)} paid · ${formatCount(k.assistedPayers)} paid after any blog visit`}
          hint="New blog visitors who made a first transcription (or an anonymous preview) within the window."
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <ChartCard
            title="From reading to paying"
            info={`The window's new blog visitors, followed for ${w} days after their first blog page. Hover a step for how it is joined. Steps marked "at least" miss people who carry on in the phone app or another browser.`}
            table={<DataTable head={["Step", "Visitors", "Joined by"]} rows={d.funnel.map((s) => [s.label, s.count, s.approximate ? "Account join (a floor)" : "Same browser"])} />}
          >
            <FunnelBars steps={steps} />
            {drop && drop.lost > 0 && (
              <Takeaway>
                Biggest drop: <span className="text-foreground">{drop.from} → {drop.to}</span>, losing {formatPercent(drop.lost, 0)}.
              </Takeaway>
            )}
          </ChartCard>
        </div>
        <div className="xl:col-span-5">
          <ChartCard
            title="Where new readers come from"
            info="Each new visitor's first blog page: the label blog-track.js sent (search, social, direct, from the site, other sites), else the page view's referrer. A tagged link with no referrer counts under its utm_source's network."
            table={
              <DataTable
                head={["Source", "Visitors", "Readers", "Sign-ups", "Transcribed"]}
                rows={d.sources.map((s) => [SOURCE_LABELS[s.source] ?? s.source, s.visitors, s.readers, s.signups, s.transcribers])}
              />
            }
          >
            <RankedBars
              rows={d.sources.map((s) => ({ label: SOURCE_LABELS[s.source] ?? s.source, count: s.visitors, note: `${formatCount(s.readers)} read · ${formatCount(s.signups)} signed up` }))}
              empty="No new blog visitors in this window"
            />
            {bestSource && bestSource.signups > 0 && (
              <Takeaway>
                Best at bringing sign-ups: <span className="text-foreground">{SOURCE_LABELS[bestSource.source] ?? bestSource.source}</span> ({formatPercent(bestSource.signups / bestSource.visitors, 1)} of its visitors).
              </Takeaway>
            )}
          </ChartCard>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-12">
        <div className="xl:col-span-8">
          <ChartCard
            title="Views and reads each day"
            info="Page views of blog and hymn pages, and the genuine reads among them. Reads are recorded from the day blog-track.js shipped."
            legend={[
              { label: "Views", color: c.series5[0]! },
              { label: "Reads", color: c.series5[1]! },
            ]}
            table={<DataTable head={["Day", "Views", "Reads"]} rows={d.daily.map((x) => [formatDayShort(x.date), x.views, x.reads])} />}
          >
            <DailyLines data={d.daily} />
            <Takeaway>
              {totals.views === 0
                ? "No blog page views in this window."
                : `${formatCount(totals.reads)} reads from ${formatCount(totals.views)} views: ${formatPercent(totals.reads / totals.views, 0)} of page views become a read.`}
            </Takeaway>
          </ChartCard>
        </div>
        <div className="xl:col-span-4">
          <ChartCard
            title="Sign-ups after a blog visit"
            info="Accounts created each day whose browser had seen a blog or hymn page before (assisted; any time before, not only the last 30 days)."
            table={<DataTable head={["Day", "Sign-ups"]} rows={d.daily.map((x) => [formatDayShort(x.date), x.signups])} />}
          >
            <StackedDaily data={d.daily} series={[{ key: "signups", label: "Sign-ups" }]} unit="sign-ups" />
            <Takeaway>{formatCount(totals.signups)} accounts in this window had read the blog first.</Takeaway>
          </ChartCard>
        </div>
      </div>

      <PostTable posts={d.posts} />

      <div className="grid gap-5 xl:grid-cols-3">
        <ChartCard
          title="Top entry pages"
          info="The first blog page new visitors saw, ranked by the sign-ups it gets first-touch credit for."
          table={<DataTable head={["Page", "Visitors", "Sign-ups", "Transcribed", "Paid"]} rows={d.topEntries.map((e) => [e.path, e.visitors, e.signups, e.transcribers, e.payers])} />}
        >
          <RankedBars
            rows={d.topEntries.map((e) => ({ label: pageName(e.path), count: e.visitors, note: `${formatCount(e.signups)} sign-up${e.signups === 1 ? "" : "s"}` }))}
            colorIndex={0}
            empty="No new blog visitors in this window"
          />
        </ChartCard>
        <Card title="Campaigns" info="utm_source / utm_medium / utm_campaign on a new visitor's first blog page.">
          {d.campaigns.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">No tagged links in this window</p>
          ) : (
            <DataTable head={["Campaign", "Visitors", "Sign-ups"]} rows={d.campaigns.map((x) => [x.campaign, x.visitors, x.signups])} />
          )}
        </Card>
        <Card title="Shares" info="Clicks on a post's share links, by network. Copy: the Copy link button.">
          {d.shares.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">No shares in this window</p>
          ) : (
            <DataTable head={["Network", "Shares"]} rows={d.shares.map((s) => [s.network === "x" ? "X" : s.network.charAt(0).toUpperCase() + s.network.slice(1), s.count])} />
          )}
        </Card>
      </div>

      <Card title="How this is counted">
        <ul className="list-disc space-y-1.5 pl-5 text-xs text-muted-foreground">
          <li>
            <span className="text-foreground">A visitor is a browser</span>, by track.js&apos;s random id in its own storage: the same person on a phone and a
            laptop is two visitors, and clearing site data makes a new one. The team&apos;s browsers (ever signed in as an admin or internal account) are
            left out.
          </li>
          <li>
            <span className="text-foreground">First touch, {w} days.</span> The funnel follows browsers whose first blog or hymn page on record (web events
            are kept 180 days) was in this window. That first page gets the credit for what the browser does in the {w} days after it, even past the
            window&apos;s end. Assisted counts are looser: any blog visit, at any time, before an account was made.
          </li>
          <li>
            <span className="text-foreground">Exact joins</span>: views, reads, clicks and opening the app are the same browser&apos;s own events.
          </li>
          <li>
            <span className="text-foreground">Approximate joins (floors)</span>: a browser is tied to an account when it later signed in to the web app,
            or when its web-app device id ran a transcription or claimed a preview for that account. Readers who sign up in the phone app or on another
            device are missed. Anonymous previews count as a first transcription by the browser&apos;s device id. Existing customers reading the blog are
            never counted as sign-ups.
          </li>
          <li>
            <span className="text-foreground">A read</span> is half the article scrolled past and 30 seconds with the tab visible (time in another tab
            does not count). Reads, time on page, clicks to the app, shares and hymn plays exist only from the day blog-track.js shipped; page views go
            back further.
          </li>
        </ul>
      </Card>
    </div>
  );
}

/** Views and reads on one axis (the same unit: page loads), lines with a hover crosshair. */
function DailyLines({ data }: { data: BlogAnalytics["daily"] }) {
  const c = useChartPalette();
  const series = [
    { key: "views" as const, label: "Views", color: c.series5[0]! },
    { key: "reads" as const, label: "Reads", color: c.series5[1]! },
  ];
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={c.grid} />
          <XAxis dataKey="date" tickFormatter={formatDayShort} stroke={c.tick} fontSize={11} tickLine={false} axisLine={{ stroke: c.axis }} minTickGap={18} />
          <YAxis stroke={c.tick} fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            cursor={{ stroke: c.axis }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="rounded-md border border-border bg-popover px-3 py-2 text-[11px] shadow-lift">
                  <p className="font-semibold text-foreground">{formatDayLong(String(label))}</p>
                  {series.map((s) => (
                    <p key={s.key} className="mt-0.5 flex items-center gap-1.5 text-muted-foreground">
                      <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
                      {s.label}: <span className="text-foreground">{formatCount(Number(payload.find((p) => p.dataKey === s.key)?.value ?? 0))}</span>
                    </p>
                  ))}
                </div>
              );
            }}
          />
          {series.map((s) => (
            <Line key={s.key} type="linear" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2 }} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Every blog and hymn page in the window, sortable, each linked to the live page. */
function PostTable({ posts }: { posts: BlogPostRow[] }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "views", desc: true });
  const [kind, setKind] = useState<KindFilter>("all");
  const rows = useMemo(() => {
    const value = (p: BlogPostRow) => p[sort.key] ?? -1;
    return posts
      .filter((p) => kind === "all" || p.kind === kind)
      .sort((a, b) => (sort.desc ? value(b) - value(a) : value(a) - value(b)) || a.path.localeCompare(b.path));
  }, [posts, sort, kind]);

  return (
    <Card
      title="Posts and hymns"
      info="Views, reads and clicks are this window's activity on each page, from every visitor. Entries, sign-ups, transcribed and paid are first-touch credit from the window's new visitors."
      action={<Segmented label="Page type" options={KINDS} value={kind} onChange={setKind} />}
      bleed
    >
      <div className="overflow-x-auto pb-2">
        <table className="w-full min-w-[920px] text-left text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-5 py-2.5 font-medium">Page</th>
              {COLUMNS.map((col) => {
                const active = sort.key === col.key;
                return (
                  <th key={col.key} className="px-2 py-2.5 text-right font-medium" title={col.hint} aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}>
                    <button
                      type="button"
                      className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground" : ""}`}
                      onClick={() => setSort({ key: col.key, desc: active ? !sort.desc : true })}
                    >
                      {col.label}
                      {active && (sort.desc ? <ArrowDown className="h-3 w-3" aria-hidden /> : <ArrowUp className="h-3 w-3" aria-hidden />)}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {rows.map((p) => (
              <tr key={p.path} className="hover:bg-muted/40">
                <td className="max-w-[320px] px-5 py-2.5">
                  <div className="flex items-center gap-2">
                    <Badge tone={p.kind === "post" ? "blue" : p.kind === "hymn" ? "premium" : "neutral"}>{p.kind === "index" ? "list" : p.kind}</Badge>
                    <a href={SITE + p.path} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1 text-foreground hover:underline" title={p.path}>
                      <span className="truncate">{pageName(p.path)}</span>
                      <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                    </a>
                  </div>
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums text-foreground">{formatCount(p.views)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums text-foreground">{formatCount(p.visitors)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums text-foreground" title={`${p.readers} readers · ${p.completeReads} read to the end`}>
                  {p.kind === "index" ? "—" : formatPercent(p.readRate, 0)}
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums text-foreground">{seconds(p.avgActiveSeconds)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums text-foreground">{formatCount(p.ctaClicks)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums text-foreground">{formatCount(p.entryVisitors)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums text-foreground">{formatCount(p.signups)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums text-foreground">{formatCount(p.transcribers)}</td>
                <td className="px-2 py-2.5 pr-5 text-right tabular-nums text-foreground">{formatCount(p.payers)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="py-8 text-center text-xs text-muted-foreground">No pages of this kind were viewed in this window</p>}
      </div>
    </Card>
  );
}
