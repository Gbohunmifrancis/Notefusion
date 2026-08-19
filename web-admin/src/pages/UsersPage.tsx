import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { getUsers } from "@/api/endpoints";
import type { AdminUserRow, PagedResult } from "@/api/types";
import { Avatar } from "@/components/Avatar";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { StateView } from "@/components/StateView";
import { formatCount, formatInstantDate, formatInstantDateTime } from "@/lib/format";
import { getReportingOffset } from "@/lib/reporting";
import { TD, TH, THEAD_TR, TR } from "@/lib/tableClasses";
import { useAsync, useDebounced } from "@/lib/useAsync";

const PAGE_SIZE = 25;

const TONES = {
  neutral: "bg-surface-alt text-muted",
  blue: "bg-blue/10 text-blue-deep",
  success: "bg-success/10 text-success",
  danger: "bg-danger/10 text-danger",
} as const;

function Badge({
  children,
  tone = "neutral",
}: {
  children: string;
  tone?: keyof typeof TONES;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-[6px] px-2 py-[3px] text-[11px] font-semibold ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function UsersPage() {
  // The sidebar's search box navigates here with `?q=`, so the URL seeds the field and
  // overrides it on every later navigation. Typing stays local: writing a history entry per
  // keystroke would make the back button useless.
  const [params] = useSearchParams();
  const incoming = params.get("q") ?? "";
  const [search, setSearch] = useState(incoming);
  useEffect(() => setSearch(incoming), [incoming]);

  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounced(search);

  // A new search starts at the beginning; page 4 of the old query means nothing for the new one.
  useEffect(() => setPage(1), [debouncedSearch]);

  const fetcher = useCallback(
    (signal: AbortSignal) => getUsers(page, PAGE_SIZE, debouncedSearch.trim(), signal),
    [page, debouncedSearch],
  );
  const state = useAsync<PagedResult<AdminUserRow>>(fetcher);

  // Timestamps are shown in the same zone the overview buckets days in, so the two pages
  // never disagree about which day something happened on.
  const offset = getReportingOffset();

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader title="Users" breadcrumb={["Dashboard", "Users"]} />

      <Card
        title="All accounts"
        hint="Newest first. This view carries personal data — treat it accordingly."
        bleed
        action={
          <label className="relative block">
            <span className="sr-only">Search by name or email</span>
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name or email"
              className="w-56 rounded-sm border border-border bg-surface py-1.5 pl-9 pr-3 text-[13px] text-ink outline-none transition focus:border-blue"
            />
          </label>
        }
      >
        <StateView
          state={state}
          isEmpty={(data) => data.items.length === 0}
          emptyMessage={debouncedSearch ? "No accounts match that search" : "No accounts yet"}
          loadingLabel="Loading accounts"
        >
          {(data) => (
            <>
              <div className="overflow-x-auto border-t border-border">
                <table className="w-full min-w-[56rem]">
                  <thead>
                    <tr className={THEAD_TR}>
                      <th className={TH}>Account</th>
                      <th className={TH}>Role</th>
                      <th className={TH}>Sign-in</th>
                      <th className={TH}>Status</th>
                      <th className={`${TH} text-right`}>Transcriptions</th>
                      <th className={TH}>Joined</th>
                      <th className={TH}>Last sign-in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((user) => (
                      <tr key={user.id} className={TR}>
                        <td className={TD}>
                          <div className="flex items-center gap-3">
                            <Avatar name={user.fullName} size={34} />
                            <div className="min-w-0">
                              <p className="truncate font-medium text-ink">{user.fullName}</p>
                              <p className="truncate text-[11px] text-faint">{user.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className={TD}>
                          <Badge tone={user.role === "Admin" ? "blue" : "neutral"}>
                            {user.role}
                          </Badge>
                        </td>
                        <td className={TD}>
                          <span className="flex flex-wrap gap-1">
                            {user.hasGoogle && <Badge tone="blue">Google</Badge>}
                            {user.hasPassword && <Badge>Password</Badge>}
                            {/* Neither flag set would mean an account that cannot sign in at
                                all, which is worth seeing rather than rendering as blank. */}
                            {!user.hasGoogle && !user.hasPassword && (
                              <Badge tone="danger">No method</Badge>
                            )}
                          </span>
                        </td>
                        <td className={TD}>
                          {user.isActive ? (
                            <Badge tone="success">Active</Badge>
                          ) : (
                            <Badge tone="danger">Deactivated</Badge>
                          )}
                        </td>
                        <td className={`${TD} text-right tabular-nums`}>
                          {formatCount(user.transcriptionCount)}
                        </td>
                        <td className={`${TD} whitespace-nowrap`}>
                          {formatInstantDate(user.createdAt, offset)}
                        </td>
                        <td className={`${TD} whitespace-nowrap`}>
                          {/* Null means never signed in since the column existed, not "today". */}
                          {formatInstantDateTime(user.lastLoginAt, offset)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3.5">
                <p className="text-xs text-muted">
                  Showing{" "}
                  <span className="font-medium text-ink">
                    {formatCount((data.page - 1) * data.pageSize + 1)}
                  </span>{" "}
                  to{" "}
                  <span className="font-medium text-ink">
                    {formatCount(Math.min(data.page * data.pageSize, data.totalCount))}
                  </span>{" "}
                  of <span className="font-medium text-ink">{formatCount(data.totalCount)}</span>
                </p>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={data.page <= 1 || state.loading}
                    className="grid h-8 w-8 place-items-center rounded-sm border border-border text-muted transition hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Previous page"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="text-xs tabular-nums text-muted">
                    Page {data.page} of {Math.max(data.totalPages, 1)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((current) => current + 1)}
                    disabled={data.page >= data.totalPages || state.loading}
                    className="grid h-8 w-8 place-items-center rounded-sm border border-border text-muted transition hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Next page"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </footer>
            </>
          )}
        </StateView>
      </Card>
    </div>
  );
}
