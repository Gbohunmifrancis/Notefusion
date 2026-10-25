"use client";

import { PageHeader } from "@/components/PageHeader";
import { PasskeysPanel } from "@/components/PasskeysPanel";
import { RememberedBrowsersPanel } from "@/components/RememberedBrowsersPanel";

/** The signed-in admin's own settings: passkeys and the browsers the console remembers. */
export function SettingsView() {
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="How you sign in to the console."
        breadcrumb={["Dashboard", "Settings", "Security"]}
      />
      <div className="flex max-w-3xl flex-col gap-4">
        <PasskeysPanel />
        <RememberedBrowsersPanel />
      </div>
    </>
  );
}
