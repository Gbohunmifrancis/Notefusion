// Custom Expo config plugin that keeps the payment chime (res/raw/payment, from expo-notifications' `sounds`) in
// release builds. The chime is only ever named by a string in the JS bundle ("payment.wav"), never as R.raw.payment in
// compiled code, so enableShrinkResourcesInReleaseBuilds treated it as unused and stripped it: Android then created
// the payments channel with the phone's default sound, and a channel's sound never changes. A keep.xml beside the
// sound tells the resource shrinker to leave it (https://developer.android.com/build/shrink-code#keep-resources).
// The channels made by a build with it are `payments-v2-…` (lib/paymentAlerts SOUND_KEPT_FROM_BUILD).
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

const KEEP_XML = `<?xml version="1.0" encoding="utf-8"?>
<resources xmlns:tools="http://schemas.android.com/tools"
    tools:keep="@raw/payment" />
`;

/** @param {import('@expo/config-plugins').ExpoConfig} config */
module.exports = function withKeepPaymentSound(config) {
  return withDangerousMod(config, [
    'android',
    async (mod) => {
      const raw = path.join(mod.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'raw');
      fs.mkdirSync(raw, { recursive: true });
      fs.writeFileSync(path.join(raw, 'keep.xml'), KEEP_XML);
      return mod;
    },
  ]);
};
