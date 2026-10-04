import { useEffect, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { navigationRef } from './notificationLink';

/**
 * notefusion://listen?src=tile|widget|notification — what the Quick Settings tile, the home-screen
 * widget and the listening notification open.
 *
 * A regex, not `new URL()`: React Native's URL polyfill does not implement `host` for custom schemes.
 * Only `listen` matches, so `notefusion://billing/return` (consumed by WebBrowser.openAuthSessionAsync
 * on the Upgrade screen) is never touched.
 */
export function isListenUrl(url: string | null | undefined): boolean {
  return !!url && /^notefusion:\/\/\/?listen(?:[/?#]|$)/i.test(url);
}

/**
 * Routes a shortcut tap to the Listen screen with `autoStart`. Held until the authenticated stack
 * exists, like a notification tap, and auto-starts only while the app is on screen: the microphone
 * foreground service may only start under a visible activity (Android 14+), and a cold start that the
 * user leaves within a second or two would otherwise be refused by the system.
 */
export function useListenDeepLink(ready: boolean): void {
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    Linking.getInitialURL()
      .then((url) => {
        if (isListenUrl(url)) setPending(url);
      })
      .catch(() => undefined);
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (isListenUrl(url)) setPending(url);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!ready || !pending || !navigationRef.isReady()) return;
    setPending(null);
    navigationRef.navigate('Listen', { autoStart: AppState.currentState === 'active' });
  }, [ready, pending]);
}
