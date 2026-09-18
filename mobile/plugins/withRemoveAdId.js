// Custom Expo config plugin to strip the AD_ID permission that transitive
// dependencies (expo-notifications, Firebase) add automatically.
// NoteFusion does not serve ads, so the Play Console declaration says
// "does not use advertising ID" — having the permission in the manifest
// causes Google Play to reject the upload with an AD_ID declaration mismatch.
//
// The merge rule (tools:node="remove") is processed by Android's manifest
// merger at build time, so the permission never reaches the final APK/AAB.
const { withAndroidManifest } = require('@expo/config-plugins');

/** @param {import('@expo/config-plugins').ExpoConfig} config */
module.exports = function withRemoveAdId(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults;

    // Ensure the tools namespace is declared on the root <manifest> element.
    // Without it the merger silently ignores all tools: attributes.
    if (!manifest.manifest.$) {
      manifest.manifest.$ = {};
    }
    manifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';

    // Remove the AD_ID permission if already present (idempotent).
    const permissions = manifest.manifest['uses-permission'] ?? [];
    manifest.manifest['uses-permission'] = permissions.filter(
      (p) =>
        p.$?.['android:name'] !== 'com.google.android.gms.permission.AD_ID',
    );

    // Add the removal merge rule so the manifest merger strips any copy
    // injected by a library AAR that runs after our plugin.
    manifest.manifest['uses-permission'].push({
      $: {
        'android:name': 'com.google.android.gms.permission.AD_ID',
        'tools:node': 'remove',
      },
    });

    return mod;
  });
};
