import { registerRootComponent } from 'expo';

import App from './App';
import { defineBackgroundSync } from './src/background';

// The background sync task has to be defined before the app starts, so
// a background wake-up (with no screen open) can find it.
defineBackgroundSync();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
