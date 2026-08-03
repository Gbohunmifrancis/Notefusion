import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from './src/lib/auth';
import { RootNavigator } from './src/navigation/RootNavigator';
import { colors } from './src/design/theme';

/**
 * App root. The provider order matters: SafeAreaProvider must wrap everything
 * that uses safe-area hooks, and AuthProvider must wrap the navigator that
 * switches on session state.
 */
export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="light" />
          <RootNavigator />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
