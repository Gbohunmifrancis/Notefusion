"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { getPayments, getPaymentsSummary } from "@/api/endpoints";
import type { PaymentProviderName, PaymentStatus } from "@/api/types";
import { Avatar } from "@/components/Avatar";
import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { Pager } from "@/components/Pager";
import { ReconcileButton } from "@/components/ReconcileButton";
import { StatStrip, StatTile } from "@/components/StatStrip";
import { StateView } from "@/components/StateView";
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
import { formatCount, formatInstantDateTime, formatMoney, formatRelative } from "@/lib/format";
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

/** Paid with no Pro (Verified) and stuck checkouts together: the work list, as the phone admin calls it. */
const NEEDS_LOOK = "needs-look";

type StatusFilter = PaymentStatus | typeof ALL | typeof NEEDS_LOOK;

/** "NoteFusion Pro (Monthly)" → "Pro Monthly", the phone admin's and the payment push's name for a plan. */
function shortPlan(name: string | null): string {
  const m = /^NoteFusion\s+(.+?)\s*\((.+)\)$/.exec(name?.trim() ?? "");
  return m ? `${m[1]} ${m[2]}` : name?.trim() || "—";
}

/**
 * Payments: every checkout across every account, newest first (the phone admin's Payments, at desk size). Three tiles
 * say the state of the money (today's takings per currency, paid with no Pro, stuck), the table has the web's
 * filters and status pills, and a row opens the payment's own page. Webhooks and the Ledger stay their own
 * Operations pages; the webhook rows link here.
 */
export function PaymentsView() {
  const [status, setStatus] = useState<StatusFilter>(ALL);
  const [provider, setProvider] = useState<PaymentProviderName | typeof ALL>(ALL);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounced(search);

  useEffect(() => setPage(1), [status, provider, debouncedSearch]);

  const term = debouncedSearch.trim();
  const filters = {
    ...(status === NEEDS_LOOK ? { needsLook: true } : status === ALL ? {} : { status }),
    ...(provider === ALL ? {} : { provider }),
    ...(term ? { search: term } : {}),
  };

  const state = useQuery({
    queryKey: ["payments", page, filters],
    queryFn: ({ signal }) => getPayments(page, PAGE_SIZE, filters, signal),
    placeholderData: keepPreviousData,
  });
  const summary = useQuery({
    queryKey: ["payments-summary"],
    queryFn: ({ signal }) => getPaymentsSummary(signal),
  });

  useClampPage(page, state.data?.totalPages, setPage);

  const offset = getReportingOffset();
  const filtered = Boolean(status !== ALL || provider !== ALL || term);
  const s = summary.data;
  const today = [...(s?.paidToday ?? [])].sort((a, b) => (a.currency === "NGN" ? -1 : b.currency === "NGN" ? 1 : a.currency.localeCompare(b.currency)));
  const now = Date.now();

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Payments"
        subtitle="Every checkout, newest first. A completed payment rings the admins' phones once."
        breadcrumb={["Dashboard", "Payments"]}
      />

      <StatStrip>
        <StatTile
          label="Today"
          value={today[0] ? formatMoney(today[0].amountMinor, today[0].currency) : formatMoney(0, "NGN")}
          sub={[
            ...today.slice(1).map((t) => formatMoney(t.amountMinor, t.currency)),
            `${formatCount(s?.paidTodayCount ?? 0)} paid`,
          ].join(" · ")}
          hint="Completed today, West Africa Time. Each currency on its own, never added together."
          unknown={!s}
        />
        <StatTile
          label="Paid, no Pro"
          value={formatCount(s?.verifiedCount ?? 0)}
          sub={s?.verifiedCount ? "Escalate: the sweep never touches these" : "None"}
          hint={PAYMENT_STATUS_TITLES.Verified}
          unknown={!s}
        />
        <StatTile
          label="Stuck"
          value={formatCount(s?.stuckCount ?? 0)}
          sub={s?.oldestStuckSinceUtc ? `Oldest ${formatRelative(s.oldestStuckSinceUtc, now)}` : "None"}
          {...(s
            ? {
                hint: `Still processing past the ${s.graceWindowMinutes}-minute grace window. The sweep asks every ${s.sweepIntervalMinutes} minutes; Reconcile asks now.`,
              }
            : {})}
          unknown={!s}
        />
        <StatTile
          label="Pro members"
          value={formatCount(s?.activeSubscribersCount ?? 0)}
          sub={s ? `${formatCount(s.expiringInSevenDaysCount)} ending in 7 days` : null}
          unknown={!s}
        />
      </StatStrip>

      <Card
        title="Checkouts"
        hint="Newest first. Search covers our reference, the provider's and the email."
        bleed
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={status} onValueChange={(next) => setStatus(next as StatusFilter)}>
              <SelectTrigger aria-label="Filter by state" className="h-9 w-[10.5rem] rounded-sm text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All states</SelectItem>
                <SelectItem value={NEEDS_LOOK}>Needs a look</SelectItem>
                {PAYMENT_STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={provider} onValueChange={(next) => setProvider(next as PaymentProviderName | typeof ALL)}>
              <SelectTrigger aria-label="Filter by provider" className="h-9 w-[10.5rem] rounded-sm text-[13px]">
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

            <label className="relative block">
              <span className="sr-only">Search by reference or email</span>
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Reference or email"
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
            status === NEEDS_LOOK ? "Nothing needs a look" : filtered ? "No payments match those filters" : "No payment has been attempted"
          }
          loadingLabel="Loading payments"
        >
          {(data) => (
            <>
              <div className="w-full min-w-0">
                <Table className="w-full min-w-[54rem]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className={TH}>Opened</TableHead>
                      <TableHead className={TH}>Customer</TableHead>
                      <TableHead className={`${TH} text-right`}>Amount</TableHead>
                      <TableHead className={TH}>Plan</TableHead>
                      <TableHead className={TH}>Provider</TableHead>
                      <TableHead className={TH}>State</TableHead>
                      <TableHead className={`${TH} text-right`}>
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className={TBODY}>
                    {data.items.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className={TD}>
                          <Link href={`/payments/${row.id}`} className="text-foreground transition hover:text-brand">
                            {formatInstantDateTime(row.createdAtUtc, offset)}
                          </Link>
                          <p className="font-mono text-[11px] text-faint">{row.reference}</p>
                        </TableCell>
                        <TableCell className={TD}>
                          <div className="flex items-center gap-2.5">
                            <Avatar name={row.userFullName || row.userEmail || "Customer"} size={26} />
                            <div className="min-w-0">
                              {row.userEmail ? (
                                <Link
                                  href={`/users/${row.userId}`}
                                  className="block truncate font-medium text-foreground transition hover:text-brand"
                                >
                                  {row.userFullName || row.userEmail}
                                </Link>
                              ) : (
                                <span className="text-faint">Deleted account</span>
                              )}
                              {row.userFullName && row.userEmail && (
                                <p className="truncate text-[11.5px] text-faint">{row.userEmail}</p>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className={`${TD} text-right font-semibold tabular-nums text-foreground`}>
                          {formatMoney(row.amountMinor, row.currency)}
                        </TableCell>
                        <TableCell className={TD}>{shortPlan(row.planName)}</TableCell>
                        <TableCell className={TD}>{row.provider}</TableCell>
                        <TableCell className={`${TD} whitespace-normal`}>
                          <Badge tone={PAYMENT_TONES[row.status]} title={PAYMENT_STATUS_TITLES[row.status]}>
                            {row.status}
                          </Badge>
                          {row.isStuck && (
                            <p className="mt-1 text-[11px] text-faint">Stuck {formatRelative(row.updatedAtUtc, now).replace(" ago", "")}</p>
                          )}
                        </TableCell>
                        <TableCell className={`${TD} text-right`}>
                          <div className="flex items-center justify-end gap-2">
                            {row.status === "Processing" && <ReconcileButton payment={row} />}
                            <Link
                              href={`/payments/${row.id}`}
                              className="rounded-sm px-2 py-1 text-[12.5px] font-medium text-brand transition hover:bg-muted"
                            >
                              Open
                            </Link>
                          </div>
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
