import type { Metadata } from "next";
import { Suspense } from "react";

import { AuditLogView } from "./AuditLogView";

export const metadata: Metadata = { title: "Audit log · NoteFusion Admin" };

/** `?target=` is read with `useSearchParams`, so the view needs a boundary around it. */
export default function AuditLogPage() {
  return (
    <Suspense>
      <AuditLogView />
    </Suspense>
  );
}
