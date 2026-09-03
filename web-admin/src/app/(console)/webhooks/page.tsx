import type { Metadata } from "next";

import { WebhooksView } from "./WebhooksView";

export const metadata: Metadata = { title: "Webhook inbox · NoteFusion Admin" };

export default function WebhooksPage() {
  return <WebhooksView />;
}
