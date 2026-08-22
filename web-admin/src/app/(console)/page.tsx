import type { Metadata } from "next";

import { OverviewView } from "./OverviewView";

export const metadata: Metadata = { title: "Overview · NoteFusion Admin" };

/**
 * The console's landing page. No search params to read, so unlike the other routes this needs no
 * `Suspense` boundary — the shell is here purely to carry the title.
 */
export default function OverviewPage() {
  return <OverviewView />;
}
