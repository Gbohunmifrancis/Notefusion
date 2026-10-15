import type { NavigatorScreenParams } from '@react-navigation/native';
import type { TranscriptionResult } from '../api/types';

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
 * Home · Library · **Record** · Songs · Profile. Profile came back off the side bar to
 * make the count work and because it is a destination people look for in a tab bar.
 * Songs is a *launcher*, not a tab: the cell pushes `Link` on the root stack — paste a
 * song link, get its lead vocal as solfa — the way the mic pushes a recording.
 */
export type TabParams = {
  Home: undefined;
  Library: undefined;
  Record: { autoPickAudio?: boolean } | undefined;
  Profile: undefined;
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
  };
  /**
   * `focus` scrolls straight to a section. The Profile menu has separate
   * "Notifications" and "About Notefusion" rows, and both used to land on a screen
   * showing something else; anchoring them here keeps each row honest without a
   * screen apiece.
   */
  Settings: { focus?: 'notifications' | 'about' } | undefined;
  Help: undefined;
  /**
   * `reason: "limit"` when a free account has just been refused for having nothing left:
   * the one-song purchase is then the option already chosen.
   */
  Upgrade: { reason?: 'limit' } | undefined;
  /**
   * My choir: the choir plan's home — the director's invite link and singers, a singer's
   * choir, the shared library, and "Enter choir code" for someone in none. `code` fills the
   * join field (notefusion://join/CODE); joining is still a tap.
   */
  Choir: { code?: string } | undefined;

  /**
   * Admin-only screens, reached from the side bar's Admin row and nowhere else.
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
