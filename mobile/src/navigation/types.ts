import type { NavigatorScreenParams } from '@react-navigation/native';
import type { PracticeModeId, PracticeTrack, TranscriptionResult } from '../api/types';

/** Central navigation type map — every screen's params in one place. */

export type AuthStackParams = {
  Onboarding: undefined;
  /** Google, email or sign in: where the intro ends and where a signed-out return lands. */
  Welcome: undefined;
  Login: undefined;
  Register: undefined;
  /**
   * The email is a param rather than screen state because two routes arrive here:
   * sign-up, and a login that was refused as unverified. Both know the address the
   * code went to, and the screen must show it so a typo is visible.
   */
  VerifyEmail: { email: string; fromSignUp?: boolean };
  /** Seeded with whatever was already typed into Sign in. */
  ForgotPassword: { email?: string } | undefined;
};

/**
 * Five cells, and five because it is odd. Every cell is `flex: 1`, so only an odd count
 * puts the mic in the geometric middle — with an even one it sits off-centre and the
 * whole bar reads as a mistake.
 *
 * Home · Library · **Record** · Practice · Hymns, labelled (`lib/navTargets` `TAB_ORDER`).
 * Practice is daily (streaks, reminders) and Hymns is the offline book: places people come
 * back to. Profile is not a tab: the avatar at the top right of every tab pushes it. Pasting
 * a song link is a chip on Home.
 */
export type TabParams = {
  Home: undefined;
  Library: undefined;
  Record: { autoPickAudio?: boolean } | undefined;
  /** Practice: the drill on the path, the streak, XP and level, the weekly goal and badges. Reminders open it. */
  Practice: undefined;
  /**
   * The hymns the website publishes, from the offline pack: browse, search, open as a sheet. `carols` (Home's Carols
   * chip, while the Christmas season is on) opens it on the carols.
   */
  Hymns: { carols?: boolean } | undefined;
};

export type RootStackParams = {
  Tabs: NavigatorScreenParams<TabParams>;
  /** Paste a song link (YouTube, Spotify, Apple Music) and transcribe its lead vocal. */
  Link: undefined;
  /**
   * "Find the key": listens through the microphone and names the doh while another app plays.
   * Opened by notefusion://listen too, which never starts listening by itself.
   */
  Listen: undefined;
  // Result can arrive fresh from a job or be opened from the library.
  Result: {
    result: TranscriptionResult;
    sourceJobId?: string;
    savedId?: string;
    title?: string;
    /**
     * Opened straight from its finished job (the record or link flow, or the job's notification): Doh's toast
     * celebrates it, once per job. Never set on a reopen from the Library or Home.
     */
    fresh?: boolean;
    /** Open on Learn my part (or, with no parts, Rehearse's loop): Home's "Practise this tune". */
    practise?: boolean;
  };
  /**
   * The account and the phone's settings (account, appearance, data and offline, help and about, sign out,
   * delete). Pushed from Profile.
   */
  Settings: undefined;
  /** Push, sound, the practice reminder and its hour, and the founder's emails. Pushed from Profile. */
  Notifications: undefined;
  /**
   * One of "More ways to practise", pushed from the Practice tab's list (screens/practice): the warm-up and range
   * finder, pitch match, riffs & runs, intervals, sing the harmony or rhythm. `track` words it as the hub did.
   */
  PracticeMode: { mode: PracticeModeId; track?: PracticeTrack | null };
  /**
   * The Christmas carols path (board d-christmas/03), pushed from the Practice hub's pine card while the season is
   * on: six short drills from carols we hold, each heard, sung and marked like a drill, and the Carol singer sticker.
   */
  Carols: { track?: PracticeTrack | null } | undefined;
  /**
   * The account page: plan, choir, Notifications, Settings, help and feedback. Pushed from the avatar
   * at the top right of every tab, so back returns to the tab you were on.
   */
  Profile: undefined;
  Help: undefined;
  /**
   * `reason: "limit"` when a free account has just been refused for having nothing left:
   * the one-song purchase is then the option already chosen. `planId` chooses a plan outright:
   * the limit sheet's rows each open the screen on the plan they priced.
   */
  Upgrade: { reason?: 'limit'; planId?: string } | undefined;
  /**
   * My choir: the choir plan's home — the director's invite link and singers, a singer's
   * choir, the shared library, and "Enter choir code" for someone in none. `code` fills the
   * join field (notefusion://join/CODE); joining is still a tap.
   */
  Choir: { code?: string } | undefined;
  /**
   * Admin-only screens, reached from Profile's Admin row (admins only) and nowhere else.
   *
   * Pushed routes rather than tabs: the tab bar above is full, and an operator
   * surface should not cost every user a tab. Each screen is behind the server's
   * Admin policy regardless of how it was reached.
   */
  AdminHome: undefined;
  /**
   * `search` seeds the search box. The webhook inbox pushes here with a payment
   * reference, because a failed callback is diagnosed there and repaired on the
   * payment — a push rather than a navigate, so back returns to the inbox and the
   * seeded screen is always a fresh one.
   */
  AdminPayments: { search?: string } | undefined;
  AdminWebhooks: undefined;
  /** The account search. Split from `AdminUser` so finding and acting are
   *  separate steps, the same way a payment row opens a payment. */
  AdminUsers: undefined;
  /** The account to act on. Reached from a payment row or the account search. */
  AdminUser: { userId: string };
};
