"use client";

import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { reconcilePayment } from "@/api/endpoints";
import type { AdminPaymentRow, PaymentStatus } from "@/api/types";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";

/**
 * The one action on the reconciliation pages: ask the provider what happened to a payment and apply
 * the answer, without waiting for the sweep that would have asked in the next few minutes.
 *
 * A component rather than a helper because it owns the confirmation, the toast and the cache drop,
 * and both the payments table and a payment's detail page need all three identically.
 *
 * It is disabled outside `Processing`, with the reason said out loud. The server would accept the
 * call and answer "nothing to do" — the command is idempotent — but firing an action that cannot
 * change anything teaches an operator nothing, and for `Verified` the honest answer is that this
 * button is the wrong tool and the row needs a developer.
 */

const BLOCKED: Record<Exclude<PaymentStatus, "Processing">, string> = {
  Pending: "Checkout was never opened, so the provider has nothing to report on this payment yet.",
  Verified:
    "The money is confirmed but the subscription was never applied. Reconciliation only acts on "
    + "payments still processing, so it cannot recover this — escalate it instead.",
  Completed: "This payment is already settled. There is nothing to reconcile.",
  Failed: "This payment is already closed. The customer can start a new checkout.",
};

export function ReconcileButton({ payment }: { payment: AdminPaymentRow }) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  const blocked = payment.status === "Processing" ? undefined : BLOCKED[payment.status];

  const request: ConfirmRequest = {
    title: "Reconcile this payment",
    body: (
      <>
        <p>
          Asks <span className="font-semibold text-foreground">{payment.provider}</span> what
          happened to <span className="font-mono text-foreground">{payment.reference}</span> and
          applies their answer now, instead of waiting for the next sweep.
        </p>
        <p>
          If they confirm it, the subscription is applied and a receipt is sent. If they say the
          checkout can no longer be paid, it is closed and the customer can start a new one. If they
          have not settled it either way, nothing changes.
        </p>
        <p>
          This takes no money and charges nothing — it only reads the provider&apos;s answer. Running
          it twice is safe.
        </p>
      </>
    ),
    confirmLabel: "Reconcile now",
    noteLabel: "Why (optional)",
    onConfirm: async (note) => {
      // A throw propagates: the dialog stays open and shows the server's own message, which for the
      // one failure that matters here — the provider quoting a different amount than we recorded —
      // is the whole finding.
      const result = await reconcilePayment(payment.id, note);

      if (result.changed) {
        toast.success(`Reconciled — now ${result.status}`, { description: result.outcome });
      } else {
        toast.info("Nothing to reconcile", { description: result.outcome });
      }

      // The row, the summary counts, the ledger, the account's own page and the audit trail can all
      // have moved on one call. Dropping the cache is cheaper to get right than naming those keys.
      void queryClient.invalidateQueries();
    },
  };

  return (
    <>
      {/* A disabled button takes no pointer events, so the reason has to hang off a wrapper that
          still receives them. Same arrangement as the account actions. */}
      <span
        className={blocked ? "inline-flex cursor-not-allowed" : "inline-flex"}
        {...(blocked ? { title: blocked } : {})}
      >
        <Button
          type="button"
          variant="outline"
          onClick={() => setConfirm(request)}
          disabled={Boolean(blocked)}
          className="h-8 gap-1.5 rounded-sm text-[12.5px] font-semibold"
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
          Reconcile
        </Button>
      </span>

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
