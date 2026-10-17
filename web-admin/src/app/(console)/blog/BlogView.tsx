"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, ListOrdered, Loader2, Plus, RefreshCw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  getBlogGenerations,
  getBlogPosts,
  getBlogReads,
  getBlogSiteStatus,
  requestBlogRebuild,
  type BlogPostRow,
  type BlogPostStatus,
  type BlogSiteStatus,
} from "@/api/blog";
import { Badge, type BadgeTone } from "@/components/Badge";
import { GenerateDialog, RunStatus, tokens } from "@/components/blog/GenerateDialog";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { Pager } from "@/components/Pager";
import { Segmented } from "@/components/Segmented";
import { StateView } from "@/components/StateView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatInstantDateTime, formatRelative } from "@/lib/format";
import { getReportingOffset } from "@/lib/reporting";
import { useClampPage } from "@/lib/useClampPage";
import { useDebounced } from "@/lib/useDebounced";

export const STATUS_TONE: Record<BlogPostStatus, BadgeTone> = {
  Draft: "neutral",
  Scheduled: "blue",
  Published: "success",
  Archived: "warning",
};

type Filter = "all" | BlogPostStatus;
const FILTERS = [
  { value: "all", label: "All" },
  { value: "Draft", label: "Drafts" },
  { value: "Scheduled", label: "Scheduled" },
  { value: "Published", label: "Published" },
  { value: "Archived", label: "Archived" },
] as const satisfies readonly { value: Filter; label: string }[];

function deployLabel(site: BlogSiteStatus): { text: string; tone: BadgeTone } | null {
  const run = site.latestDeploy;
  if (!run) return null;
  if (run.status !== "completed") return { text: run.status === "queued" ? "Deploy queued" : "Deploying", tone: "blue" };
  return run.conclusion === "success" ? { text: "Last deploy succeeded", tone: "success" } : { text: `Last deploy: ${run.conclusion ?? "unknown"}`, tone: "danger" };
}

/** Whether publishing rebuilds the site, what is waiting, and the deploy workflow's newest run. */
function SiteCard() {
  const queryClient = useQueryClient();
  const site = useQuery({
    queryKey: ["blog-site"],
    queryFn: ({ signal }) => getBlogSiteStatus(signal),
    refetchInterval: (q) => (q.state.data && (q.state.data.pendingRebuilds > 0 || q.state.data.latestDeploy?.status !== "completed") ? 15_000 : 60_000),
  });
  const [busy, setBusy] = useState(false);
  const offset = getReportingOffset();

  const rebuild = async () => {
    setBusy(true);
    try {
      await requestBlogRebuild();
      toast.success("The site will be rebuilt within a couple of minutes.");
      void queryClient.invalidateQueries({ queryKey: ["blog-site"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not ask for a rebuild.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="The site"
      info="Publishing, unpublishing or editing a live post asks GitHub to rebuild notefusion.studio (the deploy-web workflow), at most once every two minutes. The build reads the live posts from the API."
      action={
        <Button type="button" variant="outline" size="sm" onClick={rebuild} disabled={busy || !site.data?.rebuildsEnabled}>
          {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
          Rebuild now
        </Button>
      }
    >
      <StateView state={site} loadingLabel="Loading the site's status">
        {(s) => {
          const deploy = deployLabel(s);
          return (
            <div className="space-y-2 text-xs">
              {!s.rebuildsEnabled && (
                <p className="rounded-md bg-warning/10 px-3 py-2 text-warning-deep">
                  Site rebuilds are off: <code>GitHub__Token</code> is not set on the API. Publishing still works, but
                  published posts only reach notefusion.studio at the website&apos;s next deploy.
                </p>
              )}
              {!s.draftingEnabled && (
                <p className="rounded-md bg-warning/10 px-3 py-2 text-warning-deep">
                  Drafting is off: set <code>Gemini__ApiKey</code> on the API.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {deploy && <Badge tone={deploy.tone}>{deploy.text}</Badge>}
                {s.latestDeploy && (
                  <a href={s.latestDeploy.url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-brand hover:underline">
                    {formatRelative(s.latestDeploy.createdAtUtc, Date.now())} <ExternalLink className="size-3.5" aria-hidden="true" />
                  </a>
                )}
                {s.pendingRebuilds > 0 && <Badge tone="blue">{`${s.pendingRebuilds} change${s.pendingRebuilds === 1 ? "" : "s"} waiting to deploy`}</Badge>}
              </div>
              <p className="text-muted-foreground">
                Last change {s.lastRequestedAtUtc ? formatInstantDateTime(s.lastRequestedAtUtc, offset) : "—"} · last rebuild asked{" "}
                {s.lastDispatchedAtUtc ? formatInstantDateTime(s.lastDispatchedAtUtc, offset) : "—"}
                {s.rebuildTarget ? ` · ${s.rebuildTarget}` : ""}
              </p>
              {s.lastError && s.pendingRebuilds > 0 && <p className="text-danger-deep">GitHub said: {s.lastError}</p>}
              <p className="text-muted-foreground">
                Drafting with <span className="font-mono">{s.model}</span>
                {s.autoDraftSchedule ? ` · ${s.autoDraftSchedule}` : " · no scheduled drafts"}
              </p>
            </div>
          );
        }}
      </StateView>
    </Card>
  );
}

/** The newest batches of drafts, with their state and cost. */
function RecentRuns() {
  const runs = useQuery({ queryKey: ["blog-generations"], queryFn: ({ signal }) => getBlogGenerations(5, signal), refetchInterval: 10_000 });
  const offset = getReportingOffset();
  return (
    <Card title="Recent drafting" hint="Gemini batches, newest first">
      <StateView state={runs} isEmpty={(d) => d.length === 0} emptyMessage="Nothing drafted yet" loadingLabel="Loading">
        {(d) => (
          <ul className="space-y-2 text-xs">
            {d.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2">
                <RunStatus run={r} />
                <span className="text-foreground">
                  {r.items.filter((i) => i.postId).length}/{r.count} saved
                  {r.trigger === "Schedule" ? " · scheduled" : ""} · {tokens(r.totalTokens)} tokens
                </span>
                <span className="text-muted-foreground">{formatInstantDateTime(r.createdAtUtc, offset)}</span>
                {r.error && <span className="w-full text-danger-deep">{r.error}</span>}
              </li>
            ))}
          </ul>
        )}
      </StateView>
    </Card>
  );
}

function Reads({ row, reads }: { row: BlogPostRow; reads: Record<string, number> | undefined }) {
  if (row.status !== "Published") return <span className="text-muted-foreground">—</span>;
  const n = reads?.[row.path];
  return <span className="tabular-nums">{n === undefined ? "…" : n.toLocaleString("en-GB")}</span>;
}

/** The blog: every post with its state, the site's rebuilds, and "Generate with Gemini". */
export function BlogView() {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const [page, setPage] = useState(1);
  const [generating, setGenerating] = useState(false);
  useEffect(() => setPage(1), [filter, q]);
  const offset = getReportingOffset();

  const site = useQuery({ queryKey: ["blog-site"], queryFn: ({ signal }) => getBlogSiteStatus(signal) });
  const list = useQuery({
    queryKey: ["blog-posts", page, filter, q],
    queryFn: ({ signal }) => getBlogPosts(page, 25, { status: filter === "all" ? undefined : filter, q: q || undefined }, signal),
    placeholderData: keepPreviousData,
  });
  useClampPage(page, list.data?.totalPages, setPage);

  const livePaths = (list.data?.items ?? []).filter((r) => r.status === "Published").map((r) => r.path).slice(0, 50);
  const reads = useQuery({
    queryKey: ["blog-reads", livePaths],
    queryFn: ({ signal }) => getBlogReads(livePaths, signal),
    enabled: livePaths.length > 0,
    staleTime: 5 * 60_000,
  });

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Blog posts"
        subtitle={
          site.data?.autoPublishDrafts === false
            ? "Write, check and publish the posts on notefusion.studio/blog. Gemini drafts wait here for you to publish."
            : "Write, check and publish the posts on notefusion.studio/blog. A Gemini draft that passes every check goes live by itself; one with problems waits here."
        }
        breadcrumb={["Dashboard", "Blog posts"]}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/blog/topics">
                <ListOrdered aria-hidden="true" /> Topics
              </Link>
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setGenerating(true)} disabled={site.data ? !site.data.draftingEnabled : false}>
              <Sparkles aria-hidden="true" /> Generate with Gemini
            </Button>
            <Button asChild size="sm">
              <Link href="/blog/new">
                <Plus aria-hidden="true" /> New post
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <SiteCard />
        <RecentRuns />
      </div>

      <Card
        title="Posts"
        hint="Newest change first"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, slug, keyword" className="h-8 w-56 text-xs" />
            <Segmented label="Status" options={FILTERS} value={filter} onChange={setFilter} />
          </div>
        }
        bleed
      >
        <StateView state={list} isEmpty={(d) => d.items.length === 0} emptyMessage="No posts here" loadingLabel="Loading posts">
          {(d) => (
            <div className="border-t border-border">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-5 py-2 font-medium">Post</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Source</th>
                      <th className="px-3 py-2 text-right font-medium">Reads</th>
                      <th className="px-3 py-2 text-right font-medium">Words</th>
                      <th className="px-5 py-2 font-medium">Updated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {d.items.map((row) => (
                      <tr key={row.id} className="align-top hover:bg-muted/40">
                        <td className="px-5 py-3">
                          <Link href={`/blog/${row.id}`} className="font-semibold text-foreground hover:text-brand">
                            {row.title}
                          </Link>
                          <div className="font-mono text-[11px] text-muted-foreground">{row.path}</div>
                          {row.reviewNotes > 0 && (
                            <div className="mt-1 text-[11px] text-warning-deep">
                              {row.reviewNotes} thing{row.reviewNotes === 1 ? "" : "s"} to fix from the checks
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge>
                          {row.status === "Scheduled" && row.publishAtUtc && (
                            <div className="mt-1 text-[11px] text-muted-foreground">{formatInstantDateTime(row.publishAtUtc, offset)}</div>
                          )}
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">
                          {row.source}
                          {row.source === "Gemini" && <div className="text-[11px]">{tokens(row.totalTokens)} tokens</div>}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <Reads row={row} reads={reads.data} />
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{row.words.toLocaleString("en-GB")}</td>
                        <td className="px-5 py-3 text-muted-foreground">{formatInstantDateTime(row.updatedAtUtc, offset)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={d.page} pageSize={d.pageSize} totalCount={d.totalCount} totalPages={d.totalPages} busy={list.isFetching} onPage={setPage} />
            </div>
          )}
        </StateView>
      </Card>

      <GenerateDialog
        open={generating}
        onOpenChange={setGenerating}
        model={site.data?.model}
        autoPublish={site.data?.autoPublishDrafts ?? true}
      />
    </div>
  );
}
