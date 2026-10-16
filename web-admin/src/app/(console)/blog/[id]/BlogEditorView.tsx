"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowLeft,
  CalendarClock,
  Copy,
  ExternalLink,
  Loader2,
  Plus,
  Save,
  Send,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ApiError } from "@/api/client";
import {
  archiveBlogPost,
  checkBlogPost,
  createBlogPost,
  deleteBlogPost,
  duplicateBlogPost,
  getBlogPost,
  publishBlogPost,
  scheduleBlogPost,
  unpublishBlogPost,
  updateBlogPost,
  type BlogFaq,
  type BlogPost,
  type BlogPostInput,
} from "@/api/blog";
import { Badge } from "@/components/Badge";
import { usageLine, tokens } from "@/components/blog/GenerateDialog";
import { Card } from "@/components/Card";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ConfirmDialog";
import { PageHeader } from "@/components/PageHeader";
import { ErrorView, LoadingView } from "@/components/StateView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { countWords, renderInlinePreview, renderPreview } from "@/lib/blogMarkdown";
import { formatInstantDateTime } from "@/lib/format";
import { getReportingOffset } from "@/lib/reporting";
import { useDebounced } from "@/lib/useDebounced";

import { STATUS_TONE } from "../BlogView";

/** The editor's fields, all as text, so every input is controlled and nothing is lost to a parse. */
interface Form {
  slug: string;
  title: string;
  dek: string;
  description: string;
  body: string;
  tags: string;
  keyword: string;
  coverSrc: string;
  coverAlt: string;
  coverWidth: string;
  coverHeight: string;
  faq: BlogFaq[];
  seoTitle: string;
  seoDescription: string;
  author: string;
}

const EMPTY: Form = {
  slug: "",
  title: "",
  dek: "",
  description: "",
  body: "",
  tags: "",
  keyword: "",
  coverSrc: "",
  coverAlt: "",
  coverWidth: "1200",
  coverHeight: "630",
  faq: [],
  seoTitle: "",
  seoDescription: "",
  author: "francis",
};

function fromPost(p: BlogPost): Form {
  return {
    slug: p.slug,
    title: p.title,
    dek: p.dek ?? "",
    description: p.description,
    body: p.body,
    tags: p.tags.join(", "),
    keyword: p.keyword ?? "",
    coverSrc: p.cover?.src ?? "",
    coverAlt: p.cover?.alt ?? "",
    coverWidth: String(p.cover?.width ?? 1200),
    coverHeight: String(p.cover?.height ?? 630),
    faq: p.faq.map((f) => ({ ...f })),
    seoTitle: p.seoTitle ?? "",
    seoDescription: p.seoDescription ?? "",
    author: p.author,
  };
}

const orNull = (s: string) => (s.trim() ? s.trim() : null);

function toInput(f: Form): BlogPostInput {
  return {
    slug: f.slug.trim(),
    title: f.title.trim(),
    dek: orNull(f.dek),
    description: f.description.trim(),
    body: f.body,
    tags: f.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
    keyword: orNull(f.keyword),
    cover: f.coverSrc.trim()
      ? { src: f.coverSrc.trim(), alt: f.coverAlt.trim(), width: Number(f.coverWidth) || 0, height: Number(f.coverHeight) || 0 }
      : null,
    faq: f.faq.filter((q) => q.question.trim() || q.answer.trim()),
    seoTitle: orNull(f.seoTitle),
    seoDescription: orNull(f.seoDescription),
    author: orNull(f.author),
  };
}

function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/, "");
}

const message = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : "Something went wrong.");

/** A character count against a recommended range and a hard limit. */
function Counter({ value, min, max, hard }: { value: string; min?: number; max: number; hard?: number }) {
  const n = value.trim().length;
  const over = hard !== undefined && n > hard;
  const outside = n > 0 && ((min !== undefined && n < min) || n > max);
  return (
    <span className={`text-[11px] tabular-nums ${over ? "text-danger-deep" : outside ? "text-warning-deep" : "text-muted-foreground"}`}>
      {n}
      {min !== undefined ? ` (aim ${min}–${max})` : ` / ${max}`}
    </span>
  );
}

function Field({ label, htmlFor, counter, hint, children }: { label: string; htmlFor: string; counter?: ReactNode; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={htmlFor}>{label}</Label>
        {counter}
      </div>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** How the post will look in Google's results: title, address, description. */
function SerpPreview({ form, siteUrl }: { form: Form; siteUrl: string }) {
  const title = form.seoTitle.trim() || `${form.title.trim() || "Post title"} | NoteFusion`;
  const description = form.seoDescription.trim() || form.description.trim() || "The description shows here.";
  return (
    <div className="rounded-lg border border-border bg-background p-3 font-sans">
      <p className="truncate text-[12px] text-muted-foreground">
        {siteUrl.replace(/^https?:\/\//, "")} › blog › {form.slug || "slug"}
      </p>
      <p className="truncate text-[17px] leading-snug text-[#1a0dab] dark:text-[#8ab4f8]" title={title}>
        {title.length > 60 ? `${title.slice(0, 59)}…` : title}
      </p>
      <p className="line-clamp-2 text-[13px] text-muted-foreground">{description.length > 160 ? `${description.slice(0, 157)}…` : description}</p>
    </div>
  );
}

const PREVIEW =
  "font-serif text-[15px] leading-relaxed text-foreground [&_a]:text-brand [&_a]:underline [&_a[data-external]]:text-warning-deep " +
  "[&_h1]:my-4 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-danger-deep [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-bold " +
  "[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 " +
  "[&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_table]:my-4 [&_table]:w-full [&_table]:text-sm [&_td]:border [&_td]:border-border " +
  "[&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left " +
  "[&_.pull-quote]:my-6 [&_.pull-quote]:border-l-4 [&_.pull-quote]:border-brand [&_.pull-quote]:pl-4 [&_.pull-quote]:text-lg [&_.pull-quote]:italic " +
  "[&_.callout]:my-5 [&_.callout]:rounded-md [&_.callout]:bg-brand/10 [&_.callout]:p-4 [&_.callout-label]:font-sans [&_.callout-label]:text-xs " +
  "[&_.callout-label]:font-semibold [&_.callout-label]:uppercase [&_.solfa-placeholder]:my-5 [&_.solfa-placeholder]:rounded-md " +
  "[&_.solfa-placeholder]:border [&_.solfa-placeholder]:border-dashed [&_.solfa-placeholder]:border-brand/50 [&_.solfa-placeholder]:p-4 " +
  "[&_.solfa-placeholder]:font-sans [&_.solfa-placeholder]:text-sm [&_.solfa-placeholder_span]:mr-2 [&_.solfa-placeholder_span]:rounded " +
  "[&_.solfa-placeholder_span]:bg-brand [&_.solfa-placeholder_span]:px-1.5 [&_.solfa-placeholder_span]:py-0.5 [&_.solfa-placeholder_span]:text-xs " +
  "[&_.solfa-placeholder_span]:text-white [&_.solfa-placeholder_small]:mt-1 [&_.solfa-placeholder_small]:block " +
  "[&_.solfa-placeholder_small]:text-muted-foreground [&_img]:max-w-full [&_img[data-missing-size]]:outline [&_img[data-missing-size]]:outline-2 " +
  "[&_img[data-missing-size]]:outline-danger [&_figcaption]:text-center [&_figcaption]:text-xs [&_figcaption]:text-muted-foreground " +
  "[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-xs [&_code]:font-mono";

export function BlogEditorView({ id }: { id: string | null }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const offset = getReportingOffset();

  const loaded = useQuery({ queryKey: ["blog-post", id], queryFn: ({ signal }) => getBlogPost(id!, signal), enabled: id !== null });
  const [post, setPost] = useState<BlogPost | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saved, setSaved] = useState<string>(JSON.stringify(toInput(EMPTY)));
  const [busy, setBusy] = useState<string | null>(null);
  const [scheduleAt, setScheduleAt] = useState("");
  const [clearNotes, setClearNotes] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);

  // Take the server's copy when it first arrives (and after every action that returns one).
  useEffect(() => {
    if (loaded.data && (!post || loaded.data.id !== post.id)) adopt(loaded.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded.data]);

  function adopt(p: BlogPost) {
    setPost(p);
    const f = fromPost(p);
    setForm(f);
    setSaved(JSON.stringify(toInput(f)));
    setClearNotes(false);
    queryClient.setQueryData(["blog-post", p.id], p);
    void queryClient.invalidateQueries({ queryKey: ["blog-posts"] });
    void queryClient.invalidateQueries({ queryKey: ["blog-site"] });
  }

  const input = useMemo(() => toInput(form), [form]);
  const dirty = JSON.stringify(input) !== saved || clearNotes;
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  // A new post's address follows its title until it is edited by hand.
  useEffect(() => {
    if (!id && !slugTouched) setForm((f) => ({ ...f, slug: slugify(f.title) }));
  }, [form.title, id, slugTouched]);

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const debouncedInput = useDebounced(input, 900);
  const checks = useQuery({
    queryKey: ["blog-check", id, debouncedInput],
    queryFn: ({ signal }) => checkBlogPost(id, debouncedInput, signal),
    enabled: debouncedInput.slug.length > 0 && debouncedInput.title.length > 0,
    staleTime: 60_000,
  });

  const debouncedBody = useDebounced(form.body, 300);
  const preview = useMemo(() => renderPreview(debouncedBody), [debouncedBody]);
  const words = useMemo(() => countWords(debouncedBody), [debouncedBody]);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    try {
      await action();
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(null);
    }
  }

  /** Saves the editor; returns the saved post (creating it the first time). */
  async function save(): Promise<BlogPost> {
    if (!post) {
      const created = await createBlogPost(input);
      adopt(created);
      router.replace(`/blog/${created.id}`);
      return created;
    }
    if (!dirty) return post;
    const updated = await updateBlogPost(post.id, post.version, input, clearNotes);
    adopt(updated);
    return updated;
  }

  const onSave = () =>
    run("save", async () => {
      await save();
      toast.success(post?.status === "Published" ? "Saved. The site will be rebuilt with the change." : "Saved.");
    });

  const onPublish = () =>
    run("publish", async () => {
      const current = await save();
      adopt(await publishBlogPost(current.id));
      toast.success("Published. The site is being rebuilt; the post is live in a few minutes.");
    });

  const onSchedule = () =>
    run("schedule", async () => {
      const at = new Date(scheduleAt);
      if (Number.isNaN(at.getTime())) throw new Error("Choose a date and time.");
      const current = await save();
      adopt(await scheduleBlogPost(current.id, at.toISOString()));
      toast.success(`Scheduled for ${formatInstantDateTime(at.toISOString(), offset)}.`);
    });

  const onUnpublish = () =>
    setConfirm({
      title: post?.status === "Scheduled" ? "Cancel the schedule?" : post?.status === "Archived" ? "Move back to drafts?" : "Take this post off the site?",
      body:
        post?.status === "Published"
          ? "It goes back to the drafts and the site is rebuilt without it. Links to it will stop working until you publish it again (its address and date are kept)."
          : "It goes back to the drafts.",
      confirmLabel: post?.status === "Published" ? "Unpublish" : "Move to drafts",
      tone: post?.status === "Published" ? "danger" : "default",
      onConfirm: async () => {
        adopt(await unpublishBlogPost(post!.id));
        toast.success("Moved to drafts.");
      },
    });

  const onArchive = () =>
    setConfirm({
      title: "Archive this post?",
      body: post?.status === "Published" ? "It comes off the site (which is rebuilt) and is kept here under Archived." : "It is kept here under Archived.",
      confirmLabel: "Archive",
      tone: post?.status === "Published" ? "danger" : "default",
      onConfirm: async () => {
        adopt(await archiveBlogPost(post!.id));
        toast.success("Archived.");
      },
    });

  const onDelete = () =>
    setConfirm({
      title: "Delete this post?",
      body: "It is removed for good. This cannot be undone.",
      confirmLabel: "Delete",
      tone: "danger",
      typeToConfirm: post!.slug,
      onConfirm: async () => {
        await deleteBlogPost(post!.id);
        void queryClient.invalidateQueries({ queryKey: ["blog-posts"] });
        toast.success("Deleted.");
        router.push("/blog");
      },
    });

  const onDuplicate = () =>
    run("duplicate", async () => {
      const copy = await duplicateBlogPost(post!.id);
      void queryClient.invalidateQueries({ queryKey: ["blog-posts"] });
      toast.success("Copied as a new draft.");
      router.push(`/blog/${copy.id}`);
    });

  if (id && loaded.error) return <ErrorView error={loaded.error} onRetry={() => void loaded.refetch()} />;
  if (id && !post) return <LoadingView label="Loading the post" />;

  const status = post?.status ?? "Draft";
  const blockers = checks.data?.blockers ?? [];
  const canPublish = status !== "Published" && form.title.trim() !== "" && form.slug.trim() !== "";
  const siteUrl = post?.url.replace(/\/blog\/.*$/, "") ?? "https://notefusion.studio";

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title={form.title.trim() || (post ? post.title : "New post")}
        breadcrumb={["Dashboard", "Blog", post ? "Edit" : "New"]}
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/blog">
                <ArrowLeft aria-hidden="true" /> All posts
              </Link>
            </Button>
            <Badge tone={STATUS_TONE[status]}>{dirty ? `${status} · unsaved` : status}</Badge>
            {status === "Published" && post && (
              <Button asChild variant="outline" size="sm">
                <a href={post.url} target="_blank" rel="noopener">
                  <ExternalLink aria-hidden="true" /> View on site
                </a>
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={onSave} disabled={busy !== null || (!dirty && post !== null) || !form.title.trim() || !form.slug.trim()}>
              {busy === "save" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
              {status === "Published" ? "Save and update the site" : "Save draft"}
            </Button>
            {canPublish && (
              <Button type="button" size="sm" onClick={onPublish} disabled={busy !== null || blockers.length > 0} title={blockers.length ? "Fix the blockers first" : undefined}>
                {busy === "publish" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
                Publish now
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ── The fields ───────────────────────────────────────────────────── */}
        <div className="space-y-5">
          <Card title="Headline" hint="What readers and search engines see first">
            <div className="space-y-4">
              <Field label="Title" htmlFor="title" counter={<Counter value={form.title} min={20} max={60} hard={120} />} hint="Under 60 characters keeps it whole in Google; put the search phrase in it naturally.">
                <Input id="title" value={form.title} maxLength={120} onChange={(e) => set("title", e.target.value)} />
              </Field>
              <Field label="Standfirst (the line under the title)" htmlFor="dek" counter={<Counter value={form.dek} max={240} hard={240} />} hint="Optional; the description stands in when empty.">
                <Textarea id="dek" rows={2} value={form.dek} maxLength={240} onChange={(e) => set("dek", e.target.value)} />
              </Field>
              <Field label="Description" htmlFor="description" counter={<Counter value={form.description} min={110} max={155} hard={160} />} hint="The summary in lists, the feed, social cards and (unless overridden below) search results.">
                <Textarea id="description" rows={3} value={form.description} maxLength={160} onChange={(e) => set("description", e.target.value)} />
              </Field>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-foreground">In Google</p>
                <SerpPreview form={form} siteUrl={siteUrl} />
              </div>
            </div>
          </Card>

          <Card title="Address and details">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Slug"
                htmlFor="slug"
                hint={post?.slugLocked ? "Published once, so the address stays: people and search engines link to it." : `notefusion.studio/blog/${form.slug || "…"}`}
              >
                <Input
                  id="slug"
                  value={form.slug}
                  disabled={post?.slugLocked ?? false}
                  onChange={(e) => {
                    setSlugTouched(true);
                    set("slug", e.target.value.toLowerCase());
                  }}
                  className="font-mono text-xs"
                />
              </Field>
              <Field label="Tags" htmlFor="tags" hint="Comma-separated, lowercase-hyphenated: tonic-solfa, choir. The first is the kicker.">
                <Input id="tags" value={form.tags} onChange={(e) => set("tags", e.target.value)} />
              </Field>
              <Field label="Target keyword" htmlFor="keyword" hint="For your tracking only.">
                <Input id="keyword" value={form.keyword} onChange={(e) => set("keyword", e.target.value)} />
              </Field>
              <Field label="Author" htmlFor="author" hint="An author on the site (content/authors).">
                <Input id="author" value={form.author} onChange={(e) => set("author", e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card title="Search result overrides" hint="Optional. Leave empty to use the title and description.">
            <div className="space-y-4">
              <Field label="SEO title (the whole <title>)" htmlFor="seoTitle" counter={<Counter value={form.seoTitle} max={60} hard={60} />}>
                <Input id="seoTitle" value={form.seoTitle} maxLength={60} onChange={(e) => set("seoTitle", e.target.value)} placeholder={`${form.title || "Title"} | NoteFusion`} />
              </Field>
              <Field label="SEO description" htmlFor="seoDescription" counter={<Counter value={form.seoDescription} min={110} max={155} hard={160} />}>
                <Textarea id="seoDescription" rows={2} value={form.seoDescription} maxLength={160} onChange={(e) => set("seoDescription", e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card title="Cover image" hint="Optional: shown over the post and as its social card (1200×630 is best).">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Image address" htmlFor="coverSrc" hint="/assets/blog/… or https://…">
                <Input id="coverSrc" value={form.coverSrc} onChange={(e) => set("coverSrc", e.target.value)} />
              </Field>
              <Field label="Alt text" htmlFor="coverAlt">
                <Input id="coverAlt" value={form.coverAlt} onChange={(e) => set("coverAlt", e.target.value)} />
              </Field>
              <Field label="Width" htmlFor="coverWidth">
                <Input id="coverWidth" type="number" value={form.coverWidth} onChange={(e) => set("coverWidth", e.target.value)} />
              </Field>
              <Field label="Height" htmlFor="coverHeight">
                <Input id="coverHeight" type="number" value={form.coverHeight} onChange={(e) => set("coverHeight", e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card
            title="Questions and answers"
            hint="Shown at the end of the post and as FAQ structured data. Three to eight is best."
            action={
              <Button type="button" variant="outline" size="xs" onClick={() => set("faq", [...form.faq, { question: "", answer: "" }])} disabled={form.faq.length >= 12}>
                <Plus aria-hidden="true" /> Add
              </Button>
            }
          >
            {form.faq.length === 0 ? (
              <p className="text-xs text-muted-foreground">No questions yet.</p>
            ) : (
              <ol className="space-y-4">
                {form.faq.map((q, i) => (
                  <li key={i} className="space-y-2 rounded-md border border-border p-3">
                    <div className="flex items-center gap-2">
                      <Input
                        aria-label={`Question ${i + 1}`}
                        value={q.question}
                        placeholder="The question, ending with ?"
                        onChange={(e) => set("faq", form.faq.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))}
                      />
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove question ${i + 1}`} onClick={() => set("faq", form.faq.filter((_, j) => j !== i))}>
                        <X aria-hidden="true" />
                      </Button>
                    </div>
                    <Textarea
                      aria-label={`Answer ${i + 1}`}
                      rows={2}
                      value={q.answer}
                      placeholder="One to three plain sentences. Links like [this](/hymns) are allowed."
                      onChange={(e) => set("faq", form.faq.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))}
                    />
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card title="Body" hint={`${words.toLocaleString("en-GB")} words (not counting solfa blocks) · ${Math.max(1, Math.ceil(words / 200))} min read`}>
            <Textarea
              aria-label="Body (Markdown)"
              value={form.body}
              onChange={(e) => set("body", e.target.value)}
              rows={32}
              spellCheck
              className="font-mono text-[13px] leading-relaxed"
            />
            <p className="mt-2 text-[11px] text-muted-foreground">
              Markdown. Sections start at ## (the title is the page&apos;s only h1). Solfa examples are ```solfa blocks naming a
              hymn (<code>hymn: amazing-grace</code>, <code>bars: 1-5</code>, <code>key: F major</code>) or a scale (
              <code>scale: A minor</code>); never type solfa by hand. Images need their size: <code>![alt](/assets/blog/x.jpg &quot;1200x675&quot;)</code>.
              <code>&gt; [!TIP]</code> makes a callout. Link only to pages on the site.
            </p>
          </Card>
        </div>

        {/* ── Checks, publishing and the preview ───────────────────────────── */}
        <div className="space-y-5 xl:sticky xl:top-20 xl:self-start">
          <Card
            title="Checks"
            info="Blockers would stop the site's build and keep the post from publishing. Advice is what the drafter's checks look for: length, sections, FAQ, no invented numbers or quotes, no hand-written solfa, links only to the site."
            action={checks.isFetching ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Checking" /> : undefined}
          >
            {!checks.data ? (
              <p className="text-xs text-muted-foreground">{form.title && form.slug ? "Checking…" : "Give the post a title to check it."}</p>
            ) : (
              <div className="space-y-3 text-xs">
                {!checks.data.checkedAgainstSite && (
                  <p className="text-warning-deep">The site&apos;s catalogue could not be read, so hymns and links were not checked.</p>
                )}
                {blockers.length === 0 ? (
                  <p className="font-medium text-success-deep">Ready to publish: nothing would stop the build.</p>
                ) : (
                  <div>
                    <p className="font-semibold text-danger-deep">Fix before publishing</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-danger-deep">
                      {blockers.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {checks.data.advice.length > 0 && (
                  <div>
                    <p className="font-semibold text-foreground">Advice</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
                      {checks.data.advice.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Card>

          {post && (
            <Card title="Publishing">
              <div className="space-y-3 text-xs">
                <p className="text-muted-foreground">
                  {status === "Published" && post.publishedAtUtc && `Live since ${formatInstantDateTime(post.publishedAtUtc, offset)}. `}
                  {status === "Scheduled" && post.publishAtUtc && `Goes live ${formatInstantDateTime(post.publishAtUtc, offset)}. `}
                  {post.revisedAtUtc && `Updated ${formatInstantDateTime(post.revisedAtUtc, offset)}. `}
                  Last saved {formatInstantDateTime(post.updatedAtUtc, offset)}.
                </p>
                {status !== "Published" && (
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="scheduleAt" className="text-xs">
                        Schedule for (your time)
                      </Label>
                      <Input id="scheduleAt" type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} className="h-8 text-xs" />
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={onSchedule} disabled={busy !== null || !scheduleAt || blockers.length > 0}>
                      {busy === "schedule" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <CalendarClock aria-hidden="true" />}
                      Schedule
                    </Button>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {status !== "Draft" && (
                    <Button type="button" variant="outline" size="sm" onClick={onUnpublish} disabled={busy !== null}>
                      <Undo2 aria-hidden="true" /> {status === "Published" ? "Unpublish" : status === "Scheduled" ? "Cancel schedule" : "Move to drafts"}
                    </Button>
                  )}
                  {status !== "Archived" && (
                    <Button type="button" variant="outline" size="sm" onClick={onArchive} disabled={busy !== null}>
                      <Archive aria-hidden="true" /> Archive
                    </Button>
                  )}
                  <Button type="button" variant="outline" size="sm" onClick={onDuplicate} disabled={busy !== null}>
                    <Copy aria-hidden="true" /> Duplicate
                  </Button>
                  {status !== "Published" && (
                    <Button type="button" variant="ghost" size="sm" onClick={onDelete} disabled={busy !== null} className="text-danger-deep">
                      <Trash2 aria-hidden="true" /> Delete
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          )}

          {post && post.source === "Gemini" && (
            <Card title="How it was drafted" hint={post.generationModel ?? "Gemini"}>
              <div className="space-y-3 text-xs">
                <ul className="space-y-0.5 tabular-nums text-muted-foreground">
                  {post.generationUsage.map((u, i) => (
                    <li key={i}>{usageLine(u)}</li>
                  ))}
                  <li className="font-medium text-foreground">Total: {tokens(post.generationUsage.reduce((n, u) => n + u.total, 0))} tokens</li>
                </ul>
                {post.reviewNotes.length > 0 && (
                  <div>
                    <p className="font-semibold text-warning-deep">What the checks still found when it was drafted</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-warning-deep">
                      {post.reviewNotes.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                    <label className="mt-2 flex items-center gap-2 text-foreground">
                      <input type="checkbox" checked={clearNotes} onChange={(e) => setClearNotes(e.target.checked)} />
                      I have dealt with these (cleared on the next save)
                    </label>
                  </div>
                )}
              </div>
            </Card>
          )}

          <Card title="Preview" hint="Roughly as on the site. Solfa blocks are written out by the engine when the site is built.">
            <article className="max-h-[80vh] overflow-y-auto pr-1">
              <p className="font-sans text-[11px] font-semibold uppercase tracking-wide text-brand">{input.tags[0]?.replace(/-/g, " ") ?? "tag"}</p>
              <h1 className="mt-1 font-serif text-3xl font-bold leading-tight text-foreground">{form.title || "Title"}</h1>
              <p className="mt-2 font-serif text-lg text-muted-foreground">{form.dek || form.description}</p>
              {preview.toc.filter((t) => t.depth === 2).length >= 4 && (
                <nav className="my-4 rounded-md border border-border p-3 font-sans text-xs">
                  <p className="font-semibold">In this article</p>
                  <ol className="mt-1 list-decimal pl-5">
                    {preview.toc.filter((t) => t.depth === 2).map((t) => (
                      <li key={t.id}>{t.text}</li>
                    ))}
                  </ol>
                </nav>
              )}
              <div className={PREVIEW} dangerouslySetInnerHTML={{ __html: preview.html }} />
              {input.faq.length > 0 && (
                <section className="mt-8 border-t border-border pt-4">
                  <h2 className="font-serif text-xl font-bold">Frequently asked questions</h2>
                  {input.faq.map((f, i) => (
                    <div key={i} className="mt-3">
                      <h3 className="font-serif font-semibold">{f.question}</h3>
                      <p className={PREVIEW} dangerouslySetInnerHTML={{ __html: renderInlinePreview(f.answer) }} />
                    </div>
                  ))}
                </section>
              )}
            </article>
          </Card>
        </div>
      </div>

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
