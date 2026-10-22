import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'react-native';
import * as NativeSplash from 'expo-splash-screen';
import { AuthProvider } from './src/lib/auth';
import { DialogProvider } from './src/lib/dialog';
import { ToastHost } from './src/lib/toast';
import { BusyHost } from './src/lib/busy';
import { SubscriptionProvider } from './src/lib/subscription';
import { ThemeProvider, useTheme } from './src/lib/theme';
import { useAppReady } from './src/lib/appReady';
import { ensurePiano } from './src/lib/piano';
import { RootNavigator } from './src/navigation/RootNavigator';
import { SplashScreen } from './src/screens/SplashScreen';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import * as Sentry from '@sentry/react-native';
import { canMaskViews } from './src/lib/replayPrivacy';

Sentry.init({
  dsn: 'https://04ec041914c6c17614d986cd5526edcb@o4508111757770752.ingest.us.sentry.io/4511889593073664',

  // Adds more context data to events (IP address, cookies, user, etc.)
  // For more information, visit: https://docs.sentry.io/platforms/react-native/data-management/data-collected/
  sendDefaultPii: true,

  // Enable Logs
  enableLogs: true,

  // Configure Session Replay
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1,
  // Recordings show the screen as it was, except password fields and Admin (src/lib/replayPrivacy). A build that
  // cannot mask one view keeps blanking everything, as before.
  integrations: [
    Sentry.mobileReplayIntegration({ maskAllText: !canMaskViews, maskAllImages: !canMaskViews, maskAllVectors: !canMaskViews }),
    Sentry.feedbackIntegration(),
  ],

  // uncomment the line below to enable Spotlight (https://spotlightjs.com)
  // spotlight: __DEV__,
});

// Keep the native splash up until fonts are ready; hide is called in useAppReady.
NativeSplash.preventAutoHideAsync().catch(() => undefined);

// Read the piano samples behind the splash, so the first note played is the real piano.
void ensurePiano();

/**
 * App root. The provider order matters: SafeAreaProvider must wrap everything
 * that uses safe-area hooks, and AuthProvider must wrap the navigator that
 * switches on session state. SubscriptionProvider sits inside AuthProvider
 * because it reads the session to decide whose billing state to fetch.
 * ThemeProvider goes outermost because every screen below it reads the active
 * palette.
 */
export default Sentry.wrap(function App() {
  const { ready, splash, season, seasonName } = useAppReady();

  // Hold the branded splash until fonts are loaded and the minimum time has passed.
  if (!ready) return <SplashScreen play={splash} season={season} seasonName={seasonName} />;

  return (
    <ThemeProvider>
      <SafeAreaProvider>
        <AuthProvider>
          <SubscriptionProvider>
            <Themed />
          </SubscriptionProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </ThemeProvider>
  );
});

/**
 * Split out so it sits inside ThemeProvider and can use the hook. The gesture
 * root is painted here rather than in Screen because it is what shows through
 * during navigation transitions.
 */
function Themed() {
  const { palette, mode } = useTheme();
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette.bg }}>
      <StatusBar barStyle={mode === 'dark' ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
      {/* Inside the theme (the dialog is themed) and around the navigator, so a dialog
          paints above whatever screen is mounted and survives navigation. The toast host
          comes after the navigator so a toast paints over the screen and its tab bar. */}
      <DialogProvider>
        <ErrorBoundary>
          <RootNavigator />
        </ErrorBoundary>
        <ToastHost />
        <BusyHost />
      </DialogProvider>
    </GestureHandlerRootView>
  );
}
