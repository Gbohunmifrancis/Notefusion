import type { NavigatorScreenParams } from '@react-navigation/native';
import type { TranscriptionResult } from '../api/types';

/** Central navigation type map — every screen's params in one place. */

export type AuthStackParams = {
  Onboarding: undefined;
  Login: undefined;
  Register: undefined;
};

export type TabParams = {
  Home: undefined;
  Record: undefined;
  Library: undefined;
  Profile: undefined;
  Subscription: undefined;
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
};
