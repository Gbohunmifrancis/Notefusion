"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronRight, Mail, Search } from "lucide-react";
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
import { SendEmailDialog, type SendEmailTarget } from "@/components/SendEmailDialog";
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
import {
  formatCount,
  formatInstantDate,
  formatInstantDateTime,
  formatRelative,
} from "@/lib/format";
import { getReportingOffset } from "@/lib/reporting";
import { TBODY, TD, TH } from "@/lib/tableClasses";
import { useClampPage } from "@/lib/useClampPage";
import { useDebounced } from "@/lib/useDebounced";

const PAGE_SIZE = 25;

/**
 * Filtered on the server, not here. This page holds one page of rows, so filtering after paging
 * would report "3 of 340" and never reach the suspended account sitting on page nine.
 */
const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "online", label: "Online" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
] as const;

type StatusFilter = (typeof STATUS_OPTIONS)[number]["value"];

const IS_ACTIVE: Record<StatusFilter, boolean | undefined> = {
  all: undefined,
  online: undefined,
  active: true,
  suspended: false,
};

const IS_ONLINE: Record<StatusFilter, boolean | undefined> = {
  all: undefined,
  online: true,
  active: undefined,
  suspended: undefined,
};

/** User is considered currently on the app if activity was within the last 5 minutes. */
function isUserOnline(lastLoginAt: string | null): boolean {
  if (!lastLoginAt) return false;
  const time = new Date(lastLoginAt).getTime();
  if (Number.isNaN(time)) return false;
  const diff = Date.now() - time;
  return diff >= 0 && diff < 5 * 60 * 1000;
}

function LastSeenCell({
  lastLoginAt,
  offset,
}: {
  lastLoginAt: string | null;
  offset: number;
}) {
  if (!lastLoginAt) {
    return <span className="text-faint">Never</span>;
  }
  const time = new Date(lastLoginAt).getTime();
  if (Number.isNaN(time)) {
    return <span className="text-faint">Never</span>;
  }
  const now = Date.now();
  const diff = now - time;

  // Active within 5 minutes: Online
  if (diff >= 0 && diff < 5 * 60 * 1000) {
    return (
      <span className="inline-flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        <span>Online now</span>
      </span>
    );
  }

  // Active within 24 hours: relative
  if (diff >= 0 && diff < 24 * 60 * 60 * 1000) {
    return (
      <span
        title={formatInstantDateTime(lastLoginAt, offset)}
        className="cursor-default font-medium text-slate-700 dark:text-slate-300"
      >
        {formatRelative(lastLoginAt, now)}
      </span>
    );
  }

  // Older than 24 hours
  return (
    <span
      title={formatInstantDateTime(lastLoginAt, offset)}
      className="cursor-default text-slate-600 dark:text-slate-400"
    >
      {formatInstantDate(lastLoginAt, offset)}
    </span>
  );
}

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
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailTarget, setEmailTarget] = useState<SendEmailTarget | null>(null);
  const debouncedSearch = useDebounced(search);

  // A new search or filter starts at the beginning; page 4 of the old query means nothing for
  // the new one.
  useEffect(() => setPage(1), [debouncedSearch, status]);

  const term = debouncedSearch.trim();
  const state = useQuery({
    queryKey: ["users", page, term, status],
    queryFn: ({ signal }) =>
      getUsers(page, PAGE_SIZE, term, IS_ACTIVE[status], IS_ONLINE[status], signal),
    // Stepping a page is a new query key, and without this the table would empty itself and
    // draw a spinner between two pages that differ by twenty-five rows.
    placeholderData: keepPreviousData,
  });

  // Suspending an account shrinks the "suspended"/"active" set underfoot, so a page that was valid
  // can fall off the end. Snap back to the last real page rather than stranding an empty view.
  useClampPage(page, state.data?.totalPages, setPage);

  // Timestamps are shown in the same zone the overview buckets days in, so the two pages
  // never disagree about which day something happened on.
  const offset = getReportingOffset();

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Users"
        breadcrumb={["Dashboard", "Users"]}
        actions={
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => {
              setEmailTarget(null);
              setEmailDialogOpen(true);
            }}
            className="h-9 gap-1.5 rounded-md text-xs font-semibold"
          >
            <Mail className="size-3.5" aria-hidden="true" />
            Compose email
          </Button>
        }
      />

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
              : status === "online"
                ? "No users currently online on the app"
                : status === "suspended"
                  ? "No suspended accounts"
                  : "No accounts yet"
          }
          loadingLabel="Loading accounts"
        >
          {(data) => (
            <>
              <div className="w-full min-w-0 overflow-x-auto border-t border-border">
                <Table className="w-full min-w-[56rem]">
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
                    {data.items.map((user) => {
                      const online = isUserOnline(user.lastLoginAt);
                      return (
                        <TableRow key={user.id}>
                          <TableCell className={TD}>
                            {/* The link is on the name rather than the row: a whole-row anchor
                                cannot contain the badges without nesting interactive elements. */}
                            <div className="flex items-center gap-3">
                              <div className="relative shrink-0">
                                <Avatar name={user.fullName} src={user.profilePictureUrl} size={34} />
                                {online && (
                                  <span
                                    className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-white ring-2 ring-white dark:bg-slate-900 dark:ring-slate-900"
                                    title="Currently on the app (Online)"
                                  >
                                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                                  </span>
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <Link
                                    href={`/users/${user.id}`}
                                    className="block truncate font-medium text-brand transition hover:underline"
                                  >
                                    {user.fullName}
                                  </Link>
                                  {online && (
                                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-950/60 dark:text-emerald-400 dark:ring-emerald-500/30">
                                      Online
                                    </span>
                                  )}
                                </div>
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
                            <LastSeenCell lastLoginAt={user.lastLoginAt} offset={offset} />
                          </TableCell>
                          <TableCell className={`${TD} text-right`}>
                            <div className="flex items-center justify-end gap-1.5">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                title={`Send email to ${user.fullName}`}
                                onClick={() => {
                                  setEmailTarget(user);
                                  setEmailDialogOpen(true);
                                }}
                                className="h-7 w-7 p-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
                              >
                                <Mail className="size-3.5" aria-hidden="true" />
                                <span className="sr-only">Send email</span>
                              </Button>
                              <Button
                                asChild
                                variant="outline"
                                size="sm"
                                className="h-auto rounded-pill px-2.5 py-1 text-[11px] font-semibold"
                              >
                                <Link href={`/users/${user.id}`}>
                                  Manage
                                  <ChevronRight className="size-3" aria-hidden="true" />
                                </Link>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
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

      <SendEmailDialog
        open={emailDialogOpen}
        onOpenChange={setEmailDialogOpen}
        targetUser={emailTarget}
        onSuccess={() => {
          void state.refetch();
        }}
      />
    </div>
  );
}
