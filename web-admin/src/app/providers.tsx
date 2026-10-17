"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState, type ReactNode } from "react";

import { ApiError } from "@/api/client";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";

/**
 * Everything that has to exist above every page: the theme class, the query cache, the
 * signed-in operator, the tooltip and toast singletons.
 *
 * One client component rather than several, so `layout.tsx` stays a server component and the
 * "use client" boundary sits exactly here.
 */
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        /*
         * Thirty seconds. The console reports on a live system, so a stale panel is a
         * misleading one — but every page is a handful of range-scoped aggregates that do not
         * change between two clicks of the same nav item, and re-fetching them on every
         * back-navigation makes the shell feel slower than the data warrants.
         */
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        /*
         * Retry transport failures once; never retry a refusal. A 403 means this account is
         * not allowed to see the panel and a 404 means the account is gone — retrying either
         * just delays the message. 401 is handled a layer down, where `request` refreshes the
         * token and replays the call itself.
         */
        retry: (failureCount, error) =>
          !(error instanceof ApiError) && error instanceof Error && failureCount < 1,
      },
      mutations: {
        // Admin actions are POSTs that change an account. A retry could gift Pro twice.
        retry: false,
      },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  // Created in state, not at module scope: a module-level client would be shared between
  // requests on the server and would leak one operator's cache into another's render.
  const [queryClient] = useState(makeQueryClient);

  return (
    <ThemeProvider
      attribute="class"
      // Night by default, as the app is (mobile `lib/theme.tsx`): the night palette is the brand's
      // showcase. An operator who already picked a mode keeps it — the key below is unchanged.
      // `enableSystem` is off deliberately: the console has
      // an explicit two-position switch, and a third "system" state would make the switch
      // disagree with what the page is showing.
      defaultTheme="dark"
      enableSystem={false}
      // The same key the old runtime wrote, so an operator's existing preference carries over.
      storageKey="nf.themeMode"
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
          <Toaster position="top-center" />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
