import type { Metadata } from "next";
import { Suspense } from "react";

import { SupportView } from "./SupportView";

export const metadata: Metadata = { title: "Support · NoteFusion Admin" };

export default function SupportPage() {
  return (
    <Suspense>
      <SupportView />
    </Suspense>
  );
}
