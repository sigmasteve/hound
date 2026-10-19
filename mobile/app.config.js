// Which app this build is. app.json is the real Hound app and is used
// exactly as written unless APP_VARIANT=staging.
//
// APP_VARIANT=staging is set by the `staging` build profile in eas.json and
// by `npm run update:staging`. It makes "Hound Staging": the same app,
// pointed at the staging Supabase project (through the preview
// environment's variables), with its own bundle ID / package and URL
// scheme so it installs next to the real Hound on the same phone and
// sign-in redirects never open the wrong app.
//
// Google Sign-In on iOS is tied to the bundle ID. Until staging has its own
// iOS OAuth client (set GOOGLE_IOS_URL_SCHEME_STAGING and the preview
// environment's EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID to it), use email sign-in
// in Hound Staging.

//
// Android push needs Firebase's google-services.json (README "Android push
// notifications (FCM credentials)"). EAS builds get it from the
// GOOGLE_SERVICES_JSON file variable; a local build uses
// mobile/google-services.json. With neither, it's left out so the build
// still works and Android push says it isn't ready yet.

const fs = require('fs');
const path = require('path');

const STAGING_ID = 'app.hound.mobile.staging';

function googleServicesFile() {
  if (process.env.GOOGLE_SERVICES_JSON) return process.env.GOOGLE_SERVICES_JSON;
  if (fs.existsSync(path.join(__dirname, 'google-services.json'))) return './google-services.json';
  return undefined;
}

module.exports = ({ config: base }) => {
  const firebase = googleServicesFile();
  const config = firebase ? { ...base, android: { ...base.android, googleServicesFile: firebase } } : base;
  if (process.env.APP_VARIANT !== 'staging') return config;

  const googleScheme = process.env.GOOGLE_IOS_URL_SCHEME_STAGING;
  const plugins = (config.plugins ?? []).map((plugin) =>
    googleScheme && Array.isArray(plugin) && plugin[0] === '@react-native-google-signin/google-signin'
      ? [plugin[0], { ...plugin[1], iosUrlScheme: googleScheme }]
      : plugin,
  );

  return {
    ...config,
    name: 'Hound Staging',
    scheme: 'hound-staging',
    ios: { ...config.ios, bundleIdentifier: STAGING_ID },
    android: { ...config.android, package: STAGING_ID },
    plugins,
  };
};
