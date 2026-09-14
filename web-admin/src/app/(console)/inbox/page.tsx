import type { Metadata } from "next";
import { Suspense } from "react";

import { InboxView } from "./InboxView";

export const metadata: Metadata = { title: "Inbox · NoteFusion Admin" };

export default function InboxPage() {
  return (
    <Suspense>
      <InboxView />
    </Suspense>
  );
}
