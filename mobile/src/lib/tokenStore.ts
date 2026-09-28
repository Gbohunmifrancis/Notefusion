import * as SecureStore from 'expo-secure-store';
import type { AuthUser } from '../api/types';

/**
 * Token vault. Access + refresh tokens live in the OS keychain/keystore via
 * expo-secure-store (never AsyncStorage — these are bearer credentials). The
 * cached user summary is non-sensitive UI data, so it can sit in secure store too
 * for simplicity and to survive cold starts.
 */

const ACCESS_KEY = 'nf.accessToken';
const REFRESH_KEY = 'nf.refreshToken';
const USER_KEY = 'nf.user';

export const tokenStore = {
  async save(accessToken: string, refreshToken: string): Promise<void> {
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_KEY, accessToken),
      SecureStore.setItemAsync(REFRESH_KEY, refreshToken),
    ]);
  },

  async getAccess(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(ACCESS_KEY);
    } catch {
      return null;
    }
  },

  async getRefresh(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(REFRESH_KEY);
    } catch {
      return null;
    }
  },

  async saveUser(user: AuthUser): Promise<void> {
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
  },

  async getUser(): Promise<AuthUser | null> {
    try {
      const raw = await SecureStore.getItemAsync(USER_KEY);
      return raw ? (JSON.parse(raw) as AuthUser) : null;
    } catch {
      return null;
    }
  },

  async saveLastAuthMethod(method: 'google' | 'email'): Promise<void> {
    await SecureStore.setItemAsync('nf.lastAuthMethod', method);
  },

  async getLastAuthMethod(): Promise<'google' | 'email' | null> {
    const val = await SecureStore.getItemAsync('nf.lastAuthMethod');
    return val === 'google' || val === 'email' ? val : null;
  },

  async clear(): Promise<void> {
    // Credentials only. `nf.deviceId` (see lib/deviceId.ts) is deliberately not here: signing out
    // to add a second Google account is the exact move the free-trial ceiling exists to catch, and
    // minting a new device id on the way out would hand back the five it just spent.
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_KEY),
      SecureStore.deleteItemAsync(REFRESH_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
    ]);
  },
};
