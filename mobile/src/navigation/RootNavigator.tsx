import React, { useMemo } from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { navigationRef, useNotificationDeepLink } from '../lib/notificationLink';
import { SplashScreen } from '../screens/SplashScreen';
import { AuthNavigator } from './AuthNavigator';
import { TabNavigator } from './TabNavigator';
import { ResultScreen } from '../screens/ResultScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { HelpScreen } from '../screens/HelpScreen';
import { UpgradeScreen } from '../screens/UpgradeScreen';
import { AdminHomeScreen } from '../screens/admin/AdminHomeScreen';
import { AdminPaymentsScreen } from '../screens/admin/AdminPaymentsScreen';
import { AdminUserScreen } from '../screens/admin/AdminUserScreen';
import { AdminUsersScreen } from '../screens/admin/AdminUsersScreen';
import { AdminWebhooksScreen } from '../screens/admin/AdminWebhooksScreen';
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

  // Hold the splash for the stored theme as well as the session: mounting the
  // navigator light and repainting it dark a frame later is the flash the
  // preference exists to avoid.
  if (initializing || themeLoading) return <SplashScreen />;

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {user ? (
          <>
            <Stack.Screen name="Tabs" component={TabNavigator} />
            <Stack.Screen
              name="Result"
              component={ResultScreen}
              options={{ presentation: 'card', animation: 'slide_from_bottom' }}
            />
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
              name="Help"
              component={HelpScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="Upgrade"
              component={UpgradeScreen}
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
  );
}
