import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from './src/lib/auth';
import { ThemeProvider, useTheme } from './src/lib/theme';
import { RootNavigator } from './src/navigation/RootNavigator';

/**
 * App root. The provider order matters: SafeAreaProvider must wrap everything
 * that uses safe-area hooks, and AuthProvider must wrap the navigator that
 * switches on session state. ThemeProvider goes outermost because every screen
 * below it reads the active palette.
 */
export default function App() {
  return (
    <ThemeProvider>
      <SafeAreaProvider>
        <AuthProvider>
          <Themed />
        </AuthProvider>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}

/**
 * Split out so it sits inside ThemeProvider and can use the hook. The gesture
 * root is painted here rather than in Screen because it is what shows through
 * during navigation transitions.
 */
function Themed() {
  const { palette, mode } = useTheme();
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette.bg }}>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <RootNavigator />
    </GestureHandlerRootView>
  );
}
