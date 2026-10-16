"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUp, Loader2, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import {
  createBlogTopic,
  deleteBlogTopic,
  generateBlogDrafts,
  getBlogTopics,
  updateBlogTopic,
  type BlogTopic,
  type BlogTopicInput,
  type BlogTopicStatus,
} from "@/api/blog";
import { Badge, type BadgeTone } from "@/components/Badge";
import { RunProgress } from "@/components/blog/GenerateDialog";
import { Card } from "@/components/Card";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ConfirmDialog";
import { PageHeader } from "@/components/PageHeader";
import { StateView } from "@/components/StateView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

const TONE: Record<BlogTopicStatus, BadgeTone> = { Unused: "blue", Used: "success", Skipped: "neutral" };

interface Draft {
  id: string | null;
  slug: string;
  keyword: string;
  intent: string;
  angle: string;
  links: string;
  status: BlogTopicStatus;
}

const EMPTY: Draft = { id: null, slug: "", keyword: "", intent: "", angle: "", links: "", status: "Unused" };

function toInput(d: Draft, position: number | null): BlogTopicInput {
  return {
    slug: d.slug.trim(),
    keyword: d.keyword.trim(),
    intent: d.intent.trim() || null,
    angle: d.angle.trim() || null,
    links: d.links.split(/[\s,]+/).map((l) => l.trim()).filter(Boolean),
    position,
    status: d.status,
  };
}

const asInput = (t: BlogTopic, position = t.position): BlogTopicInput => ({
  slug: t.slug,
  keyword: t.keyword,
  intent: t.intent,
  angle: t.angle,
  links: t.links,
  position,
  status: t.status,
});

/**
 * The drafting queue (what used to be content/blog/topics.yml): "Generate" takes the first unused topics from
 * the top. Each topic is the post's address, the search phrase it answers, what the searcher wants, the
 * angle, and the site pages it must link to.
 */
export function TopicsView() {
  const queryClient = useQueryClient();
  const topics = useQuery({ queryKey: ["blog-topics"], queryFn: ({ signal }) => getBlogTopics(signal) });
  const [editing, setEditing] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [runId, setRunId] = useState<string | null>(null);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["blog-topics"] });

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      if (editing.id) {
        const current = topics.data?.find((t) => t.id === editing.id);
        await updateBlogTopic(editing.id, toInput(editing, current?.position ?? null));
      } else {
        await createBlogTopic(toInput(editing, null));
      }
      toast.success("Saved.");
      setEditing(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the topic.");
    } finally {
      setSaving(false);
    }
  };

  /** Swaps a topic's place with its neighbour's. */
  const move = async (list: BlogTopic[], i: number, by: -1 | 1) => {
    const a = list[i], b = list[i + by];
    if (!a || !b) return;
    try {
      const pa = a.position === b.position ? b.position + by : b.position;
      await updateBlogTopic(a.id, asInput(a, pa));
      await updateBlogTopic(b.id, asInput(b, a.position));
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not move the topic.");
    }
  };

  const draftOne = async (t: BlogTopic) => {
    try {
      const run = await generateBlogDrafts(1, t.id);
      setRunId(run.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the draft.");
    }
  };

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Blog topics"
        subtitle="The queue Gemini drafts from, top first. Twice a week the API drafts the next one; drafts wait for you in the Blog."
        breadcrumb={["Dashboard", "Blog", "Topics"]}
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/blog">
                <ArrowLeft aria-hidden="true" /> Blog
              </Link>
            </Button>
            <Button type="button" size="sm" onClick={() => setEditing({ ...EMPTY })}>
              <Plus aria-hidden="true" /> Add topic
            </Button>
          </>
        }
      />

      <Card title="Queue" hint="Unused topics are drafted in this order. Used ones already have a post; skipped ones are never drafted." bleed>
        <StateView state={topics} isEmpty={(d) => d.length === 0} emptyMessage="No topics yet" loadingLabel="Loading topics">
          {(list) => (
            <ol className="divide-y divide-border border-t border-border">
              {list.map((t, i) => (
                <li key={t.id} className="grid gap-2 px-5 py-3 text-xs sm:grid-cols-[1fr_auto]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={TONE[t.status]}>{t.status}</Badge>
                      <span className="font-semibold text-foreground">{t.keyword}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">/blog/{t.slug}</span>
                      {t.postId && (
                        <Link href={`/blog/${t.postId}`} className="text-brand hover:underline">
                          the draft
                        </Link>
                      )}
                    </div>
                    {t.intent && <p className="mt-1 text-muted-foreground">{t.intent}</p>}
                    {t.angle && <p className="mt-0.5 text-foreground">{t.angle}</p>}
                    {t.links.length > 0 && <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">Links: {t.links.join(", ")}</p>}
                  </div>
                  <div className="flex items-start gap-1">
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="Move up" disabled={i === 0} onClick={() => void move(list, i, -1)}>
                      <ArrowUp aria-hidden="true" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="Move down" disabled={i === list.length - 1} onClick={() => void move(list, i, 1)}>
                      <ArrowDown aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Edit"
                      onClick={() => setEditing({ id: t.id, slug: t.slug, keyword: t.keyword, intent: t.intent, angle: t.angle, links: t.links.join(", "), status: t.status })}
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                    {t.status === "Unused" && (
                      <Button type="button" variant="ghost" size="icon-sm" aria-label="Draft this one now" title="Draft this one now" onClick={() => void draftOne(t)}>
                        <Sparkles aria-hidden="true" />
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Delete"
                      onClick={() =>
                        setConfirm({
                          title: "Delete this topic?",
                          body: `"${t.keyword}" leaves the queue. A post already drafted from it is kept.`,
                          confirmLabel: "Delete",
                          tone: "danger",
                          onConfirm: async () => {
                            await deleteBlogTopic(t.id);
                            refresh();
                          },
                        })
                      }
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </StateView>
      </Card>

      <Sheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{editing?.id ? "Edit topic" : "Add a topic"}</SheetTitle>
            <SheetDescription>New topics go to the end of the queue; move them up to draft them sooner.</SheetDescription>
          </SheetHeader>
          {editing && (
            <form onSubmit={save} className="space-y-4 px-4 pb-6">
              <div className="space-y-1.5">
                <Label htmlFor="t-keyword">Search phrase the post answers</Label>
                <Input
                  id="t-keyword"
                  value={editing.keyword}
                  onChange={(e) =>
                    setEditing((d) =>
                      d && { ...d, keyword: e.target.value, slug: d.id ? d.slug : e.target.value.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") },
                    )
                  }
                  placeholder="how to sing alto in a choir"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-slug">Address (/blog/…)</Label>
                <Input id="t-slug" value={editing.slug} onChange={(e) => setEditing((d) => d && { ...d, slug: e.target.value.toLowerCase() })} className="font-mono text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-intent">What the searcher wants</Label>
                <Textarea id="t-intent" rows={2} value={editing.intent} onChange={(e) => setEditing((d) => d && { ...d, intent: e.target.value })} placeholder="How-to — new altos who keep drifting to the tune." />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-angle">The angle</Label>
                <Textarea id="t-angle" rows={3} value={editing.angle} onChange={(e) => setEditing((d) => d && { ...d, angle: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-links">Pages it must link to</Label>
                <Input id="t-links" value={editing.links} onChange={(e) => setEditing((d) => d && { ...d, links: e.target.value })} placeholder="/blog/how-to-read-tonic-solfa, /hymns" />
                <p className="text-[11px] text-muted-foreground">/app is always required. A link to a page not live yet is left out when drafting.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-status">Status</Label>
                <select
                  id="t-status"
                  value={editing.status}
                  onChange={(e) => setEditing((d) => d && { ...d, status: e.target.value as BlogTopicStatus })}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="Unused">Unused (in the queue)</option>
                  <option value="Used">Used</option>
                  <option value="Skipped">Skipped (never drafted)</option>
                </select>
              </div>
              <Button type="submit" disabled={saving || !editing.keyword.trim() || !editing.slug.trim()}>
                {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
                Save
              </Button>
            </form>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={runId !== null} onOpenChange={(open) => !open && setRunId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Drafting with Gemini</SheetTitle>
            <SheetDescription>The draft is saved to the Blog as a Draft when it is ready.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">{runId && <RunProgress runId={runId} />}</div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
