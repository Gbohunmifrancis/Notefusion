"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";

import { getUnpaidCheckouts } from "@/api/endpoints";
import type { UnpaidCheckout } from "@/api/types";
import { Avatar } from "@/components/Avatar";
import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { RangePicker, type Range } from "@/components/RangePicker";
import { Segmented } from "@/components/Segmented";
import { StateView } from "@/components/StateView";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { REASON_LABELS } from "@/lib/checkoutExits";
import { addDays, formatCount, formatInstantDateTime, formatMoney, reportingToday } from "@/lib/format";
import { TBODY, TD, TH } from "@/lib/tableClasses";

/* Unpaid checkouts: the person behind every checkout that was opened and not paid, the Growth page's "Why checkouts
 * end unpaid" one row at a time. What the provider's own page saw comes first, because most people never answer
 * "What stopped you?" (they close the tab); their answer, when they gave one, is beside it, and the last column says
 * whether they paid later, so the ones still worth a word are the rows with "Not yet". */

/** The API's reporting day is West Africa Time, as on the console's other pages. */
const OFFSET_MINUTES = 60;

type Filter = "all" | "answered" | "silent" | "declined" | "notPaid";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "answered", label: "Answered" },
  { value: "silent", label: "No answer" },
  { value: "declined", label: "Card declined" },
  { value: "notPaid", label: "Not paid since" },
] as const satisfies readonly { value: Filter; label: string }[];

const PROVIDERS: Record<string, string> = {
  bachs: "Bachs",
  paystack: "Paystack",
  flutterwave: "Flutterwave",
  googleplay: "Google Play",
};

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** "NoteFusion Pro (Monthly)" → "Pro Monthly", the Payments page's name for a plan. */
function shortPlan(name: string | null): string {
  const m = /^NoteFusion\s+(.+?)\s*\((.+)\)$/.exec(name?.trim() ?? "");
  return m ? `${m[1]} ${m[2]}` : name?.trim() || "—";
}

function matches(row: UnpaidCheckout, filter: Filter): boolean {
  switch (filter) {
    case "answered":
      return row.reason !== null;
    case "silent":
      return row.reason === null;
    case "declined":
      return row.attempt === "declined" || row.reason === "cardDeclined";
    case "notPaid":
      return row.paidLaterAtUtc === null;
    default:
      return true;
  }
}

/** What the provider's page and the app saw, in one line: the strongest signal first. */
function whatHappened(row: UnpaidCheckout, quick: number): { text: string; tone: "danger" | "warning" | "neutral" } {
  if (row.attempt === "declined") return { text: "Tried to pay, declined", tone: "danger" };
  if (row.attempt === "transferStarted" || row.status === "processing") return { text: "Transfer under way", tone: "warning" };
  if (!row.cameBack) return { text: "Left the page, never came back", tone: "neutral" };
  if (row.secondsOpen !== null && row.secondsOpen < quick) return { text: `Closed in ${row.secondsOpen} s`, tone: "neutral" };
  return { text: row.secondsOpen !== null ? `Looked for ${clock(row.secondsOpen)}, no attempt` : "Came back, no attempt", tone: "neutral" };
}

export function CheckoutsView() {
  const [range, setRange] = useState<Range | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const state = useQuery({
    queryKey: ["unpaid-checkouts", range?.from, range?.to],
    queryFn: ({ signal }) => getUnpaidCheckouts(range?.from, range?.to, signal),
    placeholderData: keepPreviousData,
  });
  const picker: Range = range ?? { from: addDays(reportingToday(OFFSET_MINUTES), -29), to: reportingToday(OFFSET_MINUTES) };
  const rows = useMemo(() => (state.data?.rows ?? []).filter((r) => matches(r, filter)), [state.data, filter]);

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Unpaid checkouts"
        subtitle="Everyone who opened a payment page and did not pay: what the page saw, what they told us, and whether they paid later."
        breadcrumb={["Dashboard", "Growth", "Unpaid checkouts"]}
      />
      <div className="flex flex-wrap items-center gap-3 nf-panel p-3">
        <RangePicker value={picker} offsetMinutes={OFFSET_MINUTES} onChange={setRange} />
        <Segmented label="Show" options={FILTERS} value={filter} onChange={setFilter} />
        {state.isFetching && <span className="text-xs text-muted-foreground">Updating…</span>}
      </div>
      <StateView state={state} loadingLabel="Loading unpaid checkouts">
        {(d) => {
          const answered = d.rows.filter((r) => r.reason !== null).length;
          const paidLater = d.rows.filter((r) => r.paidLaterAtUtc !== null).length;
          return (
            <Card
              title={`${formatCount(d.total)} unpaid ${d.total === 1 ? "checkout" : "checkouts"}`}
              hint={`${formatCount(answered)} answered "What stopped you?" · ${formatCount(paidLater)} paid later${
                d.total > d.rows.length ? ` · the newest ${formatCount(d.rows.length)} listed` : ""
              }`}
              info="A checkout counts when its payment page was handed out and it was not paid. What happened is read from the provider's page whenever the API checked the session, and from the app or website reporting the person came back without paying. Paid later: the same account completed a payment (any plan) after this checkout. The team's own accounts are left out."
              bleed
            >
              {rows.length === 0 ? (
                <p className="px-5 pb-5 text-sm text-muted-foreground">No checkouts match.</p>
              ) : (
                <div className="w-full min-w-0 overflow-x-auto">
                  <Table className="w-full min-w-[60rem]">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className={TH}>Opened</TableHead>
                        <TableHead className={TH}>Customer</TableHead>
                        <TableHead className={`${TH} text-right`}>Amount</TableHead>
                        <TableHead className={TH}>What happened</TableHead>
                        <TableHead className={TH}>Their answer</TableHead>
                        <TableHead className={TH}>Paid later</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className={TBODY}>
                      {rows.map((row) => {
                        const seen = whatHappened(row, d.quickSeconds);
                        return (
                          <TableRow key={row.paymentId}>
                            <TableCell className={TD}>
                              <Link href={`/payments/${row.paymentId}`} className="text-foreground transition hover:text-brand">
                                {formatInstantDateTime(row.openedAtUtc, d.reportingOffsetMinutes)}
                              </Link>
                              <p className="text-[11px] text-faint">
                                {PROVIDERS[row.provider] ?? row.provider} · {row.client === "phone" ? "Phone" : "Web"}
                              </p>
                            </TableCell>
                            <TableCell className={TD}>
                              <div className="flex items-center gap-2.5">
                                <Avatar name={row.name || row.email || "Customer"} size={26} />
                                <div className="min-w-0">
                                  {row.email ? (
                                    <Link
                                      href={`/users/${row.userId}`}
                                      className="block truncate font-medium text-foreground transition hover:text-brand"
                                    >
                                      {row.name || row.email}
                                    </Link>
                                  ) : (
                                    <span className="text-faint">Deleted account</span>
                                  )}
                                  {row.name && row.email && <p className="truncate text-[11.5px] text-faint">{row.email}</p>}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className={`${TD} text-right`}>
                              <span className="font-semibold tabular-nums text-foreground">{formatMoney(row.amountMinor, row.currency)}</span>
                              <p className="text-[11px] text-faint">{shortPlan(row.planName)}</p>
                            </TableCell>
                            <TableCell className={`${TD} whitespace-normal`}>
                              <Badge tone={seen.tone}>{seen.text}</Badge>
                            </TableCell>
                            <TableCell className={`${TD} max-w-[18rem] whitespace-normal`}>
                              {row.reason ? (
                                <>
                                  <p className="text-foreground">{REASON_LABELS[row.reason]}</p>
                                  {row.note && <p className="mt-0.5 break-words text-[12px] text-muted-foreground">“{row.note}”</p>}
                                </>
                              ) : (
                                <span className="text-faint">{row.cameBack ? "No answer" : "Not asked"}</span>
                              )}
                            </TableCell>
                            <TableCell className={TD}>
                              {row.paidLaterAtUtc ? (
                                <Badge tone="success">{formatInstantDateTime(row.paidLaterAtUtc, d.reportingOffsetMinutes)}</Badge>
                              ) : (
                                <span className="text-faint">Not yet</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>
          );
        }}
      </StateView>
    </div>
  );
}
