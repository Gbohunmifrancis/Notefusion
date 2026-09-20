import type { Metadata } from "next";
import { Suspense } from "react";

import { LedgerView } from "./LedgerView";

export const metadata: Metadata = { title: "Ledger | NoteFusion Admin" };

export default function LedgerPage() {
  return (
    <Suspense>
      <LedgerView />
    </Suspense>
  );
}