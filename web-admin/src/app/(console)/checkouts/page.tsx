import type { Metadata } from "next";

import { CheckoutsView } from "./CheckoutsView";

export const metadata: Metadata = { title: "Unpaid checkouts · NoteFusion Admin" };

export default function CheckoutsPage() {
  return <CheckoutsView />;
}
