import type { NavigatorScreenParams } from '@react-navigation/native';
import type { NoteEvent, TranscriptionResult } from '../api/types';

/** Central navigation type map — every screen's params in one place. */

export type AuthStackParams = {
  Onboarding: undefined;
  Login: undefined;
  Register: undefined;
  /**
   * The email is a param rather than screen state because two routes arrive here:
   * sign-up, and a login that was refused as unverified. Both know the address the
   * code went to, and the screen must show it so a typo is visible.
   */
  VerifyEmail: { email: string };
};

/**
 * Five cells, and five because it is odd. Every cell is `flex: 1`, so only an odd count
 * puts the mic in the geometric middle — with an even one it sits off-centre and the
 * whole bar reads as a mistake.
 *
 * Home · Library · **Record** · Piano · Profile. Profile came back off the side bar to
 * make the count work and because it is a destination people look for in a tab bar. The
 * piano is a *launcher*, not a tab: it is the one landscape route in the app, so it
 * cannot render inside this portrait shell and has no `Tab.Screen` here — the cell
 * pushes `Piano` on the root stack instead, the way the mic pushes a recording.
 */
export type TabParams = {
  Home: undefined;
  Library: undefined;
  Record: undefined;
  Profile: undefined;
};

export type RootStackParams = {
  Tabs: NavigatorScreenParams<TabParams>;
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
  Upgrade: undefined;

  /**
   * The piano — one landscape screen with three modes.
   *
   * `free` is the tab-bar cell: a keyboard to play anything on, captured to the
   * library. `play` and `correct` start from a transcription and carry the notes by
   * value rather than a saved id, because on Result the notes that matter are the
   * *edited* ones, which exist nowhere a re-fetch could find them. `correct` carries
   * an `onApply` so the corrected list travels home to whoever saved it; reactive,
   * not serialisable — the dev-only warning for this route is deliberate.
   *
   * Landscape is a native option on `react-native-screens`, so it takes a build, not
   * an OTA update.
   */
  Piano:
    | { mode: 'free' }
    | {
        mode: 'play' | 'correct';
        notes: NoteEvent[];
        tempoBpm: number;
        timeSignature: string;
        musicalKey: string;
        title?: string;
        savedId?: string;
        onApply?: (notes: NoteEvent[]) => void;
      };

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
