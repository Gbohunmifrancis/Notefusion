"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Banknote, Inbox, Search, ShieldAlert, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { getPayments, getPaymentsSummary } from "@/api/endpoints";
import type {
  PaymentOpsSummary,
  PaymentProviderName,
  PaymentStatus,
} from "@/api/types";
import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { Pager } from "@/components/Pager";
import { RangePicker, type Range } from "@/components/RangePicker";
import { ReconcileButton } from "@/components/ReconcileButton";
import { StatStrip, StatTile } from "@/components/StatStrip";
import { StateView } from "@/components/StateView";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  formatCount,
  formatInstantDateTime,
  formatMoney,
  reportingDayStartUtc,
} from "@/lib/format";
import {
  PAYMENT_PROVIDERS,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_TITLES,
  PAYMENT_TONES,
} from "@/lib/payments";
import { getReportingOffset } from "@/lib/reporting";
import { TBODY, TD, TH } from "@/lib/tableClasses";
import { useClampPage } from "@/lib/useClampPage";
import { useDebounced } from "@/lib/useDebounced";

const PAGE_SIZE = 30;

/** Radix reserves "" for "no value selected", so the unfiltered case needs a name of its own. */
const ALL = "all";

/** No bound at either end: the page opens on every attempt ever made, not on a recent window. */
const NO_RANGE: Range = { from: "", to: "" };

/**
 * Every payment attempt the system has ever made, and the one action that can move a stuck one.
 *
 * The reason this page exists rather than only the per-account payment list: when a gateway has a
 * bad hour the question is never "what happened to this account", it is "what is stuck", and that
 * question cannot be asked one account at a time.
 *
 * Filters live in local state, not the URL. Nothing links into this page pre-filtered — the account
 * links point the other way, at `/users/<id>` — so a shareable query string would be machinery with
 * no user. The audit log does the opposite, and its comment says why.
 */
export function PaymentsView() {
  const [status, setStatus] = useState<PaymentStatus | typeof ALL>(ALL);
  const [provider, setProvider] = useState<PaymentProviderName | typeof ALL>(ALL);
  const [stuckOnly, setStuckOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [range, setRange] = useState<Range>(NO_RANGE);
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounced(search);

  useEffect(
    () => setPage(1),
    [status, provider, stuckOnly, debouncedSearch, range.from, range.to],
  );

  const offset = getReportingOffset();
  const term = debouncedSearch.trim();

  // Reporting-local days in, instants out. The upper bound is exclusive server-side, so a window
  // ending on the 23rd passes the start of the 24th and keeps that whole day.
  const fromUtc = range.from ? reportingDayStartUtc(range.from, offset) : null;
  const toUtc = range.to ? reportingDayStartUtc(addDays(range.to, 1), offset) : null;

  const filters = {
    ...(status === ALL ? {} : { status }),
    ...(provider === ALL ? {} : { provider }),
    // Sent only when on: `query()` keeps `false`, which would filter to the *unstuck* rows.
    ...(stuckOnly ? { stuckOnly: true } : {}),
    ...(fromUtc ? { fromUtc } : {}),
    ...(toUtc ? { toUtc } : {}),
    ...(term ? { search: term } : {}),
  };

  const state = useQuery({
    queryKey: ["payments", page, filters],
    queryFn: ({ signal }) => getPayments(page, PAGE_SIZE, filters, signal),
    placeholderData: keepPreviousData,
  });

  // A tightened filter can leave the current page past the end of the shorter result — step back
  // to the last real page instead of showing the empty state with no way out.
  useClampPage(page, state.data?.totalPages, setPage);

  const summary = useQuery({
    queryKey: ["payments-summary"],
    queryFn: ({ signal }) => getPaymentsSummary(signal),
  });

  const dated = Boolean(range.from || range.to);
  const filtered = Boolean(status !== ALL || provider !== ALL || stuckOnly || term || dated);

  // The windows come down with the counts so this can say what "overdue" means rather than print a
  // number and leave the reader to guess which worker owns it.
  const windows = summary.data;
  const tableHint = windows
    ? `Every attempt, newest first. Still processing after ${windows.graceWindowMinutes} min counts as overdue, and the sweep picks it up within ${windows.sweepIntervalMinutes} min.`
    : "Every attempt, newest first — the failures included.";

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Payments"
        subtitle="What the money is doing, and what the workers will do about it."
        breadcrumb={["Dashboard", "Payments", "Transactions"]}
      />

      <StateView state={summary} loadingLabel="Loading the reconciliation snapshot">
        {(data) => (
          <div className="space-y-5">
            <Snapshot data={data} offset={offset} />
            <StateCounts
              data={data}
              selected={status}
              onPick={(next) => setStatus((current) => (current === next ? ALL : next))}
            />
          </div>
        )}
      </StateView>

      <Card
        title="Transactions"
        hint={tableHint}
        bleed
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={status}
              onValueChange={(next) => setStatus(next as PaymentStatus | typeof ALL)}
            >
              <SelectTrigger
                aria-label="Filter by status"
                className="h-9 w-[10.5rem] rounded-sm text-[13px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {PAYMENT_STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={provider}
              onValueChange={(next) => setProvider(next as PaymentProviderName | typeof ALL)}
            >
              <SelectTrigger
                aria-label="Filter by provider"
                className="h-9 w-[10.5rem] rounded-sm text-[13px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All providers</SelectItem>
                {PAYMENT_PROVIDERS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <label className="flex h-9 cursor-pointer items-center gap-2 rounded-sm border border-border px-2.5 text-[13px] text-muted-foreground">
              <Checkbox
                checked={stuckOnly}
                onCheckedChange={(next) => setStuckOnly(next === true)}
              />
              Overdue only
            </label>

            <label className="relative block">
              <span className="sr-only">Search by email or reference</span>
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
        {/* Its own strip rather than a fifth control in the header: it is two inputs and three
            presets, and it is the one filter that is off by default. Off by default on purpose —
            a page that opened on the last 30 days would hide exactly the payment that has been
            stuck since March. */}
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          <span className="text-xs font-medium text-muted-foreground">Started</span>
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
          emptyMessage={filtered ? "No payments match those filters" : "No payment has been attempted"}
          {...(filtered
            ? {}
            : {
                emptyHint:
                  "A row appears the moment a customer opens checkout, whether or not they pay.",
              })}
          loadingLabel="Loading payments"
        >
          {(data) => (
            <>
              <div className="w-full min-w-0">
                <Table className="w-full min-w-[50rem]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className={TH}>Started</TableHead>
                      <TableHead className={TH}>Account</TableHead>
                      <TableHead className={TH}>Reference</TableHead>
                      <TableHead className={TH}>Plan</TableHead>
                      <TableHead className={TH}>Provider</TableHead>
                      <TableHead className={TH}>Status</TableHead>
                      <TableHead className={`${TH} text-right`}>Amount</TableHead>
                      <TableHead className={`${TH} text-right`}>
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className={TBODY}>
                    {data.items.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className={TD}>
                          {formatInstantDateTime(row.createdAtUtc, offset)}
                          {row.isStuck && (
                            <p className="mt-0.5 text-[11px] font-semibold text-warning-deep">
                              Overdue since {formatInstantDateTime(row.updatedAtUtc, offset)}
                            </p>
                          )}
                        </TableCell>

                        {/* No foreign key ties a payment to a user, so a deleted account leaves the
                            row behind with nothing to link to. The id is all that survives, and it
                            is worth showing: it is what a support ticket will quote. */}
                        <TableCell className={TD}>
                          {row.userEmail ? (
                            <>
                              <Link
                                href={`/users/${row.userId}`}
                                className="text-brand transition hover:underline"
                              >
                                {row.userEmail}
                              </Link>
                              {row.userFullName && (
                                <p className="mt-0.5 text-[11px] text-faint">{row.userFullName}</p>
                              )}
                            </>
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
                            href={`/payments/${row.id}`}
                            className="font-mono text-[11.5px] text-brand transition hover:underline"
                          >
                            {row.reference}
                          </Link>
                          {row.providerReference && (
                            <p className="mt-0.5 font-mono text-[11px] text-faint">
                              {row.providerReference}
                            </p>
                          )}
                        </TableCell>

                        <TableCell className={TD}>{row.planName ?? UNKNOWN}</TableCell>
                        <TableCell className={TD}>{row.provider}</TableCell>

                        {/* Wraps: a gateway's failure reason is a sentence of theirs, not a word. */}
                        <TableCell className={`${TD} whitespace-normal`}>
                          <Badge
                            tone={PAYMENT_TONES[row.status]}
                            title={PAYMENT_STATUS_TITLES[row.status]}
                          >
                            {row.status}
                          </Badge>
                          {row.failureReason && (
                            <p className="mt-1 max-w-[16rem] text-[11px] text-faint">
                              {row.failureReason}
                            </p>
                          )}
                        </TableCell>

                        <TableCell
                          className={`${TD} text-right font-medium tabular-nums text-foreground`}
                        >
                          {formatMoney(row.amountMinor, row.currency)}
                        </TableCell>

                        {/* Only the rows it can act on carry the button. Everywhere else the cell is
                            empty rather than holding a disabled control on every line. */}
                        <TableCell className={`${TD} text-right`}>
                          {row.status === "Processing" && <ReconcileButton payment={row} />}
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

/**
 * The four numbers worth interrupting someone over. Two of them should read zero, and the tiles say
 * so, because a dashboard that shows `0` and `4` in the same grey is a dashboard nobody reads twice.
 */
function Snapshot({ data, offset }: { data: PaymentOpsSummary; offset: number }) {
  return (
    <StatStrip>
      <StatTile
        label="Overdue"
        value={formatCount(data.stuckCount)}
        icon={AlertTriangle}
        tone="orange"
        hint={`Still processing after ${data.graceWindowMinutes} minutes — exactly what the sweep picks up. Reconciling one by hand only saves the wait.`}
        sub={
          data.oldestStuckSinceUtc
            ? `Oldest since ${formatInstantDateTime(data.oldestStuckSinceUtc, offset)}`
            : "Nothing waiting"
        }
      />
      <StatTile
        label="Paid, not applied"
        value={formatCount(data.verifiedCount)}
        icon={ShieldAlert}
        tone="violet"
        hint={PAYMENT_STATUS_TITLES.Verified}
        sub={
          data.verifiedCount === 0
            ? "As it should be"
            : "Customers who paid and cannot use Pro — escalate"
        }
      />
      <StatTile
        label="Callbacks awaiting"
        value={formatCount(data.webhooksAwaitingCount)}
        icon={Inbox}
        tone="cyan"
        hint="Provider callbacks stored and signature-checked, but not yet applied. The worker drains these continuously, so a number that stays put is the signal."
        sub={`${formatCount(data.webhooksFailedCount)} parked · ${formatCount(data.webhooksProcessedCount)} processed`}
      />
      <StatTile
        label="Net collected"
        value={formatMoney(data.netMinor, data.currency)}
        icon={Banknote}
        tone="emerald"
        hint="Summed from the ledger, so it counts money that moved. Gifted subscriptions are absent by design: no payment, no entry."
        sub={`${formatMoney(data.creditedMinor, data.currency)} in · ${formatMoney(data.refundedMinor, data.currency)} refunded`}
      />
    </StatStrip>
  );
}

/**
 * The five states with their totals, each one a filter for the table below it.
 *
 * Clickable because the counts and the table are the same question at two zoom levels: reading "9
 * failed" and then hunting for the failures in a paged list is a step that the number itself can
 * take. Clicking the selected cell again clears it.
 */
function StateCounts({
  data,
  selected,
  onPick,
}: {
  data: PaymentOpsSummary;
  selected: PaymentStatus | typeof ALL;
  onPick: (status: PaymentStatus) => void;
}) {
  const counts: Record<PaymentStatus, number> = {
    Pending: data.pendingCount,
    Processing: data.processingCount,
    Verified: data.verifiedCount,
    Completed: data.completedCount,
    Failed: data.failedCount,
  };

  return (
    <Card
      title="Lifecycle"
      hint="Every attempt ever made, by state. Select one to filter the table."
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {PAYMENT_STATUSES.map((value) => {
          const active = selected === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => onPick(value)}
              aria-pressed={active}
              title={PAYMENT_STATUS_TITLES[value]}
              className={`flex flex-col items-start gap-2 rounded-sm border p-3 text-left transition ${
                active
                  ? "border-brand bg-brand/5"
                  : "border-border-light hover:border-border hover:bg-muted"
              }`}
            >
              <Badge tone={PAYMENT_TONES[value]}>{value}</Badge>
              <span className="text-[19px] font-semibold leading-none tabular-nums text-foreground">
                {formatCount(counts[value])}
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
