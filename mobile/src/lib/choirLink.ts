import { useEffect, useState } from 'react';
import { Linking } from 'react-native';
import { navigationRef } from './notificationLink';
import { choirCodeFromUrl } from './choirCode';

/**
 * notefusion://join/CODE — a choir director's invite opened on a phone with the app. Routes to
 * the My choir screen with the code filled in, held until the signed-in stack exists (a singer
 * who has no account yet signs up first and lands there after), like `useListenDeepLink`.
 *
 * It never joins by itself: any page can open a notefusion:// link, and joining a choir is a
 * choice (an account sings in one). The screen shows the code and the singer taps Join.
 *
 * The website's https invite links open the website, which joins there; the app has no
 * verified https links (no Android App Links or iOS associated domains are configured).
 */
export function useChoirDeepLink(ready: boolean): void {
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    Linking.getInitialURL()
      .then((url) => {
        const code = choirCodeFromUrl(url);
        if (code) setPending(code);
      })
      .catch(() => undefined);
    const sub = Linking.addEventListener('url', ({ url }) => {
      const code = choirCodeFromUrl(url);
      if (code) setPending(code);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!ready || !pending || !navigationRef.isReady()) return;
    const code = pending;
    setPending(null);
    navigationRef.navigate('Choir', { code });
  }, [ready, pending]);
}
