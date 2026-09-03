import type { Metadata } from "next";

import { LedgerView } from "./LedgerView";

export const metadata: Metadata = { title: "Ledger · NoteFusion Admin" };

export default function LedgerPage() {
  return <LedgerView />;
}
