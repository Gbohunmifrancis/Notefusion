/**
 * The Traffic page's two calls, `GET /api/admin/analytics/traffic` (and its `/live`), and their wire types. Kept apart
 * from `endpoints.ts`/`types.ts` so the page is a single self-contained feature; the shapes mirror the C#
 * `TrafficDtos` exactly (camelCase).
 */
import { query, request } from "@/api/client";

/** The filters a visit can be picked by, as the API names them. */
export type TrafficFilterKey =
  | "page"
  | "entry"
  | "exit"
  | "source"
  | "utmSource"
  | "utmMedium"
  | "utmCampaign"
  | "ref"
  | "country"
  | "browser"
  | "os"
  | "device";

export type TrafficFilters = Partial<Record<TrafficFilterKey, string>>;

export interface TrafficSummary {
  visitors: number;
  visitorsPrevious: number;
  visits: number;
  visitsPrevious: number;
  pageviews: number;
  pageviewsPrevious: number;
  viewsPerVisit: number | null;
  viewsPerVisitPrevious: number | null;
  /** 0–1: visits that viewed one page and clicked or did nothing. */
  bounceRate: number | null;
  bounceRatePrevious: number | null;
  avgVisitSeconds: number | null;
  avgVisitSecondsPrevious: number | null;
}

/** `at` is a reporting-local date at midnight, or a local hour when the series is hourly (no zone). */
export interface TrafficPoint {
  at: string;
  visitors: number;
  pageviews: number;
}

/** `count` is page views on the page lists, visits on every other list. */
export interface TrafficRow {
  label: string;
  visitors: number;
  count: number;
}

export interface TrafficGoal {
  kind: "action" | "click";
  name: string;
  visitors: number;
  count: number;
  rate: number | null;
}

export interface Traffic {
  fromUtc: string;
  toUtc: string;
  reportingOffsetMinutes: number;
  hourly: boolean;
  filters: TrafficFilters;
  summary: TrafficSummary;
  series: TrafficPoint[];
  sources: TrafficRow[];
  utmSources: TrafficRow[];
  utmMediums: TrafficRow[];
  utmCampaigns: TrafficRow[];
  refLinks: TrafficRow[];
  pages: TrafficRow[];
  entryPages: TrafficRow[];
  exitPages: TrafficRow[];
  countries: TrafficRow[];
  browsers: TrafficRow[];
  systems: TrafficRow[];
  devices: TrafficRow[];
  goals: TrafficGoal[];
  truncated: boolean;
}

export interface TrafficLive {
  minutes: number;
  visitors: number;
  pages: TrafficRow[];
}

export const getTraffic = (from: string | undefined, to: string | undefined, filters: TrafficFilters, signal?: AbortSignal) =>
  request<Traffic>(`/api/admin/analytics/traffic${query({ from, to, ...filters })}`, signal ? { signal } : {});

export const getTrafficLive = (signal?: AbortSignal) =>
  request<TrafficLive>("/api/admin/analytics/traffic/live", signal ? { signal } : {});
