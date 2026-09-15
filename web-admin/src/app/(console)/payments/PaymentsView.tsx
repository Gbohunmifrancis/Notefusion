"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Banknote,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  DollarSign,
  Inbox,
  MoreHorizontal,
  Search,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { clearStalePayments, getPayments, getPaymentsSummary } from "@/api/endpoints";
import type {
  AdminPaymentRow,
  PaymentOpsSummary,
  PaymentProviderName,
  PaymentStatus,
} from "@/api/types";
import { Avatar } from "@/components/Avatar";
import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { ReconcileButton } from "@/components/ReconcileButton";
import { StatStrip, StatTile } from "@/components/StatStrip";
import { StateView } from "@/components/StateView";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  formatCount,
  formatInstantDateTime,
  formatMoney,
} from "@/lib/format";
import {
  PAYMENT_PROVIDERS,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_TITLES,
  PAYMENT_TONES,
} from "@/lib/payments";
import { getReportingOffset } from "@/lib/reporting";
import { useClampPage } from "@/lib/useClampPage";
import { useDebounced } from "@/lib/useDebounced";

const PAGE_SIZE = 30;

const ALL = "all";

export function PaymentsView() {
  const [status, setStatus] = useState<PaymentStatus | typeof ALL>(ALL);
  const [provider, setProvider] = useState<PaymentProviderName | typeof ALL>(ALL);
  const [stuckOnly, setStuckOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounced(search);

  useEffect(
    () => setPage(1),
    [status, provider, stuckOnly, debouncedSearch],
  );

  const offset = getReportingOffset();
  const term = debouncedSearch.trim();

  const filters = {
    ...(status === ALL ? {} : { status }),
    ...(provider === ALL ? {} : { provider }),
    ...(stuckOnly ? { stuckOnly: true } : {}),
    ...(term ? { search: term } : {}),
  };

  const state = useQuery({
    queryKey: ["payments", page, filters],
    queryFn: ({ signal }) => getPayments(page, PAGE_SIZE, filters, signal),
    placeholderData: keepPreviousData,
  });

  useClampPage(page, state.data?.totalPages, setPage);

  const summary = useQuery({
    queryKey: ["payments-summary"],
    queryFn: ({ signal }) => getPaymentsSummary(signal),
  });

  const queryClient = useQueryClient();
  const [sweeping, setSweeping] = useState(false);

  const handleSweepStale = async () => {
    try {
      setSweeping(true);
      const res = await clearStalePayments();
      toast.success(
        `Cleared ${res.clearedPendingCount} pending and ${res.clearedProcessingCount} processing checkout(s). Fulfilled ${res.fulfilledCount}.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["payments"] });
      void queryClient.invalidateQueries({ queryKey: ["payments-summary"] });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to sweep stale payments";
      toast.error(msg);
    } finally {
      setSweeping(false);
    }
  };

  const filtered = Boolean(status !== ALL || provider !== ALL || stuckOnly || term);

  return (
    <div className="animate-fade-in space-y-6">
      {/* HEADER MATCHING MOCKUP */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Transactions
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Revenue and payment activity for your NoteFusion account.
          </p>
        </div>
        <Button
          onClick={handleSweepStale}
          disabled={sweeping}
          variant="outline"
          className="flex items-center gap-2 text-xs"
        >
          <Sparkles className={`h-3.5 w-3.5 ${sweeping ? "animate-spin text-amber-500" : "text-amber-500"}`} />
          {sweeping ? "Sweeping Stale..." : "Sweep Stale Checkouts"}
        </Button>
      </div>

      {/* 4 TOP KPI CARDS */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TransactionKpiCard
          kpi={{
            title: "Total revenue",
            value: summary.data
              ? formatMoney(summary.data.netMinor, summary.data.currency)
              : summary.isLoading
              ? "..."
              : formatMoney(0, "USD"),
            description: summary.data
              ? `${formatMoney(summary.data.mrrMinor, summary.data.currency)} MRR · ${formatMoney(summary.data.creditedMinor, summary.data.currency)} credited`
              : "Net settled revenue",
            icon: DollarSign,
          }}
        />
        <TransactionKpiCard
          kpi={{
            title: "Successful payments",
            value: summary.data
              ? formatCount(summary.data.completedCount)
              : summary.isLoading
              ? "..."
              : "0",
            description: summary.data
              ? `${summary.data.activeSubscribersCount} active Pro (${summary.data.expiringInSevenDaysCount} expiring ≤7d)`
              : "Settled payments",
            icon: CreditCard,
          }}
        />
        <TransactionKpiCard
          kpi={{
            title: "Failed payments",
            value: summary.data
              ? formatCount(summary.data.failedCount)
              : summary.isLoading
              ? "..."
              : "0",
            description: summary.data && summary.data.stuckCount > 0
              ? `${formatCount(summary.data.stuckCount)} overdue/stuck`
              : "Failed transactions",
            icon: AlertTriangle,
            tone: summary.data && summary.data.failedCount > 0 ? "danger" : undefined,
          }}
        />
        <TransactionKpiCard
          kpi={{
            title: "Avg. order value",
            value: summary.data && summary.data.completedCount > 0
              ? formatMoney(Math.round(summary.data.netMinor / summary.data.completedCount), summary.data.currency)
              : formatMoney(0, summary.data?.currency ?? "USD"),
            description: summary.data && summary.data.completedCount > 0
              ? `Across ${formatCount(summary.data.completedCount)} payments`
              : "Average per transaction",
            icon: Banknote,
          }}
        />
      </div>

      {/* TRANSACTIONS TABLE CARD MATCHING MOCKUP */}
      <div className="rounded-xl border border-slate-200/80 bg-white shadow-xs dark:border-zinc-800 dark:bg-[#09090b] overflow-hidden">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 p-5 dark:border-zinc-800">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Transactions
          </h2>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <Input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search email or reference..."
                className="h-8.5 w-48 rounded-lg border-slate-200 bg-white pl-8 text-xs shadow-xs dark:border-zinc-800 dark:bg-[#09090b] dark:text-white"
              />
            </div>

            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as any)}
              className="h-8.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-xs outline-none dark:border-zinc-800 dark:bg-[#09090b] dark:text-slate-200"
            >
              <option value={ALL}>All statuses</option>
              {PAYMENT_STATUSES.map((val) => (
                <option key={val} value={val}>
                  {val}
                </option>
              ))}
            </select>

            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as any)}
              className="h-8.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-xs outline-none dark:border-zinc-800 dark:bg-[#09090b] dark:text-slate-200"
            >
              <option value={ALL}>All providers</option>
              {PAYMENT_PROVIDERS.map((val) => (
                <option key={val} value={val}>
                  {val}
                </option>
              ))}
            </select>

            <label className="flex h-8.5 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 shadow-xs dark:border-zinc-800 dark:bg-[#09090b] dark:text-slate-300">
              <Checkbox
                checked={stuckOnly}
                onCheckedChange={(checked) => setStuckOnly(checked === true)}
              />
              <span>Overdue only</span>
            </label>

            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-xs dark:border-zinc-800 dark:bg-[#09090b] dark:text-slate-200">
              <span>Last 30 days</span>
            </div>
          </div>
        </div>

        <StateView
          state={state}
          isEmpty={(data) => data.items.length === 0}
          emptyMessage={filtered ? "No payments match those filters" : "No payment has been attempted"}
          loadingLabel="Loading payments"
        >
          {(data) => {
            const totalCount = data.totalCount;
            const totalPages = Math.max(1, data.totalPages);
            const startItem = totalCount > 0 ? (page - 1) * PAGE_SIZE + 1 : 0;
            const endItem = Math.min(page * PAGE_SIZE, totalCount);

            const pageNumbers: number[] = [];
            const maxP = Math.min(totalPages, 5);
            for (let i = 1; i <= maxP; i++) pageNumbers.push(i);

            return (
              <>
                <div className="w-full min-w-0 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-100 bg-slate-50/50 text-slate-500 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-slate-400">
                      <tr>
                        <th className="w-12 px-4 py-3">
                          <Checkbox aria-label="Select all transactions" />
                        </th>
                        <th className="px-4 py-3 font-medium">Date</th>
                        <th className="px-4 py-3 font-medium">Customer</th>
                        <th className="px-4 py-3 font-medium">Amount</th>
                        <th className="px-4 py-3 font-medium">Plan</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Payment method</th>
                        <th className="w-12 px-4 py-3 text-right"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-zinc-800">
                      {data.items.map((row) => (
                        <tr
                          key={row.id}
                          className="transition hover:bg-slate-50/70 dark:hover:bg-zinc-900/40"
                        >
                          <td className="px-4 py-3">
                            <Checkbox aria-label={`Select transaction ${row.reference}`} />
                          </td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            {formatInstantDateTime(row.createdAtUtc, offset)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <Avatar
                                name={row.userFullName ?? row.userEmail ?? "Customer"}
                                size={26}
                              />
                              <div className="min-w-0">
                                {row.userEmail ? (
                                  <Link
                                    href={`/users/${row.userId}`}
                                    className="block truncate font-semibold text-slate-900 hover:text-[#2563EB] dark:text-slate-100 dark:hover:text-blue-400"
                                  >
                                    {row.userFullName || row.userEmail}
                                  </Link>
                                ) : (
                                  <span className="text-slate-400">Deleted user</span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white tabular-nums">
                            {formatMoney(row.amountMinor, row.currency)}
                          </td>
                          <td className="px-4 py-3">
                            <PaymentPlanBadge plan={row.planName} />
                          </td>
                          <td className="px-4 py-3">
                            <PaymentStatusBadge status={row.status} />
                          </td>
                          <td className="px-4 py-3">
                            <PaymentMethodBadge row={row} />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {row.status === "Processing" && <ReconcileButton payment={row} />}
                              <Button
                                asChild
                                variant="ghost"
                                size="icon"
                                className="size-7 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                                title="View transaction details"
                              >
                                <Link href={`/payments/${row.id}`}>
                                  <MoreHorizontal size={15} />
                                </Link>
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* FOOTER PAGINATION */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-slate-100 px-5 py-3.5 dark:border-zinc-800">
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Showing {startItem}-{endItem} of {totalCount} transactions
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 dark:border-zinc-800 dark:text-slate-400 dark:hover:bg-zinc-800"
                      aria-label="Previous page"
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
                            : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-zinc-800"
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                    <button
                      type="button"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 dark:border-zinc-800 dark:text-slate-400 dark:hover:bg-zinc-800"
                      aria-label="Next page"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              </>
            );
          }}
        </StateView>
      </div>

      {/* OPERATIONS SNAPSHOT (Collapsible / secondary) */}
      <StateView state={summary} loadingLabel="Loading operational metrics">
        {(data) => (
          <div className="space-y-4 pt-4 border-t border-slate-200/80 dark:border-zinc-800">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Gateway operations &amp; lifecycle
            </h3>
            <Snapshot data={data} offset={offset} />
            <StateCounts
              data={data}
              selected={status}
              onPick={(next) => setStatus((current) => (current === next ? ALL : next))}
            />
          </div>
        )}
      </StateView>
    </div>
  );
}

interface TransactionKpi {
  title: string;
  value: string;
  change?: string | null | undefined;
  description?: string | null | undefined;
  icon: any;
  tone?: "danger" | "emerald" | undefined;
}

function TransactionKpiCard({ kpi }: { kpi: TransactionKpi }) {
  const Icon = kpi.icon;
  const isDanger = kpi.tone === "danger";

  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm dark:border-zinc-800 dark:bg-[#09090b]">
      <div className="flex items-center justify-between">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-zinc-900 dark:text-slate-300">
          <Icon size={18} strokeWidth={1.75} />
        </div>
      </div>

      <div className="mt-3.5">
        <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
          {kpi.title}
        </div>

        <div className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          {kpi.value}
        </div>

        {kpi.change ? (
          <div
            className={`mt-2 flex items-center gap-1 text-xs font-medium ${
              isDanger
                ? "text-rose-600 dark:text-rose-400"
                : "text-emerald-600 dark:text-emerald-400"
            }`}
          >
            <span>↑ {kpi.change}</span>
            {kpi.description && (
              <span className="font-normal text-slate-400 dark:text-slate-500">
                {kpi.description}
              </span>
            )}
          </div>
        ) : kpi.description ? (
          <div className="mt-2 text-xs text-slate-400 dark:text-slate-500">
            {kpi.description}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PaymentPlanBadge({ plan }: { plan: string | null }) {
  const name = (plan ?? "Pro").toLowerCase();
  if (name.includes("free")) {
    return (
      <span className="inline-flex items-center rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-zinc-800 dark:text-zinc-300">
        Free
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-[#2563EB] dark:bg-blue-950/60 dark:text-blue-400">
      Pro
    </span>
  );
}

function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  if (status === "Completed" || status === "Verified") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Success
      </span>
    );
  }
  if (status === "Failed") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-950/50 dark:text-rose-400">
        <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
        Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      {status}
    </span>
  );
}

function PaymentMethodBadge({ row }: { row: AdminPaymentRow }) {
  const last4 = row.providerReference ? row.providerReference.slice(-4) : "4242";
  return (
    <div className="flex items-center gap-2 font-mono text-xs text-slate-600 dark:text-slate-400">
      <CreditCard size={14} className="text-slate-400" />
      <span>•••• {last4}</span>
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
