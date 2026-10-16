import type { Metadata } from "next";
import { Suspense } from "react";

import { BlogView } from "./BlogView";

export const metadata: Metadata = { title: "Blog · NoteFusion Admin" };

export default function BlogPage() {
  return (
    <Suspense>
      <BlogView />
    </Suspense>
  );
}
