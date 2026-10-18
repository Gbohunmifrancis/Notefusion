import { Platform } from "react-native";
import * as Device from "expo-device";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { adminApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import type { PaymentAlertSettings } from "../api/types";
import { colors } from "../design/theme";
import { isExpoGo } from "./env";
import { registerForPushAsync } from "./push";
import {
  DEFAULT_PAYMENT_ALERTS,
  MUTE_HOUR_ACTION,
  PAYMENT_CATEGORY,
  PAYMENT_PROBLEMS_CHANNEL,
  PAYMENT_VIBRATION,
  VIEW_PAYMENT_ACTION,
  channelsToDelete,
  channelsToKeep,
  readPrefs,
  type PaymentAlertPrefs,
} from "./paymentAlerts";

/**
 * Payment alerts on this phone, at run time (boards f-admin/08–09): the Android channels and the notification's
 * buttons, this phone's choices, and telling the API how this phone wants them. Runs only inside Admin, so a
 * customer's phone never gets a payment channel, category or setting. The rules are `lib/paymentAlerts` (tested).
 *
 * The choices are this phone's own settings (kept under `nf.paymentAlerts`, like the theme): no customer data and no
 * admin figures. The API keeps its copy on the phone's push registration and picks the channel per phone.
 */

const STORAGE_KEY = "nf.paymentAlerts";

/** The admins' sign-up and transcription pushes (C# `SendAdminActivityAlertsCommand.Channel`). */
export const ADMIN_ACTIVITY_CHANNEL = "admin-activity";

type Notifications = typeof import("expo-notifications");

function notifications(): Notifications | null {
  if (isExpoGo) return null;
  try {
    return require("expo-notifications") as Notifications;
  } catch {
    return null;
  }
}

export async function loadPaymentAlertPrefs(): Promise<PaymentAlertPrefs> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? readPrefs(JSON.parse(raw)) : DEFAULT_PAYMENT_ALERTS;
  } catch {
    return DEFAULT_PAYMENT_ALERTS;
  }
}

async function storePrefs(prefs: PaymentAlertPrefs): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)).catch(() => undefined);
}

/**
 * Creates the channels these choices need (the chosen one and the quiet one, plus "Payment problems"), deletes the
 * payment channels no longer chosen so Android's settings list only these, and registers the notification's two
 * buttons. Best-effort: a phone that refuses still gets the push on its fallback channel.
 */
export async function ensurePaymentChannels(prefs: PaymentAlertPrefs): Promise<void> {
  const N = notifications();
  if (!N) return;
  try {
    if (Platform.OS === "android") {
      const keep = channelsToKeep(prefs);
      for (const c of keep) {
        await N.setNotificationChannelAsync(c.id, {
          name: c.name,
          description: "When someone pays. Admin phones only.",
          // Heads-up on every one, the quiet one too: "banners, no sound".
          importance: N.AndroidImportance.HIGH,
          // The bundled chime, null for none, or (left out) the phone's own notification sound.
          ...(c.sound === undefined ? {} : { sound: c.sound }),
          enableVibrate: c.vibrate,
          ...(c.vibrate ? { vibrationPattern: PAYMENT_VIBRATION } : {}),
          // The words carry no name when the phone asked for that, so they can show on the lock screen.
          lockscreenVisibility: N.AndroidNotificationVisibility.PUBLIC,
          lightColor: colors.accent,
        });
      }
      await N.setNotificationChannelAsync(PAYMENT_PROBLEMS_CHANNEL, {
        name: "Payment problems",
        description: "Paid with no Pro, stuck checkouts. Admin phones only.",
        importance: N.AndroidImportance.HIGH,
        lightColor: colors.accent,
      });
      // "Someone signed up", "someone is transcribing" (C# SendAdminActivityAlertsCommand.Channel): a channel of its
      // own, so Android's settings can quiet it without touching payments or this phone's own transcriptions.
      await N.setNotificationChannelAsync(ADMIN_ACTIVITY_CHANNEL, {
        name: "New users and transcriptions",
        description: "When someone signs up or starts a transcription. Admin phones only.",
        importance: N.AndroidImportance.DEFAULT,
        lightColor: colors.accent,
      });
      const existing = ((await N.getNotificationChannelsAsync()) ?? []).map((c) => c.id);
      for (const id of channelsToDelete(existing, keep)) await N.deleteNotificationChannelAsync(id);
    }
    await N.setNotificationCategoryAsync(PAYMENT_CATEGORY, [
      { identifier: VIEW_PAYMENT_ACTION, buttonTitle: "View payment", options: { opensAppToForeground: true } },
      // Opens the app for the moment it takes to tell the server; the banners keep coming, without a sound.
      { identifier: MUTE_HOUR_ACTION, buttonTitle: "Mute 1 hour", options: { opensAppToForeground: true } },
    ]);
  } catch {
    // No notifications module, or the OS refused: the alert still arrives on the app's fallback channel.
  }
}

/** This phone's Expo push token, or null when push is not allowed or not available here. */
export async function pushToken(): Promise<string | null> {
  const N = notifications();
  if (!N || !Device.isDevice) return null;
  try {
    if ((await N.getPermissionsAsync()).status !== "granted") return null;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    return (await N.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  } catch {
    return null;
  }
}

export type AlertSync =
  | { kind: "saved"; settings: PaymentAlertSettings }
  /** Notifications are off on this phone (no permission, or no push here): nothing to send to. */
  | { kind: "no-push" }
  | { kind: "failed"; message: string };

/**
 * Saves these choices on the phone, makes the channels, and tells the API. A phone whose token the API does not
 * hold yet (registration skipped while notifications were off) registers once and tries again.
 */
export async function savePaymentAlerts(prefs: PaymentAlertPrefs): Promise<AlertSync> {
  await storePrefs(prefs);
  await ensurePaymentChannels(prefs);
  const token = await pushToken();
  if (!token) return { kind: "no-push" };

  const body = { token, ...prefs };
  try {
    return { kind: "saved", settings: await adminApi.setAlertSettings(body) };
  } catch (first) {
    const code = (first as { response?: { data?: { code?: string } } })?.response?.data?.code;
    if (code !== "ADMIN_ALERTS_DEVICE_UNKNOWN") return { kind: "failed", message: messageOf(first) };
    await registerForPushAsync().catch(() => null);
    try {
      return { kind: "saved", settings: await adminApi.setAlertSettings(body) };
    } catch (again) {
      return { kind: "failed", message: messageOf(again) };
    }
  }
}

/** Sends this phone's choices once Admin opens: the first time, that turns alerts on with the defaults. */
export async function syncPaymentAlerts(): Promise<void> {
  await savePaymentAlerts(await loadPaymentAlertPrefs()).catch(() => undefined);
}

/** "Mute 1 hour", from the notification's button or the Payment alerts page. */
export async function mutePaymentAlerts(minutes: number): Promise<PaymentAlertSettings | null> {
  const token = await pushToken();
  if (!token) return null;
  try {
    return await adminApi.muteAlerts(token, minutes);
  } catch {
    return null;
  }
}

function messageOf(e: unknown): string {
  return toApiError(e).message;
}
