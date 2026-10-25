"use client";

import { PageHeader } from "@/components/PageHeader";
import { ConsoleNotificationsPanel } from "@/components/ConsoleNotificationsPanel";
import { PasskeysPanel } from "@/components/PasskeysPanel";
import { RememberedBrowsersPanel } from "@/components/RememberedBrowsersPanel";

/** The signed-in admin's own settings: notifications, passkeys and the browsers the console remembers. */
export function SettingsView() {
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Notifications, and how you sign in to the console."
        breadcrumb={["Dashboard", "Settings", "Security"]}
      />
      <div className="flex max-w-3xl flex-col gap-4">
        <ConsoleNotificationsPanel />
        <PasskeysPanel />
        <RememberedBrowsersPanel />
      </div>
    </>
  );
}
