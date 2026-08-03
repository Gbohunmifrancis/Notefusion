import React, { useEffect } from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../lib/auth';
import { isExpoGo } from '../lib/env';
import { SplashScreen } from '../screens/SplashScreen';
import { AuthNavigator } from './AuthNavigator';
import { TabNavigator } from './TabNavigator';
import { ResultScreen } from '../screens/ResultScreen';
import { colors } from '../design/theme';
import type { RootStackParams } from './types';

const Stack = createNativeStackNavigator<RootStackParams>();

// A light navigation theme so there's never a dark flash between screens.
const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.bg,
    card: colors.bgElevated,
    text: colors.text,
    border: colors.border,
    primary: colors.ink,
  },
};

/**
 * Top-level router. Switches between the auth flow and the authenticated app
 * based on session state, showing the branded splash while the session restores.
 */
export function RootNavigator() {
  const { user, initializing } = useAuth();

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

  if (initializing) return <SplashScreen />;

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
          </>
        ) : (
          <Stack.Screen name="Tabs" component={AuthNavigator} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
