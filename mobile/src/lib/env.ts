import Constants from 'expo-constants';

/**
 * True when running inside the Expo Go sandbox app (as opposed to a dev build,
 * standalone build, or the bare workflow).
 *
 * Expo Go dropped remote-push support in SDK 53: merely importing
 * `expo-notifications` there runs top-level push-token auto-registration that
 * throws. Callers use this flag to skip loading that native module in Expo Go
 * while keeping full push behaviour in development and production builds.
 */
export const isExpoGo = Constants.executionEnvironment === 'storeClient';

const extra = (Constants.expoConfig?.extra ?? {}) as {
  googleIosClientId?: string;
  googleAndroidClientId?: string;
  googleWebClientId?: string;
};

/**
 * Google OAuth client IDs, per platform, from app.json `extra`.
 *
 * They are read from config rather than inlined because whichever client issues
 * the ID token is also the audience the API validates it against
 * (`Google__ClientId`) — a hardcoded value would have to be changed in two repos
 * to stay in step.
 *
 * Only `webClientId` reaches the SDK. On Android that is what the ID token is
 * audienced to; `androidClientId` is Console-side only — Google matches the
 * Android client by package name plus signing SHA-1, never by id. `iosClientId`
 * is empty until a real iOS OAuth client exists (the value that used to sit here
 * was a duplicate of the web one, which is a *web* client and cannot serve iOS).
 *
 * Not secrets: OAuth client IDs for public (installed) apps are designed to be
 * embedded in the shipped binary, which is why they can live in app.json. The
 * client *secret* is what must never appear here, and this flow does not use one.
 */
export const googleAuth = {
  iosClientId: extra.googleIosClientId ?? '',
  androidClientId: extra.googleAndroidClientId ?? '',
  webClientId: extra.googleWebClientId ?? '',
};

/**
 * Whether Google sign-in can actually run. The buttons check this and stay
 * hidden when it is false: a visible button that cannot work is worse than an
 * absent one, and every design that shows it also offers email sign-in.
 *
 * Excludes Expo Go, which is not a configuration problem but a hard limit — the
 * Google SDK is native code and Expo Go cannot load it. Every browser-redirect
 * alternative that would have worked there has been closed off by Google: it
 * rejects `exp://` for any client and has disabled custom URI schemes for Android
 * clients. Use a development build.
 */
export const googleAuthConfigured = !isExpoGo && googleAuth.webClientId !== '';

/**
 * The public marketing site. Inlined rather than read from `extra` because,
 * unlike the Google client IDs, these do not vary by platform or environment:
 * there is one canonical origin and the store listings, the OAuth consent
 * screen, and the policy documents themselves all cite it.
 *
 * `privacy` and `terms` are the same URLs registered with Google Play and the
 * Google Cloud OAuth consent screen, so they must stay in step with
 * `web-site/sitemap.xml`. Both rely on Vercel `cleanUrls`, hence no `.html`.
 */
const SITE_ORIGIN = 'https://notefusion.studio';

export const siteUrls = {
  home: SITE_ORIGIN,
  privacy: `${SITE_ORIGIN}/privacy`,
  terms: `${SITE_ORIGIN}/terms`,
  /** A choir's invite link: the web app signs the singer in (or up) and joins them. */
  choirJoin: (code: string) => `${SITE_ORIGIN}/app?join=${encodeURIComponent(code)}`,
} as const;
