import { AppRegistry } from 'react-native';
import { registerRootComponent } from 'expo';
import App from './App';
import { LISTEN_TAKE_TASK, listenTakeTask } from './src/lib/listenAnywhereBridge';

// A take from "Listen from anywhere" (Android) arrives with no screen open: modules/notefusion-listen's
// ListenTakeHeadlessService starts the JS runtime for it and React Native runs this task, which puts the
// file through the app's own send queue. Registered before the root component, as a headless task must be.
AppRegistry.registerHeadlessTask(LISTEN_TAKE_TASK, () => listenTakeTask);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App)
// and ensures the environment is set up for both Expo Go and native builds.
registerRootComponent(App);
