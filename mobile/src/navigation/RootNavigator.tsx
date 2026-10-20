import React, { useEffect, useMemo, useRef } from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { useAppUpdatePrompt } from '../lib/appUpdate';
import { useReminderSync } from '../lib/practiceReminder';
import { navigationRef, useNotificationDeepLink } from '../lib/notificationLink';
import { useListenDeepLink } from '../lib/listenLink';
import { useChoirDeepLink } from '../lib/choirLink';
import { logScreenView } from '../lib/analytics';
import * as Sentry from '@sentry/react-native';
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
import { ProfileScreen } from '../screens/ProfileScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { PracticeModeScreen } from '../screens/practice/PracticeModeScreen';
import { SeasonPathScreen } from '../screens/practice/SeasonPathScreen';
import { useOutboxRunner } from '../lib/outbox';
import { usePreviewClaim } from '../lib/previewClaim';
import { useSeasonSync } from '../lib/seasonStore';
import { autoRefreshPack } from '../lib/hymnPackStore';
import { AdminRoot } from '../screens/admin/AdminNavigator';
import { useAdminSession } from '../lib/adminSession';
import { FeedbackProvider } from '../lib/feedback';
import type { RootStackParams } from './types';

const Stack = createNativeStackNavigator<RootStackParams>();

/**
 * Top-level router. Switches between the auth flow and the authenticated app
 * based on session state, showing the branded splash while the session restores.
 */
export function RootNavigator() {
  const { user, initializing, isAdmin } = useAuth();
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
  useNotificationDeepLink(Boolean(user), isAdmin);

  // Admin locks, and everything it read is dropped, on sign-out and on an account change.
  useAdminSession(user?.id ?? null);

  // Error reports and recordings carry the account's id and nothing else about it; the console looks the person up.
  const userId = user?.id ?? null;
  useEffect(() => {
    Sentry.setUser(userId ? { id: userId } : null);
  }, [userId]);

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

  // Practice reminders are the server's pushes: whenever the app comes forward this reads the account's
  // choice, cancels any reminder the phone scheduled itself, and tells the server this phone takes them
  // (lib/practiceReminder; the on-device schedule is only the fallback when the server was never reached).
  useReminderSync(Boolean(user));

  // Record now, send later: recordings that could not be sent go out when the API can be reached.
  useOutboxRunner(Boolean(user));

  // A guest's preview (board l-ux-high/07) is claimed by the account signed up or in to, and saved to its Library.
  usePreviewClaim(Boolean(user));

  // The season flag (lib/seasonStore): read now, on every return to the app and when the account changes, and kept
  // on the phone for the next launch's splash. Off, it changes nothing anywhere.
  useSeasonSync(!initializing, user?.id ?? null);

  // The offline hymn pack's weekly look for a newer version (never on data saver; hymnPackStore).
  useEffect(() => {
    if (user) void autoRefreshPack();
  }, [user]);

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
            {/* The avatar at the top right of every tab pushes Profile; Settings and Notifications are its rows. */}
            <Stack.Screen
              name="Profile"
              component={ProfileScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="Settings"
              component={SettingsScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="Notifications"
              component={NotificationsScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="PracticeMode"
              component={PracticeModeScreen}
              options={{ animation: 'slide_from_right' }}
            />
            {/* A season's path (the carols, the Midnight path), from the Practice hub's season card while it is on. */}
            <Stack.Screen
              name="SeasonPath"
              component={SeasonPathScreen}
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
              name="Link"
              component={LinkScreen}
              options={{ presentation: 'card', animation: 'slide_from_bottom' }}
            />
            <Stack.Screen
              name="Listen"
              component={ListenScreen}
              options={{ presentation: 'card', animation: 'slide_from_bottom' }}
            />

            {/* Admin: registered only for an admin (the role the server's profile reports), so for anyone else it does
                not exist — no row, no route, no deep link or push can open it. Adding or removing it keeps the rest of the
                stack's state; an admin demoted mid-session is moved off it. Behind its own lock (lib/adminLockRuntime),
                and every admin endpoint checks the role in the database regardless. */}
            {isAdmin ? (
              <Stack.Screen name="Admin" component={AdminRoot} options={{ animation: 'slide_from_right' }} />
            ) : null}
          </>
        ) : (
          <Stack.Screen name="Tabs" component={AuthNavigator} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
    </FeedbackProvider>
  );
}
