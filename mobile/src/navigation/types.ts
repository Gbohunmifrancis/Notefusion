import type { NavigatorScreenParams } from '@react-navigation/native';
import type { TranscriptionResult } from '../api/types';

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
 * Three tabs, not five. The mic is the middle cell and every cell is `flex: 1`, so an odd
 * count centres it — the account and the plan moved to the side bar (`AppDrawer`) rather
 * than being carried here as spacers.
 */
export type TabParams = {
  Home: undefined;
  Record: undefined;
  Library: undefined;
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
  /** Reached from the side bar's identity block; a pushed screen since it left the tab bar. */
  Profile: undefined;
  /**
   * `focus` scrolls straight to a section. The Profile menu has separate
   * "Notifications" and "About Notefusion" rows, and both used to land on a screen
   * showing something else; anchoring them here keeps each row honest without a
   * screen apiece.
   */
  Settings: { focus?: 'notifications' | 'about' } | undefined;
  Help: undefined;
  Upgrade: undefined;
};
