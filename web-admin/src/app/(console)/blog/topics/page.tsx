import type { Metadata } from "next";

import { TopicsView } from "./TopicsView";

export const metadata: Metadata = { title: "Blog topics · NoteFusion Admin" };

export default function BlogTopicsPage() {
  return <TopicsView />;
}
