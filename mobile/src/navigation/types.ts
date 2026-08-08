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
  Settings: undefined;
  Help: undefined;
};
