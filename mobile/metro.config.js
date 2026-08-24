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

// The engraver ships as one inlined HTML document (scripts/build-engraver.mjs).
// Metro has no default handling for .html, so declare it an asset — that is what
// lets `require("../../assets/engraver/index.html")` resolve to a bundled file
// the app can read at runtime instead of something Metro tries to parse as JS.
config.resolver.assetExts = [...config.resolver.assetExts, "html"];

module.exports = config;
