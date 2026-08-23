import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { UpdatePrompt } from '../src/components/UpdatePrompt';
import { useColors } from '../src/theme/theme';
import { useSettingsStore } from '../src/store/settingsStore';
import { useLaunchUpdate } from '../src/sync/useLaunchUpdate';
import { useSilentLevelSync } from '../src/sync/useSilentLevelSync';

function useHiddenAndroidNavBar() {
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const bar = requireOptionalNativeModule<{ setHidden?: (hidden: boolean) => void }>(
      'ExpoNavigationBar',
    );
    bar?.setHidden?.(true);
  }, []);
}

export default function RootLayout() {
  const hydrateSettings = useSettingsStore((state) => state.hydrate);
  const darkMode = useSettingsStore((state) => state.darkMode);
  const colors = useColors();
  const { phase, apply, dismiss } = useLaunchUpdate();
  useSilentLevelSync();
  useHiddenAndroidNavBar();

  useEffect(() => {
    void hydrateSettings();
  }, [hydrateSettings]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style={darkMode ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
            animation: 'fade',
          }}
        />
        <UpdatePrompt phase={phase} onUpdate={() => void apply()} onLater={dismiss} />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
