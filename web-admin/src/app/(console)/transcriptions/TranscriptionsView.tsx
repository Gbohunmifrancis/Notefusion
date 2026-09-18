"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { getAdminTranscriptions } from "@/api/endpoints";
import { StateView } from "@/components/StateView";
import { Badge } from "@/components/Badge";
import { Input } from "@/components/ui/input";
import { formatInstantDateTime } from "@/lib/format";
import { getReportingOffset } from "@/lib/reporting";
import { useClampPage } from "@/lib/useClampPage";
import { useDebounced } from "@/lib/useDebounced";

const PAGE_SIZE = 15;

export function TranscriptionsView() {
  const params = useSearchParams();
  const incoming = params.get("q") ?? "";
  const [search, setSearch] = useState(incoming);
  useEffect(() => setSearch(incoming), [incoming]);

  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounced(search);

  useEffect(() => setPage(1), [debouncedSearch, status]);

  const term = debouncedSearch.trim();
  const state = useQuery({
    queryKey: ["transcriptions", page, term, status],
    queryFn: ({ signal }) =>
      getAdminTranscriptions(page, PAGE_SIZE, status === "all" ? undefined : status, term, signal),
    placeholderData: keepPreviousData,
  });

  useClampPage(page, state.data?.totalPages, setPage);
  const offset = getReportingOffset();

  const items = state.data?.items ?? [];
  const totalCount = state.data?.totalCount ?? 0;
  const totalPages = Math.max(1, state.data?.totalPages ?? 1);
  const startItem = totalCount > 0 ? (page - 1) * PAGE_SIZE + 1 : 0;
  const endItem = Math.min(page * PAGE_SIZE, totalCount);

  const pageNumbers = useMemo(() => {
    const list: number[] = [];
    const max = Math.min(totalPages, 5);
    for (let i = 1; i <= max; i++) list.push(i);
    return list;
  }, [totalPages]);

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Transcriptions</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Monitor ML quality and user transcription outputs globally.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-xs">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by title or email..."
            className="h-9 w-full rounded-lg border border-slate-200/90 bg-white pl-9 text-xs shadow-xs placeholder:text-slate-400 focus:border-[#2563EB] dark:border-zinc-800 dark:bg-[#09090b] dark:text-white"
          />
        </div>

        <div className="flex items-center gap-2.5">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-9 rounded-lg border border-slate-200/90 bg-white px-3 text-xs font-medium text-slate-700 shadow-xs outline-none dark:border-zinc-800 dark:bg-[#09090b] dark:text-zinc-200"
          >
            <option value="all">All status</option>
            <option value="Completed">Completed</option>
            <option value="Failed">Failed</option>
            <option value="Processing">Processing</option>
          </select>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200/80 bg-white shadow-xs dark:border-zinc-800 dark:bg-[#09090b] overflow-hidden">
        <StateView
          state={state}
          isEmpty={() => items.length === 0}
          emptyMessage={term ? "No transcriptions match that search" : "No transcriptions found"}
          loadingLabel="Loading transcriptions"
        >
          {() => (
            <>
              <div className="w-full min-w-0 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-100 bg-slate-50/50 text-slate-500 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
                    <tr>
                      <th className="px-4 py-3 font-medium">When</th>
                      <th className="px-4 py-3 font-medium">User</th>
                      <th className="px-4 py-3 font-medium">Title</th>
                      <th className="px-4 py-3 font-medium">Key</th>
                      <th className="px-4 py-3 font-medium">Tempo</th>
                      <th className="px-4 py-3 font-medium">Confidence</th>
                      <th className="px-4 py-3 text-right font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-zinc-800">
                    {items.map((t) => (
                      <tr
                        key={t.id}
                        className="transition hover:bg-slate-50/70 dark:hover:bg-zinc-900/60"
                      >
                        <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                          {formatInstantDateTime(t.createdAtUtc, offset)}
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/users/${t.userId}`}
                            className="font-medium text-slate-900 transition hover:text-[#2563EB] dark:text-slate-100 dark:hover:text-blue-400"
                          >
                            {t.userEmail}
                          </Link>
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                          {t.title || "Untitled"}
                        </td>
                        <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{t.key || "—"}</td>
                        <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{t.tempoBpm > 0 ? `${t.tempoBpm} BPM` : "—"}</td>
                        <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{Math.round(t.overallConfidence * 100)}%</td>
                        <td className="px-4 py-3 text-right">
                          <Badge
                            tone={
                              t.status.toLowerCase() === "completed"
                                ? "success"
                                : t.status.toLowerCase() === "failed"
                                ? "danger"
                                : "neutral"
                            }
                          >
                            {t.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-slate-100 px-5 py-3.5 dark:border-zinc-800">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Showing {startItem}-{endItem} of {totalCount} transcriptions
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  {pageNumbers.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPage(p)}
                      className={`flex h-7 w-7 items-center justify-center rounded-md text-xs font-semibold transition ${
                        page === p
                          ? "bg-[#2563EB] text-white"
                          : "text-slate-600 hover:bg-slate-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </>
          )}
        </StateView>
      </div>
    </div>
  );
}

