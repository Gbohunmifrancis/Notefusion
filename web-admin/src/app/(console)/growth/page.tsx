import type { Metadata } from "next";

import { GrowthView } from "./GrowthView";

export const metadata: Metadata = { title: "Growth · NoteFusion Admin" };

export default function GrowthPage() {
  return <GrowthView />;
}
