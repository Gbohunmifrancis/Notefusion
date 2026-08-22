import type { Metadata } from "next";
import { Suspense } from "react";

import { ResetPasswordView } from "./ResetPasswordView";

export const metadata: Metadata = { title: "Reset password · NoteFusion" };

/**
 * The link in the reset email lands here, carrying `?email=` and `?token=`. Reading them needs
 * `useSearchParams`, which needs this boundary or the production build fails on the page Next
 * would otherwise try to prerender.
 */
export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordView />
    </Suspense>
  );
}
