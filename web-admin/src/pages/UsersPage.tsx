import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getUsers } from "@/api/endpoints";
import type { AdminUserRow, PagedResult } from "@/api/types";
import { Card } from "@/components/Card";
import { StateView } from "@/components/StateView";
import { formatCount, formatInstantDate, formatInstantDateTime } from "@/lib/format";
import { getReportingOffset } from "@/lib/reporting";
import { useAsync, useDebounced } from "@/lib/useAsync";

const PAGE_SIZE = 25;

function Badge({ children, tone = "neutral" }: { children: string; tone?: "neutral" | "blue" | "success" | "danger" }) {
  const tones = {
    neutral: "bg-surface-alt text-muted",
    blue: "bg-blue/10 text-blue-deep",
    success: "bg-success/10 text-success",
    danger: "bg-danger/10 text-danger",
  } as const;

  return (
    <span
      className={`inline-flex items-center rounded-pill px-2 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function UsersPage() {
  const [search, setSearch] = useState("");
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
    <div className="animate-fade-in space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink">Users</h1>
        <p className="mt-1 text-sm text-muted">
          Accounts newest first. This view carries personal data — treat it accordingly.
        </p>
      </header>

      <Card
        title="All accounts"
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
              className="w-56 rounded-pill border border-border bg-surface py-1.5 pl-9 pr-3 text-sm text-ink outline-none transition focus:border-blue"
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
              <div className="overflow-x-auto">
                <table className="w-full min-w-[52rem] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                      <th className="py-2 pr-4 font-semibold">Account</th>
                      <th className="py-2 pr-4 font-semibold">Role</th>
                      <th className="py-2 pr-4 font-semibold">Sign-in</th>
                      <th className="py-2 pr-4 font-semibold">Status</th>
                      <th className="py-2 pr-4 text-right font-semibold">Transcriptions</th>
                      <th className="py-2 pr-4 font-semibold">Joined</th>
                      <th className="py-2 font-semibold">Last sign-in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((user) => (
                      <tr
                        key={user.id}
                        className="border-b border-border-light last:border-0 hover:bg-surface-alt/60"
                      >
                        <td className="py-3 pr-4">
                          <p className="font-medium text-ink">{user.fullName}</p>
                          <p className="text-xs text-muted">{user.email}</p>
                        </td>
                        <td className="py-3 pr-4">
                          <Badge tone={user.role === "Admin" ? "blue" : "neutral"}>
                            {user.role}
                          </Badge>
                        </td>
                        <td className="py-3 pr-4">
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
                        <td className="py-3 pr-4">
                          {user.isActive ? (
                            <Badge tone="success">Active</Badge>
                          ) : (
                            <Badge tone="danger">Deactivated</Badge>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums text-muted">
                          {formatCount(user.transcriptionCount)}
                        </td>
                        <td className="py-3 pr-4 whitespace-nowrap text-muted">
                          {formatInstantDate(user.createdAt, offset)}
                        </td>
                        <td className="py-3 whitespace-nowrap text-muted">
                          {/* Null means never signed in since the column existed, not "today". */}
                          {formatInstantDateTime(user.lastLoginAt, offset)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
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
                    className="grid h-8 w-8 place-items-center rounded-md border border-border text-muted transition hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-40"
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
                    className="grid h-8 w-8 place-items-center rounded-md border border-border text-muted transition hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-40"
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
