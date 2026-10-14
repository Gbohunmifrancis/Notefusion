import { useEffect, useState } from 'react';
import { Linking } from 'react-native';
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
 * Routes a shortcut tap to the Listen screen. Held until the authenticated stack exists, like a
 * notification tap.
 *
 * It never starts the microphone: any app or web page can open notefusion://listen, and the
 * `src` the tile, widget and notification add is just as forgeable, so a link cannot tell a real
 * shortcut from an imitation without native help. The screen opens and the user taps Start.
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
    navigationRef.navigate('Listen');
  }, [ready, pending]);
}
