import type { Metadata } from "next";

import { InsightsView } from "./InsightsView";

export const metadata: Metadata = { title: "Insights · NoteFusion Admin" };

export default function InsightsPage() {
  return <InsightsView />;
}
