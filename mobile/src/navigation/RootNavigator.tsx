import React, { useEffect, useMemo } from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { isExpoGo } from '../lib/env';
import { SplashScreen } from '../screens/SplashScreen';
import { AuthNavigator } from './AuthNavigator';
import { TabNavigator } from './TabNavigator';
import { ResultScreen } from '../screens/ResultScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { HelpScreen } from '../screens/HelpScreen';
import { UpgradeScreen } from '../screens/UpgradeScreen';
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

  // Tapping a "transcription ready" push could deep-link here later; for now we
  // just ensure the handler is installed so foreground notifications present.
  // Skipped in Expo Go (SDK 53+ dropped remote push; importing the module throws).
  useEffect(() => {
    if (isExpoGo) return;
    const Notifications = require('expo-notifications') as typeof import('expo-notifications');
    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      /* deep-link handling hook — no-op for MVP */
    });
    return () => sub.remove();
  }, []);

  // Hold the splash for the stored theme as well as the session: mounting the
  // navigator light and repainting it dark a frame later is the flash the
  // preference exists to avoid.
  if (initializing || themeLoading) return <SplashScreen />;

  return (
    <NavigationContainer theme={navTheme}>
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
              options={{ animation: 'slide_from_bottom' }}
            />
          </>
        ) : (
          <Stack.Screen name="Tabs" component={AuthNavigator} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
