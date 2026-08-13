const { getSentryExpoConfig } = require("@sentry/react-native/metro");

const config = getSentryExpoConfig(__dirname);

// Sentry's reactnativeerrorhandlersutils requires promise/setimmediate/done
// and promise/setimmediate/finally. These subpath exports were removed in
// promise@8.2+. Pin to 8.1.3 in package.json and alias here as a safety net.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  "promise/setimmediate/done": require.resolve("promise/setimmediate/done"),
  "promise/setimmediate/finally": require.resolve(
    "promise/setimmediate/finally"
  ),
};

module.exports = config;
