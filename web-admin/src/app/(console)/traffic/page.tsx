import type { Metadata } from "next";

import { TrafficView } from "./TrafficView";

export const metadata: Metadata = { title: "Traffic · NoteFusion Admin" };

export default function TrafficPage() {
  return <TrafficView />;
}
