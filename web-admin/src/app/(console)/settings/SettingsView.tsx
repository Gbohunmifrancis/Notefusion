"use client";

import { PageHeader } from "@/components/PageHeader";
import { PasskeysPanel } from "@/components/PasskeysPanel";

/** The signed-in admin's own settings. Security (passkeys) is all there is for now. */
export function SettingsView() {
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="How you sign in to the console."
        breadcrumb={["Dashboard", "Settings", "Security"]}
      />
      <div className="max-w-3xl">
        <PasskeysPanel />
      </div>
    </>
  );
}
