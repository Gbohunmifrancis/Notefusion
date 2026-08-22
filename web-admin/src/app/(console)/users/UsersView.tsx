"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { getUsers } from "@/api/endpoints";
import type { AdminUserRow } from "@/api/types";
import { Avatar } from "@/components/Avatar";
import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { Pager } from "@/components/Pager";
import { Segmented } from "@/components/Segmented";
import { StateView } from "@/components/StateView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCount, formatInstantDate, formatInstantDateTime } from "@/lib/format";
import { getReportingOffset } from "@/lib/reporting";
import { TBODY, TD, TH } from "@/lib/tableClasses";
import { useDebounced } from "@/lib/useDebounced";

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
    return (
      <Badge tone="premium" title="Granted by an operator — no payment was taken">
        Gift
      </Badge>
    );
  }
  return <Badge tone="blue">Pro</Badge>;
}

export function UsersView() {
  // The shell's search box navigates here with `?q=`, so the URL seeds the field and overrides
  // it on every later navigation. Typing stays local: writing a history entry per keystroke
  // would make the back button useless.
  const params = useSearchParams();
  const incoming = params.get("q") ?? "";
  const [search, setSearch] = useState(incoming);
  useEffect(() => setSearch(incoming), [incoming]);

  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounced(search);

  // A new search or filter starts at the beginning; page 4 of the old query means nothing for
  // the new one.
  useEffect(() => setPage(1), [debouncedSearch, status]);

  const term = debouncedSearch.trim();
  const state = useQuery({
    queryKey: ["users", page, term, status],
    queryFn: ({ signal }) => getUsers(page, PAGE_SIZE, term, IS_ACTIVE[status], signal),
    // Stepping a page is a new query key, and without this the table would empty itself and
    // draw a spinner between two pages that differ by twenty-five rows.
    placeholderData: keepPreviousData,
  });

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
              <Input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name or email"
                // 13px from `md` up, because shadcn's own `md:text-sm` would otherwise win there.
                // Below it the input keeps shadcn's 16px, which is what stops iOS zooming on focus.
                className="w-56 rounded-sm pl-9 placeholder:text-faint md:text-[13px]"
              />
            </label>
          </div>
        }
      >
        <StateView
          state={state}
          isEmpty={(data) => data.items.length === 0}
          emptyMessage={
            term
              ? "No accounts match that search"
              : status === "suspended"
                ? "No suspended accounts"
                : "No accounts yet"
          }
          loadingLabel="Loading accounts"
        >
          {(data) => (
            <>
              <div className="border-t border-border">
                <Table className="min-w-[68rem]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className={TH}>Account</TableHead>
                      <TableHead className={TH}>Plan</TableHead>
                      <TableHead className={TH}>Role</TableHead>
                      <TableHead className={TH}>Sign-in</TableHead>
                      <TableHead className={TH}>Status</TableHead>
                      <TableHead className={`${TH} text-right`}>Transcriptions</TableHead>
                      <TableHead className={TH}>Joined</TableHead>
                      <TableHead className={TH}>Last sign-in</TableHead>
                      <TableHead className={`${TH} text-right`}>Manage</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className={TBODY}>
                    {data.items.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell className={TD}>
                          {/* The link is on the name rather than the row: a whole-row anchor
                              cannot contain the badges without nesting interactive elements.
                              It carries the brand colour every other link in the console uses —
                              in ink it read as ordinary emphasis and nobody found it. */}
                          <div className="flex items-center gap-3">
                            <Avatar name={user.fullName} src={user.profilePictureUrl} size={34} />
                            <div className="min-w-0">
                              <Link
                                href={`/users/${user.id}`}
                                className="block truncate font-medium text-brand transition hover:underline"
                              >
                                {user.fullName}
                              </Link>
                              <p className="truncate text-[11px] text-faint">{user.email}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className={TD}>
                          <PlanBadge user={user} />
                        </TableCell>
                        <TableCell className={TD}>
                          <Badge tone={user.role === "Admin" ? "blue" : "neutral"}>
                            {user.role}
                          </Badge>
                        </TableCell>
                        <TableCell className={TD}>
                          <span className="flex flex-wrap gap-1">
                            {user.hasGoogle && <Badge tone="blue">Google</Badge>}
                            {user.hasPassword && <Badge>Password</Badge>}
                            {/* Neither flag set would mean an account that cannot sign in at
                                all, which is worth seeing rather than rendering as blank. */}
                            {!user.hasGoogle && !user.hasPassword && (
                              <Badge tone="danger">No method</Badge>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className={TD}>
                          {user.isActive ? (
                            <Badge tone="success">Active</Badge>
                          ) : (
                            <Badge tone="danger">Suspended</Badge>
                          )}
                        </TableCell>
                        <TableCell className={`${TD} text-right tabular-nums`}>
                          {formatCount(user.transcriptionCount)}
                        </TableCell>
                        <TableCell className={TD}>
                          {formatInstantDate(user.createdAt, offset)}
                        </TableCell>
                        <TableCell className={TD}>
                          {/* Null means never signed in since the column existed, not "today". */}
                          {formatInstantDateTime(user.lastLoginAt, offset)}
                        </TableCell>
                        <TableCell className={`${TD} text-right`}>
                          {/* The name is a link too, but a name does not look like one — every
                              operator action lives behind this cell, so it says so in words. */}
                          <Button
                            asChild
                            variant="outline"
                            size="sm"
                            className="h-auto rounded-pill px-2.5 py-1 text-[11px] font-semibold"
                          >
                            <Link href={`/users/${user.id}`}>
                              Manage
                              {/* Sized down explicitly: shadcn's 16px default would tower over
                                  11px text, and a `size-*` class is how its base rule opts out. */}
                              <ChevronRight className="size-3" aria-hidden="true" />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <Pager
                page={data.page}
                pageSize={data.pageSize}
                totalCount={data.totalCount}
                totalPages={data.totalPages}
                busy={state.isFetching}
                onPage={setPage}
              />
            </>
          )}
        </StateView>
      </Card>
    </div>
  );
}
