import Constants from 'expo-constants';

/**
 * Testing shortcuts (catalog sync button, unlock-all, ending sandbox, HUD skip)
 * stay on Metro / Expo Go. Release and preview binaries hide them.
 */
export const SHOW_DEV_TOOLS = Boolean(
  __DEV__ || Constants.appOwnership === 'expo',
);
