/**
 * The Blog analytics page's one call, `GET /api/admin/analytics/blog`, and its wire types. Kept apart from
 * `endpoints.ts`/`types.ts` so the page is a single self-contained feature; the shapes mirror the C#
 * `BlogAnalyticsDtos` exactly (camelCase).
 */
import { query, request } from "@/api/client";

/** One step of the blog → product funnel, counted over the window's new blog visitors. */
export interface BlogFunnelStage {
  /** visitors, readers, cta, app, signup, transcribed, paid */
  key: string;
  label: string;
  count: number;
  /** The step leans on a join that can miss (another device, the phone app): read it as a floor. */
  approximate: boolean;
  /** How a visitor is tied to this step, in a sentence. */
  join: string;
}

export interface BlogKpis {
  views: number;
  visitors: number;
  newVisitors: number;
  readers: number;
  readRate: number | null;
  completeReads: number;
  avgActiveSeconds: number | null;
  ctaClicks: number;
  signupsFromBlog: number;
  transcribersFromBlog: number;
  payersFromBlog: number;
  assistedSignups: number;
  assistedTranscribers: number;
  assistedPayers: number;
}

export interface BlogPostRow {
  path: string;
  /** "post", "hymn" or "index" */
  kind: string;
  views: number;
  visitors: number;
  reads: number;
  readers: number;
  readRate: number | null;
  completeReads: number;
  avgActiveSeconds: number | null;
  ctaClicks: number;
  shares: number;
  hymnPlays: number;
  /** New visitors whose first blog page was this one. */
  entryVisitors: number;
  signups: number;
  transcribers: number;
  payers: number;
}

export interface BlogSourceRow {
  /** search, social, direct, internal, other */
  source: string;
  visitors: number;
  readers: number;
  signups: number;
  transcribers: number;
}

export interface BlogEntryRow {
  path: string;
  visitors: number;
  signups: number;
  transcribers: number;
  payers: number;
}

export interface BlogAnalytics {
  fromUtc: string;
  toUtc: string;
  reportingOffsetMinutes: number;
  attributionWindowDays: number;
  kpis: BlogKpis;
  funnel: BlogFunnelStage[];
  posts: BlogPostRow[];
  sources: BlogSourceRow[];
  topEntries: BlogEntryRow[];
  campaigns: { campaign: string; visitors: number; signups: number }[];
  shares: { network: string; count: number }[];
  /** Reporting-local dates; `signups` are accounts created that day after a blog visit (assisted). */
  daily: { date: string; views: number; reads: number; signups: number }[];
}

export const getBlogAnalytics = (from?: string, to?: string, signal?: AbortSignal) =>
  request<BlogAnalytics>(`/api/admin/analytics/blog${query({ from, to })}`, signal ? { signal } : {});
