import { Platform } from 'react-native';
import { APP_VERSION } from '../lib/appVersion';
import { compareVersions } from '../updates/versionGate';

// Whether this phone's build has the 1.1.0 Health permissions (issue
// #494): Health Connect's hydration and sleep reads on Android. Older
// Android builds don't declare them, so they can't be asked for there.
// iPhone asks for Health types at run time, so it always can.
export const HAS_HEALTH_1_1 =
  Platform.OS !== 'android' || APP_VERSION === 'unknown' || compareVersions(APP_VERSION, '1.1.0') >= 0;
