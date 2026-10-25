/**
 * Where things live in the app's navigation, as plain data (tests: navTargets.test.ts): the tab bar's cells, the
 * admin's own bottom bar, and the screen a notification's `data.screen` opens.
 */
import type { AdminTabParams, RootStackParams, TabParams } from "../navigation/types";

/**
 * The tab bar, left to right. Five cells, Record in the middle (every cell is `flex: 1`, so only an odd count
 * centres it). Practice is daily and Hymns is the offline book: both are places people come back to, so both are
 * tabs. Profile is the avatar at the top right of every tab, and Songs ("Paste link") is a chip on Home.
 */
export const TAB_ORDER = ["Home", "Library", "Record", "Practice", "Hymns"] as const satisfies readonly (keyof TabParams)[];

export type TabName = (typeof TAB_ORDER)[number];

export function isTab(name: string): name is TabName {
  return (TAB_ORDER as readonly string[]).includes(name);
}

/**
 * The admin's own bottom bar (board f-admin/03): what an admin opens on a phone, Payments second; everything else of
 * the web console's sidebar is under More.
 */
export const ADMIN_TAB_ORDER = ["Overview", "Payments", "Users", "Health", "More"] as const satisfies readonly (keyof AdminTabParams)[];

export type AdminTabName = (typeof ADMIN_TAB_ORDER)[number];

/** Root-stack routes a notification may open directly. */
type PushedRoute = Extract<keyof RootStackParams, "Upgrade" | "SupportChat">;

export type NavTarget =
  /** Switch to a tab: `navigate('Tabs', { screen })`, since a tab is nested in the root stack. */
  | { kind: "tab"; tab: TabName }
  /** Push a root-stack route. */
  | { kind: "route"; route: PushedRoute }
  /**
   * An admin tab, behind the admin lock: `navigate('Admin', { screen: 'AdminTabs', params: { screen: tab, … } })`. A
   * payment id opens that payment's sheet over Payments. Resolves for an admin only.
   */
  | { kind: "admin"; tab: AdminTabName; paymentId?: string; view?: "webhooks" }
  /** One account's page in Admin, over Users (behind the admin lock). Resolves for an admin only. */
  | { kind: "adminUser"; userId: string }
  /** Not a screen: the store listing (an out-of-date app has nothing in it to show). */
  | { kind: "store" }
  /** A web console page, opened in the in-app browser (`lib/adminConsole`). Resolves for an admin only. */
  | { kind: "console"; path: string };

type Entry = { admin?: boolean; target: (data: { paymentId?: unknown; userId?: unknown }) => NavTarget | null };

/** A payment or account id as the server sends it (a GUID); anything else is not followed. */
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Screens a notification may ask for by name, and how to get there. Doubles as the allow-list: a `screen` the
 * server did not send — or one from an older build — finds no entry and is ignored, so an unexpected payload
 * cannot reach the navigator with a route it does not have. Adding one is a line here and the matching
 * `Data["screen"]` on the server. The admin's are followed for an admin only: for anyone else they do not exist
 * (and the Admin screens are not registered for them either).
 */
const NOTIFICATION_TARGETS: Record<string, Entry> = {
  /** `NotifySubscriptionExpiringCommand` and the founder's checkout note. */
  Upgrade: { target: () => ({ kind: "route", route: "Upgrade" }) },
  /** `SendPaymentAlertsCommand`: one payment ("₦7,500 · Pro Monthly") opens its sheet over Payments. */
  AdminPayment: {
    admin: true,
    target: (data) =>
      typeof data.paymentId === "string" && GUID.test(data.paymentId)
        ? { kind: "admin", tab: "Payments", paymentId: data.paymentId }
        : { kind: "admin", tab: "Payments" },
  },
  /** A payment summary, the test alert, and `NotifyAdminsOfPaymentIssuesCommand`: the screen with Reconcile. */
  AdminPayments: { admin: true, target: () => ({ kind: "admin", tab: "Payments" }) },
  AdminWebhooks: { admin: true, target: () => ({ kind: "admin", tab: "Payments", view: "webhooks" }) },
  /** `SendAdminActivityAlertsCommand`: one person signed up or is transcribing, so their account opens. */
  AdminUser: {
    admin: true,
    target: (data) =>
      typeof data.userId === "string" && GUID.test(data.userId)
        ? { kind: "adminUser", userId: data.userId }
        : { kind: "admin", tab: "Users" },
  },
  /** The same, for several people at once: the Users list. */
  AdminUsers: { admin: true, target: () => ({ kind: "admin", tab: "Users" }) },
  /** Live support's answer to this person (`ReplySupportCommand`): their chat. */
  SupportChat: { target: () => ({ kind: "route", route: "SupportChat" }) },
  /** A customer wrote to support (`SendSupportMessageCommand`): the console's Support page. */
  AdminSupport: { admin: true, target: () => ({ kind: "console", path: "/support" }) },
  /** `NotifyAppUpdateCommand`. */
  AppUpdate: { target: () => ({ kind: "store" }) },
  /** The founder's first-song note and the phone's own fallback reminder. */
  Record: { target: () => ({ kind: "tab", tab: "Record" }) },
  /** Every practice reminder the server pushes (C# `PracticeReminderService.Message`): the Practice tab. */
  Practice: { target: () => ({ kind: "tab", tab: "Practice" }) },
};

/**
 * The screen a notification's data opens, or null. `isAdmin` is the account's role as the server last reported it:
 * an admin target is null for anyone else, so a customer's phone can never be sent into Admin by a push.
 */
export function notificationTarget(
  screen: unknown,
  opts: { isAdmin?: boolean; paymentId?: unknown; userId?: unknown } = {},
): NavTarget | null {
  if (typeof screen !== "string" || !Object.prototype.hasOwnProperty.call(NOTIFICATION_TARGETS, screen)) return null;
  const entry = NOTIFICATION_TARGETS[screen];
  if (!entry || (entry.admin && opts.isAdmin !== true)) return null;
  return entry.target({ paymentId: opts.paymentId, userId: opts.userId });
}

/** Whether a `screen` names an admin place: the tap is then held until the lock opens. */
export function isAdminScreen(screen: unknown): boolean {
  return typeof screen === "string" && Object.prototype.hasOwnProperty.call(NOTIFICATION_TARGETS, screen)
    && NOTIFICATION_TARGETS[screen]?.admin === true;
}
