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
    return SecureStore.getItemAsync(ACCESS_KEY);
  },

  async getRefresh(): Promise<string | null> {
    return SecureStore.getItemAsync(REFRESH_KEY);
  },

  async saveUser(user: AuthUser): Promise<void> {
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
  },

  async getUser(): Promise<AuthUser | null> {
    const raw = await SecureStore.getItemAsync(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  },

  async clear(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_KEY),
      SecureStore.deleteItemAsync(REFRESH_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
    ]);
  },
};
