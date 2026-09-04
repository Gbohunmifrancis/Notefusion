import type { Metadata } from "next";

import { PaymentDetailView } from "./PaymentDetailView";

export const metadata: Metadata = { title: "Payment · NoteFusion Admin" };

/**
 * The payment's id is in the path, so this shell awaits it and hands the view a plain string.
 *
 * The title stays generic for the same reason the account page's does: naming the payment would mean
 * fetching it here, and every request this console makes carries a bearer token out of the
 * operator's browser storage, which a server component cannot read.
 */
export default async function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PaymentDetailView id={id} />;
}
