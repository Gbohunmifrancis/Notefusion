import * as Listen from "../../modules/notefusion-listen";
import { billingApi } from "../api/endpoints";
import type { Subscription } from "../api/types";
import { logAnalyticsEvent } from "./analytics";
import { removeUri } from "./blobStore";
import { freeWeek } from "./freeWeek";
import { listenAllowance, type AllowanceSource, type ListenAllowance } from "./listenAnywhere";
import { bindOutbox, enqueueTake, pump, sendTakeNow } from "./outbox";
import { tokenStore } from "./tokenStore";

/**
 * Where "Listen from anywhere" (Android, modules/notefusion-listen) meets the app's own code.
 *
 * A take recorded by the floating button, the notification or the Listen tile reaches `listenTakeTask`
 * with no screen open: React Native runs it as a headless task (registered in index.ts) when the native
 * service hands the file over. It goes into the same send queue as a take from the Record screen
 * (lib/outbox: written ahead, sent under an Idempotency-Key, kept until its job is done) as a hummed or
 * sung recording — the worker lifts the voice out itself when it hears a band — and the ready push the
 * server already sends brings the person back to the sheet. Nothing here is a second upload path.
 *
 * The allowance the overlay shows (the pill's line, the "none left" card) is written here whenever the
 * subscription is read, so the native side has it with no JS running.
 */

/** The task key `ListenTakeHeadlessService` starts; registered in index.ts. */
export const LISTEN_TAKE_TASK = "NotefusionListenTake";

export interface ListenTakeData {
  uri: string;
  fileName: string;
  durationSec?: number;
  source?: string;
  from?: string;
}

export async function listenTakeTask(data: ListenTakeData): Promise<void> {
  try {
    if (!data?.uri || !data.fileName) return;
    // The signed-in account, as the app keeps it between launches; the queue is that account's.
    const user = await tokenStore.getUser();
    if (!user) {
      removeUri(data.uri);
      return;
    }
    await bindOutbox(user.id);
    const id = enqueueTake({ fileUri: data.uri, fileName: data.fileName, opts: { mode: "melody" } });
    if (!id) {
      removeUri(data.uri);
      return;
    }
    void logAnalyticsEvent("listen_anywhere_take", {
      source: data.source ?? "room",
      from: data.from ?? "bubble",
      seconds: Math.round(data.durationSec ?? 0),
    });
    await sendTakeNow(id);
    await refreshAllowance();
  } catch {
    // The queue keeps whatever was written; the app's runner sends it next time it comes forward.
  } finally {
    Listen.takeHandled();
  }
}

/**
 * Takes the native service recorded but the task never got (the process died in between): queued now,
 * at sign-in. One that cannot be kept (no room) is deleted rather than left for ever.
 */
export async function drainPendingTakes(): Promise<void> {
  if (!Listen.available) return;
  let queued = 0;
  for (const take of Listen.pendingTakes()) {
    const id = enqueueTake({ fileUri: take.uri, fileName: take.fileName, opts: { mode: "melody" } });
    if (id) queued += 1;
    else removeUri(take.uri);
  }
  if (queued > 0) {
    void logAnalyticsEvent("listen_anywhere_take_recovered", { count: queued });
    void pump({ force: true });
  }
}

/** Hands the overlay what the account may send; `syncListenAllowance(null)` forgets it (sign-out). */
export function syncListenAllowance(a: ListenAllowance | null): void {
  if (!Listen.available) return;
  Listen.setAllowance(a ? JSON.stringify(a) : null);
}

/** The allowance as read straight off the subscription DTO (the task, after a send). */
export function allowanceOfSubscription(sub: Subscription | null, known: boolean): ListenAllowance {
  const week = freeWeek(sub);
  const isPro = sub?.isActive ?? false;
  const source: AllowanceSource = {
    isPro,
    known,
    freeRemaining: week?.left ?? 3,
    freePerWeek: week?.total ?? 3,
    freeBack: week?.back ?? "Friday",
    boughtRemaining: isPro ? 0 : (sub?.boughtTranscriptionsRemaining ?? 0),
  };
  return listenAllowance(source);
}

async function refreshAllowance(): Promise<void> {
  try {
    const sub = await billingApi.mySubscription();
    syncListenAllowance(allowanceOfSubscription(sub, true));
  } catch {
    // The provider re-reads it when the app next comes forward.
  }
}
