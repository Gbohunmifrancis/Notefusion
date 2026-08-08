import { Platform } from 'react-native';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { devicesApi } from '../api/endpoints';
import { isExpoGo } from './env';

/**
 * Expo push registration. Asks for permission, gets the Expo push token, and
 * registers it with the C# API (which stores it and later fans out a push when a
 * transcription job finishes). Entirely best-effort: a denied permission or a
 * simulator (no push hardware) just returns null without throwing.
 *
 * `expo-notifications` is imported lazily (via require) rather than at the top of
 * the module: in Expo Go (SDK 53+) importing it runs push-token auto-registration
 * that throws, so on Expo Go we skip loading it entirely. Push works normally in
 * dev/production builds.
 */

// Foreground presentation: show a banner even while the app is open. Installed
// once at module load, but only outside Expo Go.
if (!isExpoGo) {
  const Notifications = require('expo-notifications') as typeof import('expo-notifications');
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export async function registerForPushAsync(): Promise<string | null> {
  if (isExpoGo) return null; // Remote push unsupported in Expo Go (SDK 53+).
  if (!Device.isDevice) return null; // Push tokens need real hardware.

  const Notifications = require('expo-notifications') as typeof import('expo-notifications');

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Transcriptions',
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: '#2563EB',
    });
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

  const tokenResponse = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );
  const token = tokenResponse.data;

  const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
  await devicesApi.register(token, platform).catch(() => undefined);

  return token;
}
