// Custom Expo config plugin to configure Android R8 full mode, optimized resource shrinking,
// and build performance settings in gradle.properties as recommended by Android documentation.
const { withGradleProperties } = require('@expo/config-plugins');

/** @param {import('@expo/config-plugins').ExpoConfig} config */
module.exports = function withAndroidR8Optimization(config) {
  return withGradleProperties(config, (mod) => {
    const properties = mod.modResults;

    const setProperty = (key, value) => {
      const existing = properties.find((p) => p.type === 'property' && p.key === key);
      if (existing) {
        existing.value = value;
      } else {
        properties.push({ type: 'property', key, value });
      }
    };

    // R8 full mode is disabled because it breaks Firebase and Reanimated due to aggressive tree-shaking of reflective calls.
    // setProperty('android.enableR8.fullMode', 'true');

    // AGP optimized resource shrinking disabled for stability
    // setProperty('android.r8.optimizedResourceShrinking', 'true');

    // Allocate sufficient heap for R8
    setProperty('org.gradle.jvmargs', '-Xmx4096m -XX:MaxMetaspaceSize=1024m');

    return mod;
  });
};
