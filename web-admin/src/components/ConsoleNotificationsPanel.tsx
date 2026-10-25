"use client";

import { Bell, BellOff } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Card } from "@/components/Card";
import { Button } from "@/components/ui/button";
import { type PushState, pushState, sendTestPush, turnOff, turnOn } from "@/lib/consolePush";

const LINES: Record<PushState, string> = {
  on: "On for this browser. Payments, failed payment attempts, waves of new accounts and floods of transcriptions show here, even with the console closed.",
  off: "Off for this browser.",
  blocked: "This browser is blocking notifications for the console. Allow them in the browser’s site settings, then turn them on here.",
  unsupported: "This browser can’t show notifications for websites.",
};

/** Settings › Notifications: the console's web push for this browser, with a test. */
export function ConsoleNotificationsPanel() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void pushState().then(setState).catch(() => setState("unsupported"));
  }, []);

  async function toggle() {
    setBusy(true);
    try {
      const next = state === "on" ? await turnOff() : await turnOn();
      setState(next);
      if (next === "on") {
        await sendTestPush().catch(() => undefined);
        toast.success("Notifications are on. A test is on its way.");
      }
    } catch {
      toast.error("Couldn’t change notifications. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Notifications" hint="What needs your attention, pushed to this browser.">
      <div className="flex items-start gap-3">
        {state === "on" ? <Bell className="mt-0.5 size-4 text-foreground" aria-hidden /> : <BellOff className="mt-0.5 size-4 text-muted-foreground" aria-hidden />}
        <p className="flex-1 text-[13.5px] text-muted-foreground">{state ? LINES[state] : "Checking this browser…"}</p>
        {(state === "on" || state === "off") && (
          <Button size="sm" variant={state === "on" ? "ghost" : "default"} onClick={() => void toggle()} disabled={busy}>
            {state === "on" ? "Turn off" : "Turn on"}
          </Button>
        )}
        {state === "blocked" && (
          <Button size="sm" variant="ghost" onClick={() => void toggle()} disabled={busy}>Try again</Button>
        )}
      </div>
    </Card>
  );
}
