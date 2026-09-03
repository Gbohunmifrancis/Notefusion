"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { Fragment, useEffect, useState } from "react";

import { getWebhook, getWebhooks } from "@/api/endpoints";
import type { PaymentProviderName, WebhookStatus } from "@/api/types";
import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { Pager } from "@/components/Pager";
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
import { UNKNOWN, formatCount, formatInstantDateTime } from "@/lib/format";
import { PAYMENT_PROVIDERS, WEBHOOK_STATUSES, WEBHOOK_STATUS_META } from "@/lib/payments";
import { getReportingOffset } from "@/lib/reporting";
import { TBODY, TD, TH } from "@/lib/tableClasses";
import { useClampPage } from "@/lib/useClampPage";
import { useDebounced } from "@/lib/useDebounced";

const PAGE_SIZE = 30;

/** Radix reserves "" for "no value selected", so the unfiltered case needs a name of its own. */
const ALL = "all";

const PRE =
  "max-h-80 overflow-auto rounded-sm border border-border-light bg-muted p-3 font-mono text-[11.5px] leading-relaxed text-muted-foreground";

/** Seven data columns, so the payload row has to span all of them plus the toggle. */
const COLUMNS = 7;

/**
 * The webhook inbox: every callback a provider sent, stored once and applied at most once. It is
 * what makes a duplicate delivery harmless, and it is the first place to look when a payment settled
 * with the provider and not with us.
 *
 * There is no replay button, deliberately. Nothing in the domain replays a stored callback, and it
 * would be redundant if it did: reconciling the payment asks the provider directly and applies the
 * answer, whether or not this row ever drains. A parked event is a bug to read, not access to
 * restore — which is why the payload is one click away on every row.
 */
export function WebhooksView() {
  const [status, setStatus] = useState<WebhookStatus | typeof ALL>(ALL);
  const [provider, setProvider] = useState<PaymentProviderName | typeof ALL>(ALL);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const debouncedSearch = useDebounced(search);

  useEffect(() => setPage(1), [status, provider, debouncedSearch]);

  const term = debouncedSearch.trim();
  const filters = {
    ...(status === ALL ? {} : { status }),
    ...(provider === ALL ? {} : { provider }),
    ...(term ? { search: term } : {}),
  };

  const state = useQuery({
    queryKey: ["webhooks", page, filters],
    queryFn: ({ signal }) => getWebhooks(page, PAGE_SIZE, filters, signal),
    placeholderData: keepPreviousData,
  });

  // A tightened status/provider filter can leave the current page past the end of the shorter
  // result — step back to the last real page instead of stranding an empty view.
  useClampPage(page, state.data?.totalPages, setPage);

  const offset = getReportingOffset();
  const filtered = Boolean(status !== ALL || provider !== ALL || term);

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Webhook inbox"
        subtitle="Every provider callback, stored once so it can only be applied once."
        breadcrumb={["Dashboard", "Payments", "Webhook inbox"]}
      />

      <Card
        title="Callbacks"
        hint="Newest first. Signature-checked before storage, so nothing here is unverified."
        bleed
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={status}
              onValueChange={(next) => setStatus(next as WebhookStatus | typeof ALL)}
            >
              <SelectTrigger
                aria-label="Filter by state"
                className="h-9 w-[10.5rem] rounded-sm text-[13px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All states</SelectItem>
                {WEBHOOK_STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {WEBHOOK_STATUS_META[value].label}
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

            <label className="relative block">
              <span className="sr-only">Search by event type, event id or payment reference</span>
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Event or reference"
                className="w-56 rounded-sm pl-9 placeholder:text-faint md:text-[13px]"
              />
            </label>
          </div>
        }
      >
        <StateView
          state={state}
          isEmpty={(data) => data.items.length === 0}
          emptyMessage={filtered ? "No callbacks match those filters" : "No callback has arrived"}
          {...(filtered
            ? {}
            : {
                emptyHint:
                  "Providers post here after a customer pays. An empty inbox with completed payments means the webhook URL is not configured.",
              })}
          loadingLabel="Loading the inbox"
        >
          {(data) => (
            <>
              <div className="border-t border-border">
                <Table className="min-w-[68rem]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className={`${TH} w-10`}>
                        <span className="sr-only">Payload</span>
                      </TableHead>
                      <TableHead className={TH}>Received</TableHead>
                      <TableHead className={TH}>Provider</TableHead>
                      <TableHead className={TH}>Event</TableHead>
                      <TableHead className={TH}>Payment</TableHead>
                      <TableHead className={TH}>State</TableHead>
                      <TableHead className={`${TH} text-right`}>Tries</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className={TBODY}>
                    {data.items.map((row) => {
                      const meta = WEBHOOK_STATUS_META[row.status];
                      const expanded = open === row.id;

                      return (
                        // The row and its payload are two `<tr>`s, so the key belongs on the
                        // fragment holding both rather than on either one.
                        <Fragment key={row.id}>
                          <TableRow>
                            <TableCell className={TD}>
                              <button
                                type="button"
                                onClick={() => setOpen(expanded ? null : row.id)}
                                aria-expanded={expanded}
                                title={expanded ? "Hide the payload" : "Show the payload"}
                                className="grid size-6 place-items-center rounded-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
                              >
                                {expanded ? (
                                  <ChevronDown className="size-4" aria-hidden="true" />
                                ) : (
                                  <ChevronRight className="size-4" aria-hidden="true" />
                                )}
                                <span className="sr-only">
                                  {expanded ? "Hide the payload" : "Show the payload"}
                                </span>
                              </button>
                            </TableCell>

                            <TableCell className={TD}>
                              {formatInstantDateTime(row.receivedAtUtc, offset)}
                              {row.processedAtUtc && (
                                <p className="mt-0.5 text-[11px] text-faint">
                                  Applied {formatInstantDateTime(row.processedAtUtc, offset)}
                                </p>
                              )}
                            </TableCell>

                            <TableCell className={TD}>{row.provider}</TableCell>

                            <TableCell className={TD}>
                              <span className="font-mono text-[11.5px] text-foreground">
                                {row.eventType}
                              </span>
                              {/* The provider's own id for the delivery. It is what the inbox
                                  deduplicates on, so it is what to quote to their support. */}
                              <p className="font-mono text-[11px] text-faint">
                                {row.providerEventId}
                              </p>
                            </TableCell>

                            <TableCell className={TD}>
                              {row.paymentTransactionId ? (
                                <Link
                                  href={`/payments/${row.paymentTransactionId}`}
                                  className="font-mono text-[11.5px] text-brand transition hover:underline"
                                >
                                  {row.paymentReference ?? "Open"}
                                </Link>
                              ) : (
                                // A callback naming a reference we have no row for is the shape a
                                // misconfigured shared gateway account takes.
                                <span className="font-mono text-[11.5px] text-faint">
                                  {row.paymentReference ?? UNKNOWN}
                                </span>
                              )}
                            </TableCell>

                            {/* Wraps: the last error is the sentence that explains a parked row. */}
                            <TableCell className={`${TD} whitespace-normal`}>
                              <Badge tone={meta.tone} title={meta.title}>
                                {meta.label}
                              </Badge>
                              {row.lastError && (
                                <p className="mt-1 max-w-[18rem] text-[11px] text-faint">
                                  {row.lastError}
                                </p>
                              )}
                            </TableCell>

                            <TableCell className={`${TD} text-right tabular-nums`}>
                              {formatCount(row.processAttempts)}
                              {row.lastAttemptAtUtc && (
                                <p className="text-[11px] font-normal text-faint">
                                  {formatInstantDateTime(row.lastAttemptAtUtc, offset)}
                                </p>
                              )}
                            </TableCell>
                          </TableRow>

                          {expanded && (
                            <TableRow className="hover:bg-transparent">
                              <TableCell colSpan={COLUMNS} className="px-4 py-3">
                                <Payload id={row.id} />
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
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

/**
 * The stored request body, fetched only when a row is opened — it is a whole HTTP body per line, so
 * the list route leaves it out and this asks for the one the reader wants.
 *
 * A component rather than a lifted query so the fetch begins on expand and the result stays cached
 * under its own key when the row is closed and opened again.
 */
function Payload({ id }: { id: string }) {
  const state = useQuery({
    queryKey: ["webhook", id],
    queryFn: ({ signal }) => getWebhook(id, signal),
  });

  return (
    <StateView state={state} loadingLabel="Loading the payload">
      {(detail) => <pre className={PRE}>{pretty(detail.payload)}</pre>}
    </StateView>
  );
}

/**
 * Pretty-printed when it parses, verbatim when it does not — a body that is not JSON is itself the
 * finding, so nothing here hides what it cannot format.
 */
function pretty(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw) as unknown, null, 2);
  } catch {
    return raw;
  }
}
