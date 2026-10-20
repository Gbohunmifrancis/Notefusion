import type { Metadata } from "next";

import { SessionsView } from "./SessionsView";

export const metadata: Metadata = { title: "Sessions · NoteFusion Admin" };

export default function SessionsPage() {
  return <SessionsView />;
}
