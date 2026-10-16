/**
 * The blog: wire types and calls. The types mirror `src/NoteFusion.Application/Blog/Dtos/BlogDtos.cs`
 * (camelCase); statuses and sources arrive as the C# enum names (`.ToString()`). Change both together.
 *
 * Posts are written, checked and published here; publishing asks GitHub to rebuild notefusion.studio,
 * whose build reads the live posts from `GET /api/blog/published`.
 */

import { query, request } from "@/api/client";
import type { PagedResult } from "@/api/types";

export type BlogPostStatus = "Draft" | "Scheduled" | "Published" | "Archived";
export type BlogPostSource = "Manual" | "Gemini" | "Imported";

export interface BlogFaq {
  question: string;
  answer: string;
}

export interface BlogCover {
  src: string;
  alt: string;
  width: number;
  height: number;
}

export interface BlogTokenUsage {
  /** "Draft" or "Revision". */
  call: string;
  prompt: number;
  output: number;
  thinking: number;
  cached: number;
  total: number;
}

export interface BlogPostRow {
  id: string;
  slug: string;
  title: string;
  status: BlogPostStatus;
  source: BlogPostSource;
  tags: string[];
  publishAtUtc: string | null;
  publishedAtUtc: string | null;
  updatedAtUtc: string;
  createdAtUtc: string;
  words: number;
  reviewNotes: number;
  generationModel: string | null;
  totalTokens: number;
  /** "/blog/{slug}". */
  path: string;
}

export interface BlogPost {
  id: string;
  slug: string;
  /** True once the post has been published: its URL never changes after that. */
  slugLocked: boolean;
  title: string;
  dek: string | null;
  description: string;
  body: string;
  tags: string[];
  keyword: string | null;
  cover: BlogCover | null;
  faq: BlogFaq[];
  seoTitle: string | null;
  seoDescription: string | null;
  author: string;
  status: BlogPostStatus;
  source: BlogPostSource;
  publishAtUtc: string | null;
  publishedAtUtc: string | null;
  revisedAtUtc: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
  topicId: string | null;
  generationModel: string | null;
  generationUsage: BlogTokenUsage[];
  reviewNotes: string[];
  words: number;
  /** Sent back with a save; an older one is a 409 BLOG_POST_CHANGED. */
  version: number;
  path: string;
  /** The live address on notefusion.studio. */
  url: string;
}

/** `BlogPostInput`: what the editor sends to create, save or check a post. */
export interface BlogPostInput {
  slug: string;
  title: string;
  dek: string | null;
  description: string;
  body: string;
  tags: string[];
  keyword: string | null;
  cover: BlogCover | null;
  faq: BlogFaq[];
  seoTitle: string | null;
  seoDescription: string | null;
  author: string | null;
}

export interface BlogPostCheck {
  /** What would stop the site's build: publishing is refused until these are fixed. */
  blockers: string[];
  /** The drafter's quality checks: shown, not enforced. */
  advice: string[];
  /** False when the site's catalogue could not be read (hymns and links were not checked). */
  checkedAgainstSite: boolean;
}

export type BlogTopicStatus = "Unused" | "Used" | "Skipped";

export interface BlogTopic {
  id: string;
  slug: string;
  keyword: string;
  intent: string;
  angle: string;
  links: string[];
  status: BlogTopicStatus;
  position: number;
  postId: string | null;
  updatedAtUtc: string;
}

export interface BlogTopicInput {
  slug: string;
  keyword: string;
  intent: string | null;
  angle: string | null;
  links: string[];
  position: number | null;
  status: BlogTopicStatus | null;
}

export type BlogGenerationStatus = "Queued" | "Running" | "Succeeded" | "Partial" | "Failed";

export interface BlogGenerationItem {
  slug: string;
  keyword: string;
  topicId: string | null;
  postId: string | null;
  title: string | null;
  passedChecks: boolean;
  problems: string[];
  error: string | null;
  usage: BlogTokenUsage[];
}

export interface BlogGenerationRun {
  id: string;
  trigger: "Admin" | "Schedule";
  status: BlogGenerationStatus;
  count: number;
  topicText: string | null;
  topicId: string | null;
  model: string | null;
  items: BlogGenerationItem[];
  totalTokens: number;
  error: string | null;
  createdAtUtc: string;
  startedAtUtc: string | null;
  finishedAtUtc: string | null;
}

export interface BlogDeployRun {
  /** GitHub's run status: "queued" | "in_progress" | "completed" … */
  status: string;
  /** "success" | "failure" | "cancelled" … once completed. */
  conclusion: string | null;
  url: string;
  createdAtUtc: string;
  event: string;
}

export interface BlogSiteStatus {
  rebuildsEnabled: boolean;
  rebuildTarget: string | null;
  draftingEnabled: boolean;
  model: string;
  siteUrl: string;
  pendingRebuilds: number;
  lastRequestedAtUtc: string | null;
  lastDispatchedAtUtc: string | null;
  lastError: string | null;
  latestDeploy: BlogDeployRun | null;
  autoDraftSchedule: string | null;
  /** A Gemini draft that passes every check goes live by itself; one with problems left waits here. */
  autoPublishDrafts: boolean;
}

export const isFinished = (run: BlogGenerationRun) =>
  run.status === "Succeeded" || run.status === "Partial" || run.status === "Failed";

/* ── Calls ─────────────────────────────────────────────────────────────────── */

const opts = (signal?: AbortSignal) => (signal ? { signal } : {});

export interface BlogPostFilter {
  status?: BlogPostStatus | undefined;
  source?: BlogPostSource | undefined;
  q?: string | undefined;
}

export const getBlogPosts = (page: number, pageSize: number, f: BlogPostFilter, signal?: AbortSignal) =>
  request<PagedResult<BlogPostRow>>(`/api/admin/blog/posts${query({ page, pageSize, ...f })}`, opts(signal));

export const getBlogPost = (id: string, signal?: AbortSignal) =>
  request<BlogPost>(`/api/admin/blog/posts/${id}`, opts(signal));

export const createBlogPost = (post: BlogPostInput) =>
  request<BlogPost>("/api/admin/blog/posts", { method: "POST", body: post });

/** `version` is the one the editor opened; a newer save on the server is a 409 BLOG_POST_CHANGED. */
export const updateBlogPost = (id: string, version: number, post: BlogPostInput, clearReviewNotes = false) =>
  request<BlogPost>(`/api/admin/blog/posts/${id}`, { method: "PUT", body: { version, post, clearReviewNotes } });

export const deleteBlogPost = (id: string) => request<void>(`/api/admin/blog/posts/${id}`, { method: "DELETE" });

export const duplicateBlogPost = (id: string) =>
  request<BlogPost>(`/api/admin/blog/posts/${id}/duplicate`, { method: "POST" });

/** The checks on the editor's fields as they stand (saved or not). */
export const checkBlogPost = (id: string | null, post: BlogPostInput, signal?: AbortSignal) =>
  request<BlogPostCheck>("/api/admin/blog/posts/check", { method: "POST", body: { id, post }, ...opts(signal) });

export const publishBlogPost = (id: string) =>
  request<BlogPost>(`/api/admin/blog/posts/${id}/publish`, { method: "POST" });

export const scheduleBlogPost = (id: string, publishAtUtc: string) =>
  request<BlogPost>(`/api/admin/blog/posts/${id}/schedule`, { method: "POST", body: { publishAtUtc } });

export const unpublishBlogPost = (id: string) =>
  request<BlogPost>(`/api/admin/blog/posts/${id}/unpublish`, { method: "POST" });

export const archiveBlogPost = (id: string) =>
  request<BlogPost>(`/api/admin/blog/posts/${id}/archive`, { method: "POST" });

export const getBlogTopics = (signal?: AbortSignal) => request<BlogTopic[]>("/api/admin/blog/topics", opts(signal));

export const createBlogTopic = (topic: BlogTopicInput) =>
  request<BlogTopic>("/api/admin/blog/topics", { method: "POST", body: topic });

export const updateBlogTopic = (id: string, topic: BlogTopicInput) =>
  request<BlogTopic>(`/api/admin/blog/topics/${id}`, { method: "PUT", body: topic });

export const deleteBlogTopic = (id: string) => request<void>(`/api/admin/blog/topics/${id}`, { method: "DELETE" });

/** Queues a batch of Gemini drafts and returns it at once; poll `getBlogGeneration` for progress. */
export const generateBlogDrafts = (count: number, topicId?: string | null, topic?: string | null) =>
  request<BlogGenerationRun>("/api/admin/blog/generate", {
    method: "POST",
    body: { count, topicId: topicId ?? null, topic: topic ?? null },
  });

export const getBlogGenerations = (take = 20, signal?: AbortSignal) =>
  request<BlogGenerationRun[]>(`/api/admin/blog/generations${query({ take })}`, opts(signal));

export const getBlogGeneration = (id: string, signal?: AbortSignal) =>
  request<BlogGenerationRun>(`/api/admin/blog/generations/${id}`, opts(signal));

export const getBlogSiteStatus = (signal?: AbortSignal) => request<BlogSiteStatus>("/api/admin/blog/site", opts(signal));

export const requestBlogRebuild = () => request<void>("/api/admin/blog/site/rebuild", { method: "POST" });

/**
 * Readers per page, from the same public endpoint the site's byline uses (customers only, cached five
 * minutes): `{ "/blog/a": 123 }`. At most 50 paths a call.
 */
export const getBlogReads = (paths: string[], signal?: AbortSignal) =>
  request<Record<string, number>>(`/api/blog/reads${query({ paths: paths.join(",") })}`, { anonymous: true, ...opts(signal) });
