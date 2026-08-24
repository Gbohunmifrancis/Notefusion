"use client";

import { Loader2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ReactNode } from "react";

import { ConsoleShell } from "@/components/ConsoleShell";
import { useAuth } from "@/lib/auth";
import { isAdmin } from "@/lib/session";

/**
 * The gate, and the shell every console page sits inside.
 *
 * The gate hides the dashboard from someone who is not signed in as an admin; it does not protect
 * the data. The API enforces the Admin policy on every request, so editing localStorage to get past
 * this buys a 403 from the server, not analytics.
 *
 * It wraps the layout rather than each page, so a route added under `(console)` inherits it instead
 * of shipping unprotected because someone forgot the wrapper.
 *
 * The redirect happens in an effect and only once `ready` is true. `user === null` means two
 * different things before and after the stored session has been read — "nobody is signed in" and
 * "we have not looked yet" — and redirecting on the first would bounce every signed-in admin to
 * /login on load. Until then this renders a spinner rather than nothing: the server render always
 * lands in that state, so an empty body is what the operator would otherwise stare at until
 * hydration finishes.
 */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const allowed = isAdmin(user);

  useEffect(() => {
    // The attempted path rides along so sign-in can return the admin to it.
    if (ready && !allowed) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [ready, allowed, pathname, router]);

  if (!allowed) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="size-5 animate-spin text-faint" aria-label="Loading" />
      </div>
    );
  }

  return <ConsoleShell>{children}</ConsoleShell>;
}
