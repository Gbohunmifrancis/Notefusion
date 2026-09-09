import type { Metadata } from "next";
import { Suspense } from "react";

import { DeleteAccountView } from "./DeleteAccountView";

export const metadata: Metadata = {
  title: "Delete Account & Data · NoteFusion",
  description: "Request permanent deletion of your NoteFusion account and musical transcriptions.",
  robots: { index: true, follow: true },
};

export default function DeleteAccountPage() {
  return (
    <Suspense>
      <DeleteAccountView />
    </Suspense>
  );
}
