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

    // Enable R8 full mode for aggressive method inlining, class merging, and tree-shaking
    setProperty('android.enableR8.fullMode', 'true');

    // Enable AGP optimized resource shrinking (unifies code and resource reference graphs)
    setProperty('android.r8.optimizedResourceShrinking', 'true');

    // Allocate sufficient heap for R8 full-program optimization
    setProperty('org.gradle.jvmargs', '-Xmx4096m -XX:MaxMetaspaceSize=1024m');

    return mod;
  });
};
