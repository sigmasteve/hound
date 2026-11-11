// Hound's Apple Watch app (0.12.0): goals, water and the streak on the
// wrist. It links to an account with a code (0189_apple_watch.sql) and
// talks to Hound's server itself, so the phone app needn't be running.
//
// HoundConfig.swift is written here from the build's environment, so a
// Hound Staging build's watch talks to staging. Production is the default
// it ships with.
const fs = require('fs');
const path = require('path');

/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (url && key) {
    fs.writeFileSync(
      path.join(__dirname, 'HoundConfig.swift'),
      `// Written by expo-target.config.js from the build's environment.\nenum HoundConfig {\n  static let apiURL = "${url}"\n  static let apiKey = "${key}"\n}\n`,
    );
  }
  return {
    type: 'watch',
    name: 'HoundWatch',
    displayName: 'Hound',
    bundleIdentifier: '.watchkitapp',
    deploymentTarget: '10.0',
    icon: '../../assets/icon.png',
    colors: { $accent: '#9184d9' },
    frameworks: ['SwiftUI', 'HealthKit', 'WidgetKit'],
    entitlements: {
      'com.apple.developer.healthkit': true,
      'com.apple.developer.healthkit.access': [],
      'com.apple.security.application-groups': [`group.${config.ios.bundleIdentifier}.watch`],
    },
  };
};
