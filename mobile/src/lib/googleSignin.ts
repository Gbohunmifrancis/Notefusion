import { googleAuth, isExpoGo } from './env';

/**
 * The Google consent prompt, via the native Google Sign-In SDK.
 *
 * `@react-native-google-signin/google-signin` is imported lazily (via require)
 * rather than at the top of the module, for the same reason `push.ts` defers
 * `expo-notifications`: it is native code, so merely loading it in Expo Go throws.
 * `googleAuthConfigured` in `env.ts` keeps the buttons — and therefore this
 * module — out of Expo Go entirely.
 *
 * ── Why not expo-auth-session ──────────────────────────────────────────────────
 * The browser-redirect flow it implements has no working configuration on Android:
 * Google rejects `auth.expo.io` for an Android client (`redirect_uri_mismatch`),
 * rejects `exp://` for any client, and has disabled custom URI schemes for Android
 * clients outright. The `auth.expo.io` proxy that used to bridge that gap needs a
 * `/start` handshake, and nothing in expo-auth-session 56 performs it any more —
 * which is why the flow used to hang on a blank proxy page instead of returning.
 */

type GoogleSigninSdk = typeof import('@react-native-google-signin/google-signin');

/**
 * The loaded SDK, or null before first use. Doubles as the "configure() has run"
 * flag: `configure` is synchronous and the module caches its promise internally,
 * so one call at load time is enough for every later `signIn`.
 */
let sdk: GoogleSigninSdk | null = null;

function load(): GoogleSigninSdk {
  if (!sdk) {
    const loaded = require('@react-native-google-signin/google-signin') as GoogleSigninSdk;
    // Only the *web* client ID is passed: on Android it is what the returned ID
    // token is audienced to (matching the API's `Google__ClientId`), and the
    // Android client is matched by package name + signing SHA-1 rather than by id.
    loaded.GoogleSignin.configure({ webClientId: googleAuth.webClientId });
    sdk = loaded;
  }
  return sdk;
}

/** Android's DEVELOPER_ERROR (CommonStatusCodes.DEVELOPER_ERROR), surfaced as a string code. */
const DEVELOPER_ERROR = '10';

interface Options {
  /**
   * Show the account chooser even when a Google account is already signed in.
   *
   * Needed for re-auth before a destructive action: the SDK otherwise returns the
   * cached account without any prompt at all. It re-proves *which* account, not the
   * password — the same guarantee expo-auth-session's `selectAccount` gave.
   */
  forceAccountPicker?: boolean;
}

/**
 * Runs the Google consent prompt and returns a fresh ID token, or null if the user
 * backed out. Backing out is a choice, not an error, so it does not throw.
 */
export async function getGoogleIdToken(opts: Options = {}): Promise<string | null> {
  if (isExpoGo) {
    throw new Error('Google sign-in needs a development build; Expo Go cannot load native code.');
  }

  const { GoogleSignin, isSuccessResponse, isErrorWithCode } = load();

  if (opts.forceAccountPicker) {
    // Clears the SDK's cached account only. Our own session lives in tokenStore
    // and is untouched, so this cannot log the user out of NoteFusion.
    await GoogleSignin.signOut().catch(() => undefined);
  }

  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

    // The only other arm of the response union is `cancelled` — the SDK translates
    // a dismissed prompt into that rather than throwing.
    const res = await GoogleSignin.signIn();
    if (!isSuccessResponse(res)) return null;

    // `User.idToken` is nullable; `getTokens()` is not, and is the documented way
    // to get one, so it is the fallback rather than an error.
    const idToken = res.data.idToken ?? (await GoogleSignin.getTokens()).idToken;
    if (!idToken) throw new Error('Google did not return an ID token.');
    return idToken;
  } catch (e) {
    if (isErrorWithCode(e) && e.code === DEVELOPER_ERROR) {
      // The one misconfiguration this will hit first, and the raw message is a
      // bare link to a troubleshooting page. Name the actual cause instead.
      throw new Error(
        "This build's signing certificate is not registered with Google. " +
          'Add its SHA-1 fingerprint to the Android OAuth client.',
      );
    }
    throw e;
  }
}
