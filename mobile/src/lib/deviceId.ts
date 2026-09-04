import { Platform } from 'react-native';
import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';

/**
 * Which handset this is, for the free-trial ceiling.
 *
 * ── Why the app sends this at all ─────────────────────────────────────────────
 * The five free transcriptions used to be counted per *account*. Adding a second
 * Google account to an Android phone is four taps, so the free tier was effectively
 * unlimited for anyone who noticed. The server now shares the five across every
 * account seen on one device, and this is the value it keys that on.
 *
 * It is a claim, not an attestation: anyone who unpacks the APK can forge the header.
 * That is accepted — the point is to raise farming from four taps to reverse
 * engineering. Play Integrity is the real answer and is a much larger lift.
 *
 * ── Why these ids ────────────────────────────────────────────────────────────
 * Android's SSAID is scoped to (app signing key, device, Android user) and, crucially,
 * is *unchanged* when a Google account is added or switched — which is exactly the
 * hole being closed. It survives reinstalls and clearing app data; only a factory
 * reset or a new Android user profile mints a new one.
 *
 * iOS has no equivalent, so IDFV stands in: stable while any app from this vendor is
 * installed. Removing every one of them resets it, which is a fresh allowance — an
 * accepted limit, and far more work than four taps.
 *
 * ── Why the fallback lives in SecureStore ────────────────────────────────────
 * Neither id is guaranteed: SSAID can be null on a badly-behaved ROM, IDFV is null
 * before the device is unlocked once. A locally-minted id at least holds for as long
 * as the install does. Its key must **not** be cleared on sign-out — see the note in
 * `tokenStore.ts`, since signing out to farm the trial is the whole attack.
 */

const DEVICE_KEY = 'nf.deviceId';

/**
 * Held for the process. Every request asks for this, and a keystore read per request
 * would put a native round trip in front of the whole API surface.
 */
let cached: string | null = null;
let inFlight: Promise<string | null> | null = null;

/**
 * The id, or null when this platform has none and nothing could be minted. Never rejects — the
 * request interceptor calls it in front of every API call, so a throw here would take the whole
 * app offline, and a device we cannot name is only a fall back to the per-account count.
 */
export function getDeviceId(): Promise<string | null> {
  if (cached) return Promise.resolve(cached);
  if (!inFlight) {
    inFlight = resolve()
      .then((id) => {
        cached = id;
        return id;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

async function resolve(): Promise<string | null> {
  try {
    if (Platform.OS === 'android') {
      const ssaid = Application.getAndroidId();
      // Rejected on purpose: this constant was the SSAID every pre-Froyo emulator and a
      // notorious batch of Chinese ROMs reported, so it identifies a crowd, not a phone.
      if (ssaid && ssaid !== '9774d56d682e549c') return ssaid;
    } else if (Platform.OS === 'ios') {
      const idfv = await Application.getIosIdForVendorAsync();
      if (idfv) return idfv;
    }
  } catch {
    // A missing native module (web, or a bare JS test) is not worth failing a request over.
  }

  return locallyMinted();
}

/**
 * The last resort: an id this install invents once and keeps. Not random enough to be
 * a secret, and it does not need to be — it is compared only against itself, and the
 * server hashes whatever arrives.
 */
async function locallyMinted(): Promise<string | null> {
  try {
    const stored = await SecureStore.getItemAsync(DEVICE_KEY);
    if (stored) return stored;

    const minted = `local-${Date.now().toString(36)}-${rand()}${rand()}${rand()}`;
    await SecureStore.setItemAsync(DEVICE_KEY, minted);
    return minted;
  } catch {
    // No keystore at all. Sending nothing falls the server back to its per-account
    // count, which is the behaviour before this feature existed.
    return null;
  }
}

function rand(): string {
  return Math.random().toString(36).slice(2, 10);
}
