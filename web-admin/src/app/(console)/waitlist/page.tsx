import type { Metadata } from "next";
import { Suspense } from "react";

import { WaitlistView } from "./WaitlistView";

export const metadata: Metadata = { title: "Waitlist · NoteFusion Admin" };

export default function WaitlistPage() {
  return (
    <Suspense>
      <WaitlistView />
    </Suspense>
  );
}
