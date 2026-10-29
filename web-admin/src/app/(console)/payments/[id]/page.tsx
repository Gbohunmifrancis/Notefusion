"use client";

import { usePathId } from "@/hooks/usePathId";

import { PaymentDetailView } from "./PaymentDetailView";

/**
 * The payment's id is in the path: read from the address and handed to the view as a plain string. The webhook inbox's
 * rows and the Payments table link here.
 */
export default function PaymentDetailPage() {
  const id = usePathId("/payments/");
  return id ? <PaymentDetailView id={id} /> : null;
}
