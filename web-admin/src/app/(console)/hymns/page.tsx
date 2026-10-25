import type { Metadata } from "next";

import { HymnsView } from "./HymnsView";

export const metadata: Metadata = { title: "Hymns recognised · NoteFusion Admin" };

export default function HymnsPage() {
  return <HymnsView />;
}
