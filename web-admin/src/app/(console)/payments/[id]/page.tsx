import type { Metadata } from "next";

import { PaymentDetailView } from "./PaymentDetailView";

export const metadata: Metadata = { title: "Payment · NoteFusion Admin" };

/**
 * The payment's id is in the path, so this shell awaits it and hands the view a plain string. The webhook inbox's
 * rows and the Payments table link here.
 */
export default async function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PaymentDetailView id={id} />;
}
