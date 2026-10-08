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
import { night } from '../design/theme';
import type { AuthStackParams } from './types';

const Stack = createNativeStackNavigator<AuthStackParams>();

/**
 * Unauthenticated flow: the intro cards (first time only) → Welcome → sign in or
 * create an account → the email code. Every screen here is on the night canvas,
 * which is also what shows between screens during a transition.
 */
export function AuthNavigator() {
  const [seen, setSeen] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    onboarding.seen().then((s) => !cancelled && setSeen(s));
    return () => {
      cancelled = true;
    };
  }, []);

  // A storage read, so a frame or two: the canvas colour, not a flash of the wrong screen.
  if (seen === null) return <View style={{ flex: 1, backgroundColor: night.bg }} />;

  return (
    <Stack.Navigator
      initialRouteName={seen ? 'Welcome' : 'Onboarding'}
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
      <Stack.Screen name="VerifyEmail" component={VerifyEmailScreen} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
    </Stack.Navigator>
  );
}
