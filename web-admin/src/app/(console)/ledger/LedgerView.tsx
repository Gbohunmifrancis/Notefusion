"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { getLedger } from "@/api/endpoints";
import type { LedgerDirection, LedgerReason } from "@/api/types";
import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { Pager } from "@/components/Pager";
import { RangePicker, type Range } from "@/components/RangePicker";
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
import {
  UNKNOWN,
  addDays,
  formatInstantDateTime,
  formatMoney,
  reportingDayStartUtc,
} from "@/lib/format";
import { LEDGER_REASONS, LEDGER_REASON_LABELS } from "@/lib/payments";
import { getReportingOffset } from "@/lib/reporting";
import { TBODY, TD, TH } from "@/lib/tableClasses";
import { useClampPage } from "@/lib/useClampPage";
import { useDebounced } from "@/lib/useDebounced";

const PAGE_SIZE = 30;

/** Radix reserves "" for "no value selected", so the unfiltered case needs a name of its own. */
const ALL = "all";

const DIRECTIONS: readonly LedgerDirection[] = ["Credit", "Debit"];

/** No bound at either end: the ledger opens on everything, the way a ledger is read. */
const NO_RANGE: Range = { from: "", to: "" };

/**
 * Money recognised, one row per movement. Append-only: entries are written by the handler that
 * completes a payment or records a refund, and nothing in this console or the API edits or deletes
 * one — a correction is another entry.
 *
 * Gifted subscriptions are absent by design, and that is worth knowing before comparing this against
 * the subscriber count: a gift grants access without money, so it writes nothing here.
 */
export function LedgerView() {
  const [direction, setDirection] = useState<LedgerDirection | typeof ALL>(ALL);
  const [reason, setReason] = useState<LedgerReason | typeof ALL>(ALL);
  const [search, setSearch] = useState("");
  const [range, setRange] = useState<Range>(NO_RANGE);
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounced(search);

  useEffect(() => setPage(1), [direction, reason, debouncedSearch, range.from, range.to]);

  const offset = getReportingOffset();
  const term = debouncedSearch.trim();

  // Reporting-local days in, instants out. The upper bound is exclusive server-side, so a window
  // ending on the 23rd passes the start of the 24th and keeps that whole day.
  const fromUtc = range.from ? reportingDayStartUtc(range.from, offset) : null;
  const toUtc = range.to ? reportingDayStartUtc(addDays(range.to, 1), offset) : null;

  const filters = {
    ...(direction === ALL ? {} : { direction }),
    ...(reason === ALL ? {} : { reason }),
    ...(fromUtc ? { fromUtc } : {}),
    ...(toUtc ? { toUtc } : {}),
    ...(term ? { search: term } : {}),
  };

  const state = useQuery({
    queryKey: ["ledger", page, filters],
    queryFn: ({ signal }) => getLedger(page, PAGE_SIZE, filters, signal),
    placeholderData: keepPreviousData,
  });

  // A narrowed date window or reason can leave the current page past the end of the shorter
  // result — step back to the last real page instead of an empty view with no footer.
  useClampPage(page, state.data?.totalPages, setPage);

  const dated = Boolean(range.from || range.to);
  const filtered = Boolean(direction !== ALL || reason !== ALL || term || dated);

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Ledger"
        subtitle="Every movement of money, in the order it was recognised."
        breadcrumb={["Dashboard", "Payments", "Ledger"]}
      />

      <Card
        title="Entries"
        hint="Append-only. A correction is another entry — nothing here can be edited or removed."
        bleed
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={direction}
              onValueChange={(next) => setDirection(next as LedgerDirection | typeof ALL)}
            >
              <SelectTrigger
                aria-label="Filter by direction"
                className="h-9 w-[10.5rem] rounded-sm text-[13px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>In and out</SelectItem>
                {DIRECTIONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value === "Credit" ? "Money in" : "Money out"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={reason}
              onValueChange={(next) => setReason(next as LedgerReason | typeof ALL)}
            >
              <SelectTrigger
                aria-label="Filter by reason"
                className="h-9 w-[10.5rem] rounded-sm text-[13px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All reasons</SelectItem>
                {LEDGER_REASONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {LEDGER_REASON_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <label className="relative block">
              <span className="sr-only">Search by email, reference or description</span>
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Email or reference"
                className="w-56 rounded-sm pl-9 placeholder:text-faint md:text-[13px]"
              />
            </label>
          </div>
        }
      >
        {/* Off by default. A ledger read through a default window is a ledger that quietly omits
            its own opening balance. */}
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          <span className="text-xs font-medium text-muted-foreground">Written</span>
          <RangePicker value={range} offsetMinutes={offset} onChange={setRange} />
          {dated ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRange(NO_RANGE)}
              className="h-auto rounded-pill px-2.5 py-1 text-[11px] font-semibold"
            >
              Clear
              <X className="size-3" aria-hidden="true" />
            </Button>
          ) : (
            <span className="text-xs text-faint">All time</span>
          )}
        </div>

        <StateView
          state={state}
          isEmpty={(data) => data.items.length === 0}
          emptyMessage={filtered ? "No entries match those filters" : "No money has been recognised"}
          {...(filtered
            ? {}
            : {
                emptyHint:
                  "An entry is written when a payment completes. Gifted subscriptions write nothing here, by design.",
              })}
          loadingLabel="Loading the ledger"
        >
          {(data) => (
            <>
              <div className="w-full min-w-0 overflow-x-auto border-t border-border">
                <Table className="w-full min-w-[50rem]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className={TH}>When</TableHead>
                      <TableHead className={TH}>Account</TableHead>
                      <TableHead className={TH}>Payment</TableHead>
                      <TableHead className={TH}>Reason</TableHead>
                      <TableHead className={TH}>Description</TableHead>
                      <TableHead className={`${TH} text-right`}>Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className={TBODY}>
                    {data.items.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className={TD}>
                          {formatInstantDateTime(row.createdAtUtc, offset)}
                        </TableCell>

                        {/* No foreign key ties an entry to a user, so the entry outlives a deleted
                            account — and it has to, or the totals would move when one is removed. */}
                        <TableCell className={TD}>
                          {row.userEmail ? (
                            <Link
                              href={`/users/${row.userId}`}
                              className="text-brand transition hover:underline"
                            >
                              {row.userEmail}
                            </Link>
                          ) : (
                            <span
                              className="text-faint"
                              title={`The account was deleted. Its id was ${row.userId}.`}
                            >
                              Account deleted
                            </span>
                          )}
                        </TableCell>

                        <TableCell className={TD}>
                          <Link
                            href={`/payments/${row.paymentTransactionId}`}
                            className="font-mono text-[11.5px] text-brand transition hover:underline"
                          >
                            {row.paymentReference ?? "Open"}
                          </Link>
                        </TableCell>

                        <TableCell className={TD}>
                          <Badge tone={row.reason === "Refund" ? "warning" : "neutral"}>
                            {LEDGER_REASON_LABELS[row.reason]}
                          </Badge>
                        </TableCell>

                        <TableCell className={`${TD} whitespace-normal`}>
                          {row.description || UNKNOWN}
                        </TableCell>

                        <TableCell
                          className={`${TD} text-right font-medium tabular-nums ${
                            row.direction === "Credit" ? "text-success-deep" : "text-danger-deep"
                          }`}
                        >
                          {/* The stored amount is always positive; the direction carries the sign. */}
                          {row.direction === "Credit" ? "+" : "−"}
                          {formatMoney(row.amountMinor, row.currency)}
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
