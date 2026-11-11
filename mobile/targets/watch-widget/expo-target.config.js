// Hound's watch-face complications: steps, water, and today's goals. They
// read what the watch app last saved (targets/watch/Snapshot.swift), and
// read steps from Health themselves so the steps one stays current.
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'watch-widget',
  name: 'HoundComplications',
  displayName: 'Hound',
  bundleIdentifier: '.watchkitapp.complications',
  deploymentTarget: '10.0',
  colors: { $accent: '#9184d9' },
  frameworks: ['SwiftUI', 'WidgetKit', 'HealthKit'],
  entitlements: {
    'com.apple.developer.healthkit': true,
    'com.apple.developer.healthkit.access': [],
    'com.apple.security.application-groups': [`group.${config.ios.bundleIdentifier}.watch`],
  },
});
