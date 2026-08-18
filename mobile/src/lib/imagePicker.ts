import { Alert, Linking } from 'react-native';

/**
 * Profile-photo picking, isolated behind one function.
 *
 * `expo-image-picker` is required lazily for the same reason `push.ts` defers
 * `expo-notifications`: it is a native module, so an older binary that predates it
 * would crash on import at app start rather than merely failing at the tap. Here the
 * failure is contained to this call and reported honestly.
 */

export interface PickedImage {
  uri: string;
  fileName: string;
  mimeType: string;
}

/**
 * Opens the photo library and returns the chosen image, or null if the user
 * cancelled, refused permission, or this build cannot pick images. Explains
 * itself in each of those cases — the caller only has to handle null.
 */
export async function pickProfileImage(): Promise<PickedImage | null> {
  let ImagePicker: typeof import('expo-image-picker');
  try {
    ImagePicker = require('expo-image-picker') as typeof import('expo-image-picker');
  } catch {
    Alert.alert(
      'Not available in this build',
      'Choosing a photo needs a newer version of the app. Please update to continue.',
    );
    return null;
  }

  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    // canAskAgain false means the OS will no longer show the prompt, so pointing
    // at Settings is the only actionable advice.
    if (permission.canAskAgain) return null;
    Alert.alert(
      'Photo access blocked',
      'Allow photo access in system settings to choose a profile picture.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ],
    );
    return null;
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1], // The avatar is a circle; crop to square before uploading.
    quality: 0.8,
    // Downscale on the device rather than shipping a 12 MP original over mobile
    // data — the avatar renders at ~104pt, and the API caps the upload at 5 MB.
    exif: false,
  });

  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0];
  const mimeType = asset.mimeType ?? 'image/jpeg';
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';

  return {
    uri: asset.uri,
    fileName: asset.fileName ?? `avatar.${extension}`,
    mimeType,
  };
}
