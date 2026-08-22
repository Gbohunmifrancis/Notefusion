import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Not found · NoteFusion Admin" };

/**
 * Unknown paths. The router this replaced sent them all to the overview, which meant a mistyped URL
 * looked like it had worked; saying what happened and offering the way back is more use to whoever
 * typed it.
 *
 * Deliberately outside both route groups, so there is no sidebar and no admin gate — a signed-out
 * visitor who guesses at a URL sees this rather than being bounced through the sign-in screen.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center">
      <BrandMark size={44} className="text-brand" />
      <div className="space-y-1.5">
        <h1 className="text-screen-title font-semibold text-foreground">Nothing at this address</h1>
        <p className="text-[13px] text-muted-foreground">
          The page may have moved, or the link may have been mistyped.
        </p>
      </div>
      <Button asChild variant="outline">
        <Link href="/">
          <ArrowLeft aria-hidden="true" />
          Back to the overview
        </Link>
      </Button>
    </main>
  );
}
