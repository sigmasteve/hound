import { registerRootComponent } from 'expo';

import App from './App';
import { defineBackgroundSync } from './src/background';
import { registerWidgets } from './src/widgets/registerWidgets';

// The background sync task has to be defined before the app starts, so
// a background wake-up (with no screen open) can find it.
defineBackgroundSync();

// The home screen widgets (src/widgets): Android draws them through the app
// even when it's closed, and iPhone gets their layouts from it.
registerWidgets();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
