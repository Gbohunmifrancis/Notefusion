import type { Metadata } from "next";

import { OffersView } from "./OffersView";

export const metadata: Metadata = { title: "Offers · NoteFusion Admin" };

export default function OffersPage() {
  return <OffersView />;
}
