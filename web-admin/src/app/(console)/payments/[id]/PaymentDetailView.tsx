"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ExternalLink, ShieldAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { getPayment } from "@/api/endpoints";
import type { AdminPaymentDetail } from "@/api/types";
import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { ReconcileButton } from "@/components/ReconcileButton";
import { StateView } from "@/components/StateView";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UNKNOWN, formatCount, formatInstantDateTime, formatMoney } from "@/lib/format";
import {
  LEDGER_REASON_LABELS,
  PAYMENT_STATUS_TITLES,
  PAYMENT_TONES,
  WEBHOOK_STATUS_META,
} from "@/lib/payments";
import { getReportingOffset } from "@/lib/reporting";
import { TBODY, TD, TH } from "@/lib/tableClasses";

const ACTION = "h-9 gap-1.5 text-[13px] font-semibold";

const PRE =
  "max-h-80 overflow-auto rounded-sm border border-border-light bg-muted p-3 font-mono text-[11.5px] leading-relaxed text-muted-foreground";

/**
 * One payment, with everything the three tiers recorded about it: our row, the gateway's own words,
 * the callbacks it sent, and the ledger entry it did or did not produce.
 *
 * This is the page an operator opens with a customer on the phone, so the two states that mean the
 * customer is out of pocket get a banner rather than a badge.
 */
export function PaymentDetailView({ id }: { id: string }) {
  const state = useQuery({
    queryKey: ["payment", id],
    queryFn: ({ signal }) => getPayment(id, signal),
  });

  const offset = getReportingOffset();
  const payment = state.data?.payment;

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Payment"
        subtitle="One attempt in full, including the gateway's own words."
        breadcrumb={["Dashboard", "Payments", payment?.reference ?? "…"]}
        actions={
          <>
            {payment && <ReconcileButton payment={payment} />}
            <Button asChild variant="outline" className={ACTION}>
              <Link href="/payments">
                <ArrowLeft className="size-3.5" aria-hidden="true" />
                All payments
              </Link>
            </Button>
          </>
        }
      />

      <StateView state={state} loadingLabel="Loading payment">
        {(detail) => (
          <div className="space-y-5">
            {detail.payment.status === "Verified" && (
              <Banner tone="danger" icon={<ShieldAlert className="mt-[1px] size-4 shrink-0" />}>
                The provider confirmed this money and the subscription was never applied. The
                customer has paid and cannot use Pro. Reconciliation only acts on payments still
                processing, so it will not recover this one — it needs a developer.
              </Banner>
            )}

            {detail.payment.isStuck && (
              <Banner tone="warning" icon={<AlertTriangle className="mt-[1px] size-4 shrink-0" />}>
                Still processing past the grace window. The sweep will ask the provider about it
                shortly; reconciling here only skips the wait.
              </Banner>
            )}

            <AttemptCard detail={detail} offset={offset} />

            <div className="grid gap-5 xl:grid-cols-2">
              <LedgerCard detail={detail} offset={offset} />
              <CallbacksCard detail={detail} offset={offset} />
            </div>

            <GatewayCard detail={detail} />
          </div>
        )}
      </StateView>
    </div>
  );
}

function Banner({
  tone,
  icon,
  children,
}: {
  tone: "danger" | "warning";
  icon: ReactNode;
  children: ReactNode;
}) {
  const skin =
    tone === "danger"
      ? "border-danger/30 bg-danger/10 text-danger-deep"
      : "border-warning/30 bg-warning/10 text-warning-deep";

  return (
    <p
      className={`flex items-start gap-2.5 rounded-md border px-4 py-3 text-[13px] ${skin}`}
      role="status"
    >
      <span aria-hidden="true">{icon}</span>
      <span>{children}</span>
    </p>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</dt>
      <dd className="mt-1 break-words text-[13px] text-foreground">{children}</dd>
    </div>
  );
}

function AttemptCard({ detail, offset }: { detail: AdminPaymentDetail; offset: number }) {
  const { payment } = detail;

  return (
    <Card title="Attempt">
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Status">
          <Badge tone={PAYMENT_TONES[payment.status]} title={PAYMENT_STATUS_TITLES[payment.status]}>
            {payment.status}
          </Badge>
        </Field>
        <Field label="Amount">
          <span className="font-medium tabular-nums">
            {formatMoney(payment.amountMinor, payment.currency)}
          </span>
        </Field>
        <Field label="Plan">{payment.planName ?? UNKNOWN}</Field>

        <Field label="Account">
          {/* No foreign key ties a payment to a user, so the row outlives the account and the id is
              all that is left of it. */}
          {payment.userEmail ? (
            <Link
              href={`/users/${payment.userId}`}
              className="text-brand transition hover:underline"
            >
              {payment.userEmail}
            </Link>
          ) : (
            <span className="text-faint">Deleted — id {payment.userId}</span>
          )}
          {payment.userFullName && (
            <p className="mt-0.5 text-[11px] text-faint">{payment.userFullName}</p>
          )}
        </Field>
        <Field label="Provider">{payment.provider}</Field>
        <Field label="Provider reference">
          <span className="font-mono text-[11.5px]">{payment.providerReference ?? UNKNOWN}</span>
        </Field>

        <Field label="Our reference">
          <span className="font-mono text-[11.5px]">{payment.reference}</span>
        </Field>
        <Field label="Idempotency key">
          {/* Two rows sharing this are one initiation retried, not two charges. */}
          <span className="font-mono text-[11.5px]">{detail.idempotencyKey}</span>
        </Field>
        <Field label="Checkout page">
          {detail.checkoutUrl ? (
            <a
              href={detail.checkoutUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 break-all font-mono text-[11.5px] text-brand transition hover:underline"
            >
              {detail.checkoutUrl}
              <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
            </a>
          ) : (
            UNKNOWN
          )}
        </Field>

        <Field label="Started">{formatInstantDateTime(payment.createdAtUtc, offset)}</Field>
        <Field label="Last change">{formatInstantDateTime(payment.updatedAtUtc, offset)}</Field>

        {payment.failureReason && (
          <div className="min-w-0 sm:col-span-2 lg:col-span-3">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-faint">
              Failure reason
            </dt>
            <dd className="mt-1 break-words text-[13px] text-foreground">
              {payment.failureReason}
            </dd>
          </div>
        )}
      </dl>
    </Card>
  );
}

function LedgerCard({ detail, offset }: { detail: AdminPaymentDetail; offset: number }) {
  // A settled payment with no entry is the one combination that is a bug rather than a stage, so the
  // empty state reads differently depending on which it is.
  const empty =
    detail.payment.status === "Completed"
      ? "This payment is settled and wrote no ledger entry. That should not be possible — report it."
      : "No entry yet. One is written when the payment completes.";

  return (
    <Card title="Ledger" hint="What this payment recognised as money." bleed>
      {detail.ledger.length === 0 ? (
        <p className="px-5 pb-5 text-[13px] text-muted-foreground">{empty}</p>
      ) : (
        <div className="w-full min-w-0">
          <Table className="min-w-[34rem]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={TH}>When</TableHead>
                <TableHead className={TH}>Reason</TableHead>
                <TableHead className={TH}>Description</TableHead>
                <TableHead className={`${TH} text-right`}>Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className={TBODY}>
              {detail.ledger.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className={TD}>
                    {formatInstantDateTime(entry.createdAtUtc, offset)}
                  </TableCell>
                  <TableCell className={TD}>
                    <Badge tone={entry.reason === "Refund" ? "warning" : "neutral"}>
                      {LEDGER_REASON_LABELS[entry.reason]}
                    </Badge>
                  </TableCell>
                  <TableCell className={`${TD} whitespace-normal`}>{entry.description}</TableCell>
                  <TableCell className={`${TD} text-right tabular-nums text-foreground`}>
                    {entry.direction === "Credit" ? "+" : "−"}
                    {formatMoney(entry.amountMinor, entry.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

function CallbacksCard({ detail, offset }: { detail: AdminPaymentDetail; offset: number }) {
  return (
    <Card
      title="Provider callbacks"
      hint="Everything the gateway sent us about this payment, stored once each."
      bleed
    >
      {detail.webhookEvents.length === 0 ? (
        <p className="px-5 pb-5 text-[13px] text-muted-foreground">
          None arrived. That alone does not hold the subscription up — reconciliation asks the
          provider directly and applies the answer whether or not a callback ever lands.
        </p>
      ) : (
        <div className="border-t border-border">
          <Table className="min-w-[34rem]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={TH}>Received</TableHead>
                <TableHead className={TH}>Event</TableHead>
                <TableHead className={TH}>State</TableHead>
                <TableHead className={`${TH} text-right`}>Tries</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className={TBODY}>
              {detail.webhookEvents.map((event) => {
                const meta = WEBHOOK_STATUS_META[event.status];
                return (
                  <TableRow key={event.id}>
                    <TableCell className={TD}>
                      {formatInstantDateTime(event.receivedAtUtc, offset)}
                    </TableCell>
                    <TableCell className={TD}>
                      <span className="font-mono text-[11.5px] text-foreground">
                        {event.eventType}
                      </span>
                    </TableCell>
                    {/* Wraps: a parked event's last error is the sentence that explains it. */}
                    <TableCell className={`${TD} whitespace-normal`}>
                      <Badge tone={meta.tone} title={meta.title}>
                        {meta.label}
                      </Badge>
                      {event.lastError && (
                        <p className="mt-1 max-w-[18rem] text-[11px] text-faint">
                          {event.lastError}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className={`${TD} text-right tabular-nums`}>
                      {formatCount(event.processAttempts)}
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
}

/**
 * Pretty-printed when it parses, verbatim when it does not — a gateway that answered with HTML or a
 * bare error string is itself the finding, so nothing here hides a body it cannot format.
 */
function pretty(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw) as unknown, null, 2);
  } catch {
    return raw;
  }
}

function GatewayCard({ detail }: { detail: AdminPaymentDetail }) {
  const nothing = !detail.initiateRaw && !detail.verifyRaw;

  return (
    <Card
      title="Gateway responses"
      hint="The provider's own words, stored as they arrived. This is the evidence in a dispute, and no other page returns it."
    >
      {nothing ? (
        <p className="text-[13px] text-muted-foreground">
          Nothing stored. The provider was never successfully asked about this payment.
        </p>
      ) : (
        <div className="space-y-4">
          {detail.initiateRaw && (
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">
                Initiate — what they said when checkout was created
              </p>
              <pre className={PRE}>{pretty(detail.initiateRaw)}</pre>
            </div>
          )}
          {detail.verifyRaw && (
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">
                Verify — what they said the payment came to
              </p>
              <pre className={PRE}>{pretty(detail.verifyRaw)}</pre>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
