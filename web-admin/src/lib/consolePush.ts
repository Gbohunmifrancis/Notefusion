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

export async function pushState(): Promise<PushState> {
  if (!supported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub && Notification.permission === "granted" ? "on" : "off";
}

/** Asks the browser, subscribes, and saves the subscription for this admin. */
export async function turnOn(): Promise<PushState> {
  if (!supported()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";
  const { publicKey } = await request<{ publicKey: string }>("/api/push/web/key");
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await request<void>("/api/admin/push/subscriptions", { method: "POST", body: sub.toJSON() });
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

export const sendTestPush = () => request<void>("/api/admin/push/test", { method: "POST" });
