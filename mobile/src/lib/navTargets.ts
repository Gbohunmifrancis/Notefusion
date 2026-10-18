/**
 * Where things live in the app's navigation, as plain data (tests: navTargets.test.ts): the tab bar's cells,
 * and the screen a notification's `data.screen` opens.
 */
import type { RootStackParams, TabParams } from "../navigation/types";

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

/** Root-stack routes a notification may open directly. */
type PushedRoute = Extract<keyof RootStackParams, "Upgrade" | "AdminPayments" | "AdminWebhooks">;

export type NavTarget =
  /** Switch to a tab: `navigate('Tabs', { screen })`, since a tab is nested in the root stack. */
  | { kind: "tab"; tab: TabName }
  /** Push a root-stack route. */
  | { kind: "route"; route: PushedRoute }
  /** Not a screen: the store listing (an out-of-date app has nothing in it to show). */
  | { kind: "store" };

/**
 * Screens a notification may ask for by name, and how to get there. Doubles as the allow-list: a `screen` the
 * server did not send — or one from an older build — finds no entry and is ignored, so an unexpected payload
 * cannot reach the navigator with a route it does not have. Adding one is a line here and the matching
 * `Data["screen"]` on the server.
 */
const NOTIFICATION_TARGETS: Record<string, NavTarget> = {
  /** `NotifySubscriptionExpiringCommand` and the founder's checkout note. */
  Upgrade: { kind: "route", route: "Upgrade" },
  /** `NotifyAdminsOfPaymentIssuesCommand` — the screen with the Reconcile button. */
  AdminPayments: { kind: "route", route: "AdminPayments" },
  AdminWebhooks: { kind: "route", route: "AdminWebhooks" },
  /** `NotifyAppUpdateCommand`. */
  AppUpdate: { kind: "store" },
  /** The founder's first-song note and the phone's own fallback reminder. */
  Record: { kind: "tab", tab: "Record" },
  /** Every practice reminder the server pushes (C# `PracticeReminderService.Message`): the Practice tab. */
  Practice: { kind: "tab", tab: "Practice" },
};

export function notificationTarget(screen: unknown): NavTarget | null {
  if (typeof screen !== "string" || !Object.prototype.hasOwnProperty.call(NOTIFICATION_TARGETS, screen)) return null;
  return NOTIFICATION_TARGETS[screen] ?? null;
}
