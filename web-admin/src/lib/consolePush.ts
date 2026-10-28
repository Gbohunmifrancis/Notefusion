/**
 * Notifications for the console (web push, audience "console" on the API): payments, failed payment attempts, waves of
 * new accounts and floods of transcriptions reach this browser even with the console closed. Turned on per browser
 * from Settings; the service worker is public/sw.js.
 */

import { request } from "@/api/client";

export type PushState = "unsupported" | "blocked" | "off" | "on";

const supported = (): boolean =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** base64url → the bytes `applicationServerKey` takes. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

/** Whether a subscription was made with this key: one made with an older key is refused by every push service. */
function madeWith(sub: PushSubscription, publicKey: string): boolean {
  const key = sub.options.applicationServerKey;
  if (!key) return false;
  const have = new Uint8Array(key), want = keyBytes(publicKey);
  return have.length === want.length && have.every((b, i) => b === want[i]);
}

/** This browser's subscription for the server's current key, subscribing afresh when it has none or a stale one. */
async function subscription(publicKey: string): Promise<PushSubscription> {
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const old = await reg.pushManager.getSubscription();
  if (old && madeWith(old, publicKey)) return old;
  if (old) await old.unsubscribe();
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
}

const save = (sub: PushSubscription) => request<void>("/api/admin/push/subscriptions", { method: "POST", body: sub.toJSON() });

/**
 * "on" only when the browser allows it, holds a subscription for the server's key, and the server holds it too. A browser
 * can believe it is subscribed after the server dropped it (gone, or refused five times) or after the key changed; with
 * permission already granted, that is mended here, quietly, rather than shown as "on" and never heard.
 */
export async function pushState(): Promise<PushState> {
  if (!supported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub || Notification.permission !== "granted") return "off";
  try {
    const { publicKey } = await request<{ publicKey: string }>("/api/push/web/key");
    const { registered } = await request<{ registered: boolean }>(
      `/api/admin/push/subscriptions/status?endpoint=${encodeURIComponent(sub.endpoint)}`);
    if (!registered || !madeWith(sub, publicKey)) await save(await subscription(publicKey));
  } catch {
    // Unchecked (the server away, the console locked): the browser's own word stands until the next look.
  }
  return "on";
}

/** Asks the browser, subscribes (afresh on a stale key), and saves the subscription for this admin. */
export async function turnOn(): Promise<PushState> {
  if (!supported()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";
  const { publicKey } = await request<{ publicKey: string }>("/api/push/web/key");
  await save(await subscription(publicKey));
  return "on";
}

export async function turnOff(): Promise<PushState> {
  if (!supported()) return "unsupported";
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    try {
      await request<void>("/api/admin/push/subscriptions", { method: "DELETE", body: { endpoint: sub.endpoint } });
    } finally {
      await sub.unsubscribe();
    }
  }
  return "off";
}

/** What became of a test, per browser of this admin's (the API's WebPushReport). */
export interface PushReport {
  off: boolean;
  browsers: number;
  delivered: number;
  gone: number;
  refused: number;
  unanswered: number;
}

export const sendTestPush = () => request<PushReport>("/api/admin/push/test", { method: "POST" });

/** The test's outcome in a sentence, and whether it worked. */
export function reportLine(r: PushReport): { ok: boolean; text: string } {
  if (r.off) return { ok: false, text: "Notifications are switched off on the server (web push keys), so nothing can be sent." };
  if (r.delivered > 0)
    return { ok: true, text: r.delivered === 1 ? "Test sent. It should appear in a moment." : `Test sent to ${r.delivered} browsers.` };
  if (r.browsers === 0) return { ok: false, text: "The server has no browser of yours to send to. Turn notifications off and on." };
  if (r.unanswered > 0) return { ok: false, text: "The browser’s push service didn’t answer. Try the test again in a minute." };
  return { ok: false, text: "The push service turned the test away. Turn notifications off and on to subscribe again." };
}
