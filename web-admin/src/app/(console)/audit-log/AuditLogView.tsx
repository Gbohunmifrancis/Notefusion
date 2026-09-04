"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { getAuditLog } from "@/api/endpoints";
import type { AuditAction } from "@/api/types";
import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { Pager } from "@/components/Pager";
import { StateView } from "@/components/StateView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AUDIT_ACTIONS, auditMeta } from "@/lib/audit";
import { UNKNOWN, formatInstantDateTime } from "@/lib/format";
import { getReportingOffset } from "@/lib/reporting";
import { TBODY, TD, TH } from "@/lib/tableClasses";
import { useClampPage } from "@/lib/useClampPage";
import { useDebounced } from "@/lib/useDebounced";

const PAGE_SIZE = 30;

/** Radix reserves "" for "no value selected", so the unfiltered case needs a name of its own. */
const ALL = "all";

/**
 * The record of what operators did. Read-only by design: rows are written by the handlers that
 * perform the actions and there is no edit or delete path, here or on the server.
 *
 * The account filter lives in the URL (`?target=<id>`) rather than in state, because the only way
 * anyone arrives at it is the link from a user's detail page, and it has to survive a refresh and be
 * shareable to be worth anything to a second person looking at the same incident.
 */
export function AuditLogView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const targetUserId = params.get("target") ?? "";

  const [action, setAction] = useState<AuditAction | typeof ALL>(ALL);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounced(search);

  useEffect(() => setPage(1), [action, debouncedSearch, targetUserId]);

  const term = debouncedSearch.trim();
  const filters = {
    ...(action === ALL ? {} : { action }),
    ...(targetUserId ? { targetUserId } : {}),
    ...(term ? { search: term } : {}),
  };

  const state = useQuery({
    // Every input the request depends on is in the key, so a filter change is a different
    // query rather than the same one re-fired — which is what lets the cache hold both.
    queryKey: ["audit-log", page, filters],
    queryFn: ({ signal }) => getAuditLog(page, PAGE_SIZE, filters, signal),
    // Stepping a page is a new key, and without this the table would empty itself and draw a
    // spinner between two pages that differ by thirty rows.
    placeholderData: keepPreviousData,
  });

  // The trail only grows, so this is the restored-tab case: a page number replayed from a longer
  // filtered list would otherwise render the empty state with no control to step back.
  useClampPage(page, state.data?.totalPages, setPage);

  const offset = getReportingOffset();

  const clearTarget = () => {
    const next = new URLSearchParams(params);
    next.delete("target");
    const rest = next.toString();
    router.replace(rest ? `${pathname}?${rest}` : pathname);
  };

  const filtered = Boolean(action !== ALL || targetUserId || term);

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader title="Audit log" breadcrumb={["Dashboard", "Operations", "Audit log"]} />

      <Card
        title="Operator actions"
        hint="Newest first. Append-only — nothing in this console can edit or delete a row."
        bleed
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={action}
              onValueChange={(next) => setAction(next as AuditAction | typeof ALL)}
            >
              <SelectTrigger
                aria-label="Filter by action"
                className="h-9 w-[11.5rem] rounded-sm text-[13px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All actions</SelectItem>
                {AUDIT_ACTIONS.map((entry) => (
                  <SelectItem key={entry.value} value={entry.value}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <label className="relative block">
              <span className="sr-only">Search by email or summary</span>
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Actor, target or summary"
                // 13px from `md` up: shadcn's own `md:text-sm` would win over an unqualified size,
                // and below it the input keeps 16px so iOS does not zoom on focus.
                className="w-56 rounded-sm pl-9 placeholder:text-faint md:text-[13px]"
              />
            </label>
          </div>
        }
      >
        {targetUserId && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
            <span className="text-xs text-muted-foreground">Filtered to one account</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={clearTarget}
              className="h-auto rounded-pill px-2.5 py-1 text-[11px] font-semibold"
            >
              Clear
              <X className="size-3" aria-hidden="true" />
            </Button>
            <Link
              href={`/users/${targetUserId}`}
              className="text-xs font-semibold text-brand transition hover:opacity-80"
            >
              Open the account →
            </Link>
          </div>
        )}

        <StateView
          state={state}
          isEmpty={(data) => data.items.length === 0}
          emptyMessage={filtered ? "No entries match those filters" : "No operator actions yet"}
          {...(filtered
            ? {}
            : {
                emptyHint:
                  "Gifting Pro, suspending an account or changing a role each write a row here.",
              })}
          loadingLabel="Loading the audit log"
        >
          {(data) => (
            <>
              <div className="w-full min-w-0 overflow-x-auto border-t border-border">
                <Table className="w-full min-w-[50rem]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className={TH}>When</TableHead>
                      <TableHead className={TH}>Action</TableHead>
                      <TableHead className={TH}>By</TableHead>
                      <TableHead className={TH}>On</TableHead>
                      <TableHead className={TH}>IP</TableHead>
                      <TableHead className={TH}>Detail</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className={TBODY}>
                    {data.items.map((row) => {
                      const meta = auditMeta(row.action);
                      return (
                        <TableRow key={row.id}>
                          <TableCell className={TD}>
                            {formatInstantDateTime(row.occurredAtUtc, offset)}
                          </TableCell>
                          <TableCell className={TD}>
                            <Badge tone={meta.tone}>{meta.label}</Badge>
                          </TableCell>
                          {/* Both emails are snapshots taken when the action happened, so a row
                              still names the people involved after an account is gone — which is
                              also why neither is a link unless there is still an id to follow. */}
                          <TableCell className={TD}>{row.actorEmail}</TableCell>
                          <TableCell className={TD}>
                            {row.targetUserId ? (
                              <Link
                                href={`/users/${row.targetUserId}`}
                                className="text-brand transition hover:underline"
                              >
                                {row.targetEmail ?? row.targetUserId}
                              </Link>
                            ) : (
                              (row.targetEmail ?? UNKNOWN)
                            )}
                          </TableCell>
                          <TableCell className={TD}>
                            <span className="font-mono text-[11.5px]">
                              {row.ipAddress ?? UNKNOWN}
                            </span>
                          </TableCell>
                          {/* The one cell that wraps: a summary plus a note is prose, and
                              shadcn's cell is `whitespace-nowrap` by default. */}
                          <TableCell className={`${TD} whitespace-normal`}>
                            <p className="text-foreground">{row.summary}</p>
                            {row.note && <p className="mt-0.5 italic text-faint">“{row.note}”</p>}
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
    </div>
  );
}
