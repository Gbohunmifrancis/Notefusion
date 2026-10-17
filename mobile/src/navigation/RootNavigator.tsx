import React, { useMemo, useRef } from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { useAppUpdatePrompt } from '../lib/appUpdate';
import { useReminderWindow } from '../lib/practiceReminder';
import { navigationRef, useNotificationDeepLink } from '../lib/notificationLink';
import { useListenDeepLink } from '../lib/listenLink';
import { useChoirDeepLink } from '../lib/choirLink';
import { logScreenView } from '../lib/analytics';
import { SplashScreen } from '../screens/SplashScreen';
import { AuthNavigator } from './AuthNavigator';
import { TabNavigator } from './TabNavigator';
import { ResultScreen } from '../screens/ResultScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { HelpScreen } from '../screens/HelpScreen';
import { UpgradeScreen } from '../screens/UpgradeScreen';
import { LinkScreen } from '../screens/LinkScreen';
import { ListenScreen } from '../screens/ListenScreen';
import { ChoirScreen } from '../screens/ChoirScreen';
import { PracticeScreen } from '../screens/PracticeScreen';
import { AdminHomeScreen } from '../screens/admin/AdminHomeScreen';
import { AdminPaymentsScreen } from '../screens/admin/AdminPaymentsScreen';
import { AdminUserScreen } from '../screens/admin/AdminUserScreen';
import { AdminUsersScreen } from '../screens/admin/AdminUsersScreen';
import { AdminWebhooksScreen } from '../screens/admin/AdminWebhooksScreen';
import { FeedbackProvider } from '../lib/feedback';
import type { RootStackParams } from './types';

const Stack = createNativeStackNavigator<RootStackParams>();

/**
 * Top-level router. Switches between the auth flow and the authenticated app
 * based on session state, showing the branded splash while the session restores.
 */
export function RootNavigator() {
  const { user, initializing } = useAuth();
  const { palette, mode, loading: themeLoading } = useTheme();

  // React Navigation paints the gap between screens itself, so it needs the
  // palette too — otherwise every push flashes the wrong canvas colour. Its
  // dark base also flips the built-in header/back-gesture defaults.
  const navTheme = useMemo(() => {
    const base = mode === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background: palette.bg,
        card: palette.bgElevated,
        text: palette.text,
        border: palette.border,
        primary: palette.ink,
      },
    };
  }, [mode, palette]);

  // Tapping a "transcription ready" push opens that transcription as an unsaved draft. Held until
  // the authenticated stack exists, because a tap is what launches the app in the case this feature
  // is for.
  useNotificationDeepLink(Boolean(user));

  // The Quick Settings tile, the home-screen widget and the listening notification open
  // notefusion://listen. Same hold-until-signed-in rule; only that one path is matched. Also held
  // until the container below is mounted: a link that drained while the splash still showed would
  // find no navigator and be lost.
  useListenDeepLink(Boolean(user) && !initializing && !themeLoading);

  // A choir invite, notefusion://join/CODE: same hold, to the My choir screen with the code filled in.
  useChoirDeepLink(Boolean(user) && !initializing && !themeLoading);

  // "There's a newer version in the store" — checked here rather than on a screen because it has
  // to reach whichever screen the user happens to be on, and because the blocking case must not
  // be escapable by navigating.
  //
  // Gated on the splash being done rather than on being signed in: someone whose build is below
  // the minimum gets rejected at sign-in, so the login screen is exactly where they end up and
  // exactly where the dialog has to reach them. (A dialog over the splash reads as a crash, which
  // is why it is gated at all — hooks run above the early return below.)
  useAppUpdatePrompt(!initializing && !themeLoading);

  // Re-tops the 14-day reminder window whenever the app comes forward. Local scheduling has no
  // server to keep it filled, so this is the only thing that stops the window running out.
  useReminderWindow(Boolean(user));

  const routeNameRef = useRef<string | undefined>(undefined);

  // Hold the splash for the stored theme as well as the session: mounting the
  // navigator light and repainting it dark a frame later is the flash the
  // preference exists to avoid.
  if (initializing || themeLoading) return <SplashScreen />;

  return (
    // Owns "where did you hear about us?", the rating prompt and the feedback form; signed-in only.
    <FeedbackProvider enabled={Boolean(user)}>
    <NavigationContainer
      ref={navigationRef}
      theme={navTheme}
      onReady={() => {
        const currentRoute = navigationRef.getCurrentRoute()?.name;
        routeNameRef.current = currentRoute;
        if (currentRoute) {
          void logScreenView(currentRoute);
        }
      }}
      onStateChange={() => {
        const previousRouteName = routeNameRef.current;
        const currentRouteName = navigationRef.getCurrentRoute()?.name;
        if (currentRouteName && previousRouteName !== currentRouteName) {
          void logScreenView(currentRouteName);
          routeNameRef.current = currentRouteName;
        }
      }}
    >
      {/* `orientation: 'portrait'` here rather than in app.json, which is inverted to
          `default` on purpose: iOS reads `expo.orientation` into
          `UISupportedInterfaceOrientations`, and a runtime lock can never *exceed*
          that list — so the only way one screen rotates is for the manifest to allow
          both and every screen but that one to lock itself down. Inherited by
          `AuthNavigator` and `TabNavigator`. */}
      <Stack.Navigator screenOptions={{ headerShown: false, orientation: 'portrait' }}>
        {user ? (
          <>
            <Stack.Screen name="Tabs" component={TabNavigator} />
            <Stack.Screen
              name="Result"
              component={ResultScreen}
              options={{ presentation: 'card', animation: 'slide_from_bottom' }}
            />
            <Stack.Screen
              name="Settings"
              component={SettingsScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="Help"
              component={HelpScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="Upgrade"
              component={UpgradeScreen}
              options={{ presentation: 'card', animation: 'slide_from_bottom' }}
            />
            <Stack.Screen
              name="Choir"
              component={ChoirScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="Practice"
              component={PracticeScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="Link"
              component={LinkScreen}
              options={{ presentation: 'card', animation: 'slide_from_bottom' }}
            />
            <Stack.Screen
              name="Listen"
              component={ListenScreen}
              options={{ presentation: 'card', animation: 'slide_from_bottom' }}
            />

            {/* Admin. Registered for every session rather than gated here: the
                only way in is the drawer row, which checks `isAdmin`, and a
                conditional screen list would remount the stack the moment the
                boot profile re-read changes that flag. */}
            <Stack.Screen
              name="AdminHome"
              component={AdminHomeScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="AdminPayments"
              component={AdminPaymentsScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="AdminWebhooks"
              component={AdminWebhooksScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="AdminUsers"
              component={AdminUsersScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="AdminUser"
              component={AdminUserScreen}
              options={{ animation: 'slide_from_right' }}
            />
          </>
        ) : (
          <Stack.Screen name="Tabs" component={AuthNavigator} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
    </FeedbackProvider>
  );
}
