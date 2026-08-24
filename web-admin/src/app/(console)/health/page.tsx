import type { Metadata } from "next";

import { HealthView } from "./HealthView";

export const metadata: Metadata = { title: "System health · NoteFusion Admin" };

export default function HealthPage() {
  return <HealthView />;
}
