import type { Metadata } from "next";
import { Suspense } from "react";

import { LoginView } from "./LoginView";

export const metadata: Metadata = { title: "Sign in · NoteFusion Admin" };

/**
 * A server shell around a client view, which is the shape every page in this console takes: the
 * shell is the only place a `Metadata` export is allowed, and the view is where the session lives.
 *
 * The `Suspense` boundary is what `useSearchParams` requires of a page Next would otherwise
 * prerender — without it the build fails rather than the page.
 */
export default function LoginPage() {
  return (
    <Suspense>
      <LoginView />
    </Suspense>
  );
}
