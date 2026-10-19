"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Sparkles, TriangleAlert, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { ApiError } from "@/api/client";
import {
  generateBlogDrafts,
  getBlogGeneration,
  getBlogTopics,
  isFinished,
  type BlogGenerationItem,
  type BlogGenerationRun,
  type BlogTokenUsage,
} from "@/api/blog";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { followLiveFeed } from "@/lib/liveFeed";

type Mode = "queue" | "topic" | "free";

export function tokens(n: number): string {
  return n.toLocaleString("en-GB");
}

/** "prompt 4,210 · output 2,900 · thinking 1,100 = 8,210" for one call. */
export function usageLine(u: BlogTokenUsage): string {
  return `${u.call}: prompt ${tokens(u.prompt)} · output ${tokens(u.output)} · thinking ${tokens(u.thinking)} = ${tokens(u.total)}`;
}

export function RunStatus({ run }: { run: BlogGenerationRun }) {
  const tone = run.status === "Succeeded" ? "success" : run.status === "Failed" ? "danger" : run.status === "Partial" ? "warning" : "blue";
  return <Badge tone={tone}>{run.status === "Partial" ? "Partly done" : run.status}</Badge>;
}

function ItemRow({ item }: { item: BlogGenerationItem }) {
  const total = item.usage.reduce((n, u) => n + u.total, 0);
  return (
    <li className="py-2.5 text-xs">
      <div className="flex items-start gap-2">
        {item.postId && item.passedChecks ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
        ) : item.postId ? (
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        ) : (
          <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          {item.postId ? (
            <Link href={`/blog/${item.postId}`} className="font-semibold text-foreground hover:text-brand">
              {item.title ?? item.slug}
            </Link>
          ) : (
            <span className="font-semibold text-foreground">{item.keyword}</span>
          )}
          <div className="font-mono text-[11px] text-muted-foreground">/blog/{item.slug}</div>
          {item.error && <p className="mt-1 text-danger-deep">{item.error}</p>}
          {item.postId && item.problems.length > 0 && (
            <p className="mt-1 text-warning-deep">
              Saved with {item.problems.length} thing{item.problems.length === 1 ? "" : "s"} to fix (listed in the editor).
            </p>
          )}
          {item.usage.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground tabular-nums">
              {item.usage.map((u, i) => (
                <li key={i}>{usageLine(u)}</li>
              ))}
              {item.usage.length > 1 && <li className="font-medium">All calls: {tokens(total)} tokens</li>}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}

/** A batch's progress: each draft as it is saved, with what it cost. Fetched again each time the batch moves. */
export function RunProgress({ runId }: { runId: string }) {
  const queryClient = useQueryClient();
  const run = useQuery({
    queryKey: ["blog-generation", runId],
    queryFn: ({ signal }) => getBlogGeneration(runId, signal),
  });
  const finished = run.data ? isFinished(run.data) : false;
  useEffect(() => {
    if (finished) return;
    return followLiveFeed(() => void queryClient.invalidateQueries({ queryKey: ["blog-generation", runId] }), "blog");
  }, [finished, queryClient, runId]);
  useEffect(() => {
    if (finished) {
      void queryClient.invalidateQueries({ queryKey: ["blog-posts"] });
      void queryClient.invalidateQueries({ queryKey: ["blog-generations"] });
      void queryClient.invalidateQueries({ queryKey: ["blog-topics"] });
    }
  }, [finished, queryClient]);

  if (!run.data) return <p className="text-xs text-muted-foreground">Loading…</p>;
  const r = run.data;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <RunStatus run={r} />
        <span className="text-muted-foreground">
          {r.items.length} of {r.count} draft{r.count === 1 ? "" : "s"}
          {r.model ? ` · ${r.model}` : ""} · {tokens(r.totalTokens)} tokens
        </span>
        {!finished && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Working" />}
      </div>
      {!finished && (
        <p className="text-xs text-muted-foreground">
          Each draft takes a minute or two (a draft, then a revision if the checks find problems). You can close this
          panel: the drafts keep coming and appear in the list as Drafts.
        </p>
      )}
      {r.error && <p className="rounded-md bg-danger/10 px-3 py-2 text-xs text-danger-deep">{r.error}</p>}
      {r.items.length > 0 && <ul className="divide-y divide-border">{r.items.map((item, i) => <ItemRow key={i} item={item} />)}</ul>}
    </div>
  );
}

/**
 * "Generate with Gemini": how many drafts, and on what — the next topics in the queue, one chosen topic, or a
 * topic in the founder's own words. The API queues the batch and a worker writes it; this panel shows the
 * drafts arriving and their token use. With auto-publish on (the default) a draft that passes every check goes
 * live by itself; one with problems left stays a draft.
 */
export function GenerateDialog({
  open,
  onOpenChange,
  model,
  autoPublish,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: string | undefined;
  autoPublish: boolean;
}) {
  const [mode, setMode] = useState<Mode>("queue");
  const [count, setCount] = useState(3);
  const [topicId, setTopicId] = useState("");
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const topics = useQuery({ queryKey: ["blog-topics"], queryFn: ({ signal }) => getBlogTopics(signal), enabled: open });
  const unused = (topics.data ?? []).filter((t) => t.status === "Unused");

  useEffect(() => {
    if (open) {
      setError(null);
      setRunId(null);
      setPending(false);
    }
  }, [open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const run =
        mode === "queue"
          ? await generateBlogDrafts(count)
          : mode === "topic"
            ? await generateBlogDrafts(1, topicId)
            : await generateBlogDrafts(1, null, text.trim());
      setRunId(run.id);
      void queryClient.invalidateQueries({ queryKey: ["blog-generations"] });
    } catch (caught) {
      setError(caught instanceof ApiError || caught instanceof Error ? caught.message : "Could not start the drafts.");
    } finally {
      setPending(false);
    }
  };

  const valid = mode === "queue" ? count >= 1 && count <= 10 : mode === "topic" ? topicId !== "" : text.trim().length >= 3;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-brand" aria-hidden="true" /> Generate with Gemini
          </SheetTitle>
          <SheetDescription>
            Drafts are written with {model ?? "Gemini"} under the blog&apos;s rules (no invented facts, solfa only from the
            engine, links only to the site), checked and revised once if needed.{" "}
            {autoPublish
              ? "A draft that passes every check is published straight away; one with problems left is saved as a Draft for you to fix."
              : "Each is saved as a Draft for you to edit and publish."}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6">
          {runId ? (
            <>
              <RunProgress runId={runId} />
              <Button type="button" variant="outline" size="sm" onClick={() => setRunId(null)}>
                Generate more
              </Button>
            </>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <fieldset className="space-y-2">
                <legend className="mb-1 text-xs font-semibold text-foreground">What to write about</legend>
                {(
                  [
                    ["queue", "The next topics in the queue"],
                    ["topic", "One topic from the queue"],
                    ["free", "A topic in my own words"],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-2 text-sm">
                    <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} />
                    {label}
                  </label>
                ))}
              </fieldset>

              {mode === "queue" && (
                <div className="space-y-1.5">
                  <Label htmlFor="gen-count">How many drafts (1–10)</Label>
                  <Input
                    id="gen-count"
                    type="number"
                    min={1}
                    max={10}
                    value={count}
                    onChange={(e) => setCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                    className="w-24"
                  />
                  <p className="text-xs text-muted-foreground">
                    {unused.length} topic{unused.length === 1 ? "" : "s"} waiting.{" "}
                    {unused.slice(0, count).map((t) => t.keyword).join(" · ")}
                  </p>
                </div>
              )}

              {mode === "topic" && (
                <div className="space-y-1.5">
                  <Label htmlFor="gen-topic">Topic</Label>
                  <select
                    id="gen-topic"
                    value={topicId}
                    onChange={(e) => setTopicId(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="">Choose a topic…</option>
                    {unused.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.keyword} (/blog/{t.slug})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {mode === "free" && (
                <div className="space-y-1.5">
                  <Label htmlFor="gen-text">The topic, as a search phrase or a sentence</Label>
                  <Input
                    id="gen-text"
                    value={text}
                    maxLength={300}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="e.g. how to warm up a church choir in ten minutes"
                  />
                  <p className="text-xs text-muted-foreground">The address is made from it: /blog/how-to-warm-up-…</p>
                </div>
              )}

              {error && <p className="rounded-md bg-danger/10 px-3 py-2 text-xs text-danger-deep">{error}</p>}

              <Button type="submit" disabled={!valid || pending}>
                {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
                {mode === "queue" ? `Draft ${count} post${count === 1 ? "" : "s"}` : "Draft the post"}
              </Button>
            </form>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
