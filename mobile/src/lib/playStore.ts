/**
 * Google Play Billing on the phone (board h-play): the Android app's only way to pay. It loads what Google Play sells
 * and at what price, opens Google's purchase sheet, and hands each purchase to the server, which asks Google what it
 * is worth before anything is granted. The pure mapping is `playBilling.ts`.
 *
 * Android only (`usesPlayBilling`), and only once the server can confirm Play purchases and Google Play sells the
 * products (`sellsOnPlay`); until then, and on other platforms, the web checkout. The native module arrives with a
 * store build, and the fingerprint runtime keeps this code from reaching a build without it.
 */
import { Platform } from "react-native";
import {
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  isUserCancelledError,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  type Purchase,
  type PurchaseAndroid,
} from "expo-iap";
import { billingApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import type { Subscription } from "../api/types";
import {
  offersFrom,
  PLAY_PRODUCTS,
  PLAY_SONG,
  PLAY_SUBSCRIPTIONS,
  type PlayOffer,
  type PlayProductLike,
} from "./playBilling";

export const usesPlayBilling = Platform.OS === "android";

let serverReady = false;

/**
 * Whether the server can confirm Google Play purchases (its service account is set). Until it can, Android keeps the
 * website's checkout. Asked again each time while it says no; once yes, for the rest of the app's life.
 */
export async function playBillingReady(): Promise<boolean> {
  if (!usesPlayBilling) return false;
  if (!serverReady) serverReady = await billingApi.googlePlayStatus().catch(() => false);
  return serverReady;
}

let connection: Promise<boolean> | null = null;

/** One connection to Google Play for the app's life; a failed one is tried again next time. */
function connect(): Promise<boolean> {
  connection ??= initConnection().catch(() => {
    connection = null;
    return false;
  });
  return connection;
}

/** What Google Play sells this phone's Google account, keyed by `playKey`. Empty when Play cannot be reached. */
export async function loadPlayOffers(): Promise<Map<string, PlayOffer>> {
  if (!(await connect())) return new Map();
  const [subs, items] = await Promise.all([
    fetchProducts({ skus: PLAY_SUBSCRIPTIONS, type: "subs" }).catch(() => null),
    fetchProducts({ skus: PLAY_PRODUCTS, type: "in-app" }).catch(() => null),
  ]);
  return offersFrom([...(subs ?? []), ...(items ?? [])] as unknown as PlayProductLike[]);
}

export type PlayOutcome =
  | { kind: "purchased"; purchase: Purchase }
  /** Google is waiting for the money (cash, a delayed card); the server grants it when Google says. */
  | { kind: "pending" }
  | { kind: "cancelled" }
  | { kind: "failed" };

/**
 * Opens Google's purchase sheet for an offer and waits for its answer. `accountId` (our user id) goes to Google with
 * the purchase, which is how the server knows whose it is even if this phone never reports it.
 */
export async function buyOnPlay(offer: PlayOffer, accountId: string): Promise<PlayOutcome> {
  if (!(await connect())) return { kind: "failed" };
  return new Promise<PlayOutcome>((resolve) => {
    let settled = false;
    const settle = (outcome: PlayOutcome) => {
      if (settled) return;
      settled = true;
      updated.remove();
      failed.remove();
      resolve(outcome);
    };
    const updated = purchaseUpdatedListener((purchase) => {
      if (purchase.productId !== offer.productId) return;
      settle(purchase.purchaseState === "purchased" ? { kind: "purchased", purchase } : { kind: "pending" });
    });
    const failed = purchaseErrorListener((error) =>
      settle(isUserCancelledError(error) ? { kind: "cancelled" } : { kind: "failed" }),
    );
    const request = offer.offerToken
      ? requestPurchase({
          type: "subs",
          request: {
            google: {
              skus: [offer.productId],
              subscriptionOffers: [{ sku: offer.productId, offerToken: offer.offerToken }],
              obfuscatedAccountId: accountId,
            },
          },
        })
      : requestPurchase({
          type: "in-app",
          request: { google: { skus: [offer.productId], obfuscatedAccountId: accountId } },
        });
    Promise.resolve(request).catch((error: unknown) =>
      settle(isUserCancelledError(error) ? { kind: "cancelled" } : { kind: "failed" }),
    );
  });
}

/**
 * Hands one purchase to the server and returns the membership afterwards. The server acknowledges it with Google
 * (consumes a one-song purchase); finishing it here too is harmless and covers a server that could not.
 */
export async function registerPlayPurchase(purchase: Purchase): Promise<Subscription> {
  const token = purchase.purchaseToken;
  if (!token) throw new Error("The purchase carries no token.");
  const sub = await billingApi.registerPlayPurchase(purchase.productId, token);
  await finishTransaction({ purchase, isConsumable: purchase.productId === PLAY_SONG }).catch(() => undefined);
  return sub;
}

export interface PlayRestore {
  /** Purchases the server took (granted, renewed or already known). */
  restored: number;
  /** A purchase made while signed in to another NoteFusion account. */
  otherAccount: boolean;
  /** One could not be confirmed (offline, Google slow); it is tried again on the next launch. */
  failed: boolean;
  /** The membership after the last purchase the server took. */
  subscription: Subscription | null;
}

/**
 * Hands the server what this phone's Google account holds. `all` for the Restore button; otherwise only purchases not
 * yet acknowledged (one interrupted by a dropped connection, say), so a launch costs nothing when all is settled.
 */
export async function restorePlayPurchases(all: boolean): Promise<PlayRestore> {
  const result: PlayRestore = { restored: 0, otherAccount: false, failed: false, subscription: null };
  if (!usesPlayBilling || !(await playBillingReady()) || !(await connect())) return result;
  let held: Purchase[];
  try {
    held = await getAvailablePurchases();
  } catch {
    return { ...result, failed: true };
  }
  for (const purchase of held as PurchaseAndroid[]) {
    if (!purchase.purchaseToken || purchase.purchaseState !== "purchased") continue;
    if (!all && purchase.isAcknowledgedAndroid) continue;
    try {
      result.subscription = await registerPlayPurchase(purchase);
      result.restored++;
    } catch (e) {
      if (toApiError(e).code === "BILLING_PLAY_OTHER_ACCOUNT") result.otherAccount = true;
      else result.failed = true;
    }
  }
  return result;
}
