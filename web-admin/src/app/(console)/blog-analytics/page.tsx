import type { Metadata } from "next";

import { BlogAnalyticsView } from "./BlogAnalyticsView";

export const metadata: Metadata = { title: "Blog analytics · NoteFusion Admin" };

export default function BlogAnalyticsPage() {
  return <BlogAnalyticsView />;
}
