import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { RegisterScreen } from '../screens/RegisterScreen';
import { VerifyEmailScreen } from '../screens/VerifyEmailScreen';
import { ForgotPasswordScreen } from '../screens/ForgotPasswordScreen';
import { onboarding } from '../lib/onboarding';
import { pendingVerifyStore } from '../lib/pendingVerifyStore';
import type { PendingVerify } from '../lib/pendingVerify';
import { night } from '../design/theme';
import type { AuthStackParams } from './types';

const Stack = createNativeStackNavigator<AuthStackParams>();

/**
 * Unauthenticated flow: the intro cards (first time only) → Welcome → sign in or
 * create an account → the email code. Every screen here is on the night canvas,
 * which is also what shows between screens during a transition. A code sent under
 * ten minutes ago and not yet typed (the app closed while its mail was read) opens
 * the code screen again.
 */
export function AuthNavigator() {
  const [start, setStart] = useState<{ seen: boolean; pending: PendingVerify | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([onboarding.seen(), pendingVerifyStore.read()]).then(
      ([seen, pending]) => !cancelled && setStart({ seen, pending }),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // A storage read, so a frame or two: the canvas colour, not a flash of the wrong screen.
  if (start === null) return <View style={{ flex: 1, backgroundColor: night.bg }} />;
  const { seen, pending } = start;

  return (
    <Stack.Navigator
      initialRouteName={pending ? 'VerifyEmail' : seen ? 'Welcome' : 'Onboarding'}
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: night.bg },
      }}
    >
      <Stack.Screen name="Onboarding" component={OnboardingScreen} />
      <Stack.Screen name="Welcome" component={WelcomeScreen} options={{ animation: 'fade' }} />
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} />
      <Stack.Screen name="VerifyEmail" component={VerifyEmailScreen} initialParams={pending ?? undefined} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
    </Stack.Navigator>
  );
}
