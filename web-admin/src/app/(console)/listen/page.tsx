import type { Metadata } from "next";

import { ListenView } from "./ListenView";

export const metadata: Metadata = { title: "Listen from anywhere · NoteFusion Admin" };

export default function ListenPage() {
  return <ListenView />;
}
