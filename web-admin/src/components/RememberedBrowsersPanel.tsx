"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Monitor, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { forgetConsoleBrowserById, getConsoleBrowsers } from "@/api/endpoints";
import type { TrustedBrowser } from "@/api/types";
import { Card } from "@/components/Card";
import { StateView } from "@/components/StateView";
import { Button } from "@/components/ui/button";
import { forgetThisBrowserLocally, trustToken } from "@/lib/consoleTrust";
import { formatInstantDateTime } from "@/lib/format";
import { getReportingOffset } from "@/lib/reporting";

const QUERY_KEY = ["console-browsers"] as const;

/**
 * Browsers the console remembers (lib/consoleTrust): each opens the console without a passkey for 30 days after it was
 * remembered. Forgetting one means it asks again there; this browser is marked.
 */
export function RememberedBrowsersPanel() {
  const queryClient = useQueryClient();
  const state = useQuery({ queryKey: QUERY_KEY, queryFn: () => getConsoleBrowsers(trustToken()) });
  const [busy, setBusy] = useState<string | null>(null);

  async function forget(browser: TrustedBrowser) {
    setBusy(browser.id);
    try {
      await forgetConsoleBrowserById(browser.id);
      if (browser.thisBrowser) forgetThisBrowserLocally();
      toast.success(browser.thisBrowser ? "This browser will ask for your passkey again." : `${browser.label} forgotten.`);
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    } catch {
      toast.error("Couldn’t forget that browser. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card
      title="Remembered browsers"
      hint="These open the console without asking for your passkey, for 30 days. Suspending an account, changing a role, flags and passkeys still ask."
    >
      <StateView
        state={state}
        loadingLabel="Loading browsers"
        isEmpty={(rows) => rows.length === 0}
        emptyMessage="No browser is remembered"
        emptyHint="Unlocking the console remembers the browser you are on."
      >
        {(rows) => (
          <ul className="divide-y divide-border rounded-[8px] border border-border px-3">
            {rows.map((browser) => (
              <li key={browser.id} className="flex items-center gap-3 py-3">
                <Monitor className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-foreground">
                    {browser.label}
                    {browser.thisBrowser && <span className="ml-2 text-[12px] font-normal text-muted-foreground">This browser</span>}
                  </p>
                  <p className="text-[12px] text-muted-foreground">
                    Last used {formatInstantDateTime(browser.lastUsedAtUtc, getReportingOffset())} · until{" "}
                    {formatInstantDateTime(browser.expiresAtUtc, getReportingOffset())}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void forget(browser)}
                  disabled={busy === browser.id}
                  aria-label={`Forget ${browser.label}`}
                >
                  <Trash2 className="size-4" aria-hidden />
                  Forget
                </Button>
              </li>
            ))}
          </ul>
        )}
      </StateView>
    </Card>
  );
}
