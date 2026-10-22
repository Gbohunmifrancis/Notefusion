import type { NavigatorScreenParams } from '@react-navigation/native';
import type { PracticeModeId, PracticeTrack, TranscriptionResult } from '../api/types';
import type { SeasonName } from '../lib/season';

/** Central navigation type map — every screen's params in one place. */

export type AuthStackParams = {
  Onboarding: undefined;
  /** Google, email, sign in or try it first: where the intro ends and where a signed-out return lands. */
  Welcome: undefined;
  /** Login and Register are each seeded with the email typed on the other, when one was. */
  Login: { email?: string } | undefined;
  Register: { email?: string } | undefined;
  /**
   * The email is a param rather than screen state because two routes arrive here:
   * sign-up, and a login that was refused as unverified. Both know the address the
   * code went to, and the screen must show it so a typo is visible. `sentAt` is when the
   * code went (ms): a start that reopens the screen (lib/pendingVerify) keeps the first time.
   * Every route passes all three, so none is taken from that reopening's initial params.
   */
  VerifyEmail: { email: string; fromSignUp: boolean; sentAt: number };
  /** Seeded with whatever was already typed into Sign in. */
  ForgotPassword: { email?: string } | undefined;
  /**
   * "Try it first" (board l-ux-high/07): Record as a guest — thirty seconds, the microphone or a file, no account —
   * sent to the website's anonymous preview. Follows a preview this phone sent before and has not seen yet.
   */
  GuestRecord: undefined;
  /** The guest's preview in the Result screen, read-only (`guest`), with the card that keeps it. */
  Result: ResultParams;
};

/** The Result screen's params: in the app, and in the signed-out stack for a guest's preview. */
export type ResultParams = {
  result: TranscriptionResult;
  sourceJobId?: string;
  savedId?: string;
  title?: string;
  /**
   * A saved sheet from a pasted link (boards o-backing O3/4): its backing is never kept, and the dock says so. A
   * fresh result knows it from `result.source`.
   */
  fromLink?: boolean;
  /**
   * Semitones a saved sheet has been moved by "Transpose for my choir" from the key it was heard in: its song's
   * backing plays only at 0 (boards o-backing O3/3).
   */
  transposedBy?: number;
  /**
   * Opened straight from its finished job (the record or link flow, or the job's notification): Doh's toast
   * celebrates it, once per job. Never set on a reopen from the Library or Home.
   */
  fresh?: boolean;
  /**
   * Where it was opened from when the other params cannot say (a hymn from the book, a choir's shared sheet, a ready
   * push): only for the `result_opened` event in the console's activity feed.
   */
  openedFrom?: "hymn" | "choir" | "notification";
  /** Open on Learn my part (or, with no parts, Rehearse's loop): Home's "Practise this tune". */
  practise?: boolean;
  /**
   * A guest's preview (board l-ux-high/07): the sheet, playback and the ways to read it, nothing that saves,
   * shares, exports or edits, and the "Keep this sheet" card. Only ever in the signed-out stack.
   */
  guest?: boolean;
  /**
   * "See an example" (board n-ux-low Q4j): the bundled Amazing Grace (`openSheet.exampleResult`), marked "An example —
   * not in your Library". It plays, rehearses and reads in every layout; Save, share, export and the sheet's options
   * are hidden and nothing is filed or spent (no free harmony).
   */
  example?: boolean;
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
   * The hymns the website publishes, from the offline pack: browse, search, open as a sheet. `shelf` (Home's season
   * chip, Carols or Spooky songs, while a season is on) opens it at the top, on the season's shelf.
   */
  Hymns: { shelf?: boolean } | undefined;
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
  Result: ResultParams;
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
   * A season's practice path, pushed from the Practice hub's season card while that season is on: the Christmas
   * carols (board d-christmas/03, the Carol singer sticker) or Halloween's Midnight path (board j-halloween/03, the
   * Night Singer sticker). Six short drills, each heard, sung and marked like a drill.
   */
  SeasonPath: { season: SeasonName; track?: PracticeTrack | null };
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
   * The phone admin (board f-admin): a stack of its own with its own bottom bar, behind the admin lock. Registered
   * only for an admin (the role the server's profile reports), so for anyone else it does not exist: no row, no
   * route, no deep link or push can open it. Every admin endpoint checks the role in the database regardless.
   * Reached from Profile's Admin row and from a payment push (`lib/navTargets`), which names a tab and a payment.
   */
  Admin: NavigatorScreenParams<AdminStackParams> | undefined;
};

/**
 * Inside Admin: the bottom bar's tabs, and the pages pushed over them (an account, and More's native sections).
 * The × at the top, or Android back from a tab's root, leaves Admin for the app.
 */
export type AdminStackParams = {
  AdminTabs: NavigatorScreenParams<AdminTabParams> | undefined;
  /** One account: badges, the free week, payments and the actions. From Users, a payment or Growth. */
  AdminUser: { userId: string };
  /** More › Growth: renewals, free to paid, transcription health, app versions. */
  AdminGrowth: undefined;
  /** More › Feature flags (Operations): the Halloween and Christmas seasons. */
  AdminFlags: undefined;
  /** More › Payment alerts: how this phone is told when someone pays. */
  AdminAlerts: undefined;
};

/** The admin's bottom bar, left to right (`lib/navTargets` ADMIN_TAB_ORDER): Overview · Payments · Users · Health · More. */
export type AdminTabParams = {
  Overview: undefined;
  /**
   * Payments, Webhooks and Ledger as one section. `paymentId` opens that payment's sheet (a payment push lands here);
   * `filter` "attention" opens on "Needs a look" (the Overview's amber line). `nonce` makes a repeat of the same
   * request open again.
   */
  Payments: { paymentId?: string; view?: "payments" | "webhooks" | "ledger"; filter?: "attention"; nonce?: number } | undefined;
  Users: undefined;
  Health: undefined;
  More: undefined;
};
