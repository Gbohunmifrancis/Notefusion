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
