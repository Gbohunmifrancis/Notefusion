import { Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { getUsers } from "@/api/endpoints";
import type { AdminUserRow, PagedResult } from "@/api/types";
import { Avatar } from "@/components/Avatar";
import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { Pager } from "@/components/Pager";
import { Segmented } from "@/components/Segmented";
import { StateView } from "@/components/StateView";
import { formatCount, formatInstantDate, formatInstantDateTime } from "@/lib/format";
import { getReportingOffset } from "@/lib/reporting";
import { TD, TH, THEAD_TR, TR } from "@/lib/tableClasses";
import { useAsync, useDebounced } from "@/lib/useAsync";

const PAGE_SIZE = 25;

/**
 * Filtered on the server, not here. This page holds one page of rows, so filtering after paging
 * would report "3 of 340" and never reach the suspended account sitting on page nine.
 */
const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
] as const;

type StatusFilter = (typeof STATUS_OPTIONS)[number]["value"];

const IS_ACTIVE: Record<StatusFilter, boolean | undefined> = {
  all: undefined,
  active: true,
  suspended: false,
};

/** Pro / Gift / Free from the two flags the row carries. */
function PlanBadge({ user }: { user: AdminUserRow }) {
  if (!user.hasProAccess) return <Badge>Free</Badge>;
  if (user.isGiftedPro) {
    return <Badge tone="premium" title="Granted by an operator — no payment was taken">Gift</Badge>;
  }
  return <Badge tone="blue">Pro</Badge>;
}

export function UsersPage() {
  // The sidebar's search box navigates here with `?q=`, so the URL seeds the field and
  // overrides it on every later navigation. Typing stays local: writing a history entry per
  // keystroke would make the back button useless.
  const [params] = useSearchParams();
  const incoming = params.get("q") ?? "";
  const [search, setSearch] = useState(incoming);
  useEffect(() => setSearch(incoming), [incoming]);

  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounced(search);

  // A new search or filter starts at the beginning; page 4 of the old query means nothing for
  // the new one.
  useEffect(() => setPage(1), [debouncedSearch, status]);

  const fetcher = useCallback(
    (signal: AbortSignal) =>
      getUsers(page, PAGE_SIZE, debouncedSearch.trim(), IS_ACTIVE[status], signal),
    [page, debouncedSearch, status],
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
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              options={STATUS_OPTIONS}
              value={status}
              onChange={setStatus}
              label="Account status"
            />
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
          </div>
        }
      >
        <StateView
          state={state}
          isEmpty={(data) => data.items.length === 0}
          emptyMessage={
            debouncedSearch
              ? "No accounts match that search"
              : status === "suspended"
                ? "No suspended accounts"
                : "No accounts yet"
          }
          loadingLabel="Loading accounts"
        >
          {(data) => (
            <>
              <div className="overflow-x-auto border-t border-border">
                <table className="w-full min-w-[62rem]">
                  <thead>
                    <tr className={THEAD_TR}>
                      <th className={TH}>Account</th>
                      <th className={TH}>Plan</th>
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
                          {/* The link is on the name rather than the row: a whole-row anchor
                              cannot contain the badges without nesting interactive elements. */}
                          <div className="flex items-center gap-3">
                            <Avatar name={user.fullName} size={34} />
                            <div className="min-w-0">
                              <Link
                                to={`/users/${user.id}`}
                                className="block truncate font-medium text-ink transition hover:text-accent"
                              >
                                {user.fullName}
                              </Link>
                              <p className="truncate text-[11px] text-faint">{user.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className={TD}>
                          <PlanBadge user={user} />
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
                            <Badge tone="danger">Suspended</Badge>
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

              <Pager
                page={data.page}
                pageSize={data.pageSize}
                totalCount={data.totalCount}
                totalPages={data.totalPages}
                busy={state.loading}
                onPage={setPage}
              />
            </>
          )}
        </StateView>
      </Card>
    </div>
  );
}
