import Constants from 'expo-constants';
import { Platform } from 'react-native';

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
 * They are read from config rather than inlined because the three differ per
 * platform and whichever one issues the ID token is also the audience the API
 * validates it against (`Google__ClientId`) — a hardcoded value would have to be
 * changed in two repos to stay in step.
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
 * The client ID that will actually be used on the platform we are running on.
 *
 * Mirrors how `expo-auth-session` resolves it: the platform-specific ID, falling
 * back to the generic one. Checked per platform rather than "any ID is set",
 * because the IDs are issued one platform at a time — an Android-only build
 * would otherwise look configured on iOS and prompt with an ID Google rejects.
 */
const platformClientId =
  (Platform.select({
    ios: googleAuth.iosClientId,
    android: googleAuth.androidClientId,
    default: googleAuth.webClientId,
  }) || googleAuth.webClientId) ?? '';

/**
 * Whether Google sign-in can actually run. The buttons check this and stay
 * hidden when it is false: a visible button that cannot work is worse than an
 * absent one, and every design that shows it also offers email sign-in.
 */
export const googleAuthConfigured = platformClientId !== '';

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
} as const;
