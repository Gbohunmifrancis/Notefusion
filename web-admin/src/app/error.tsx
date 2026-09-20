"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground relative overflow-hidden">
      <div className="flex flex-col items-center justify-center text-center w-full h-full py-12 relative z-10 px-4">
        
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">Something went wrong</h1>
        <p className="text-muted-foreground max-w-[400px] mb-8 mx-auto">
          An unexpected error occurred while processing your request. Please try again or return to the dashboard.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full sm:w-auto">
          <Button onClick={() => reset()} className="w-full sm:w-auto">
            Retry
          </Button>
          <Button variant="outline" onClick={() => window.location.href = "/"} className="w-full sm:w-auto px-8">
            Go to Dashboard
          </Button>
        </div>

        <p className="mt-12 text-sm text-muted-foreground">
          If the problem persists, please contact support.
        </p>
      </div>
    </div>
  );
}
