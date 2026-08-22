import type { Metadata } from "next";
import { Suspense } from "react";

import { UsersView } from "./UsersView";

export const metadata: Metadata = { title: "Users · NoteFusion Admin" };

/** The shell's search box arrives here as `?q=`, which `useSearchParams` reads. */
export default function UsersPage() {
  return (
    <Suspense>
      <UsersView />
    </Suspense>
  );
}
