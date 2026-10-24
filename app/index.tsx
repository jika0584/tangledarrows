import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MenuButton } from '../src/components/MenuButton';
import { SettingsMenu } from '../src/components/SettingsMenu';
import { SHOW_DEV_TOOLS } from '../src/dev/flags';
import { useProgressStore } from '../src/store/progressStore';
import { formatCatalogDate, useCatalogStamp } from '../src/store/catalogStamp';
import { isResumable, loadRunCache, RunCache } from '../src/store/runCache';
import { LevelRepository } from '../src/sync/LevelRepository';
import { DEMO_ENDING_LEVEL } from '../src/levels/demoEnding';
import { MIN_TOUCH_TARGET, spacing, typography, useColors } from '../src/theme/theme';

export default function MainMenuScreen() {
  const router = useRouter();
  const colors = useColors();
  const { hydrated, hydrate, currentCuratedLevel, currentSLevelIndex, catchUpCampaignIfNeeded } =
    useProgressStore();
  const catalogUpdatedAt = useCatalogStamp((state) => state.updatedAt);
  const highestCampaign = useCatalogStamp((state) => state.highestCampaign);
  const insets = useSafeAreaInsets();
  const [runCache, setRunCache] = useState<RunCache | null | undefined>(undefined);
  const [checking, setChecking] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    void loadRunCache().then(setRunCache);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (runCache === undefined) return;
      const unfinishedEndlessRun = isResumable(runCache) && runCache.levelId.startsWith('S');
      void catchUpCampaignIfNeeded({ unfinishedEndlessRun });
    }, [catchUpCampaignIfNeeded, runCache, highestCampaign]),
  );

  const checkForUpdates = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    try {
      await LevelRepository.syncNow(currentCuratedLevel);
    } finally {
      setChecking(false);
    }
  }, [checking, currentCuratedLevel]);

  const resumeLabel = !hydrated
    ? undefined
    : currentCuratedLevel !== null
      ? `Level ${currentCuratedLevel}`
      : `Endless ${currentSLevelIndex}`;

  const expectedId =
    currentCuratedLevel !== null ? String(currentCuratedLevel) : `S${currentSLevelIndex}`;
  const caption =
    resumeLabel && isResumable(runCache) && runCache.levelId === expectedId
      ? `Resume ${resumeLabel}`
      : resumeLabel;

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.background }]}
      edges={['top', 'left', 'right']}
    >
      <View style={styles.topBar}>
        {SHOW_DEV_TOOLS ? (
          <Pressable
            onPress={() => void checkForUpdates()}
            disabled={checking}
            accessibilityRole="button"
            accessibilityLabel="Check for new puzzles"
            hitSlop={12}
            style={({ pressed }) => [
              styles.iconButton,
              { backgroundColor: colors.surface },
              pressed && styles.iconPressed,
            ]}
          >
            {checking ? (
              <ActivityIndicator size="small" color={colors.arrow} />
            ) : (
              <Text style={[styles.iconGlyph, { color: colors.textPrimary }]}>↻</Text>
            )}
          </Pressable>
        ) : (
          <View style={styles.iconSpacer} />
        )}
        <Pressable
          onPress={() => setSettingsOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          hitSlop={12}
          style={({ pressed }) => [
            styles.iconButton,
            { backgroundColor: colors.surface },
            pressed && styles.iconPressed,
          ]}
        >
          <Text style={[styles.iconGlyph, { color: colors.textPrimary }]}>⚙</Text>
        </Pressable>
      </View>

      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.textPrimary }]} accessibilityRole="header">
          TANGLED
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>ARROWS</Text>
      </View>

      <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, spacing.xl) }]}>
        <MenuButton
          label="Start"
          caption={caption}
          variant="primary"
          onPress={() => router.push('/game')}
        />
        {SHOW_DEV_TOOLS ? (
          <View style={styles.row}>
            <MenuButton compact label="Choose level" onPress={() => router.push('/stages')} />
            <MenuButton
              compact
              label="Test ending"
              caption={`${DEMO_ENDING_LEVEL.arrows.length} arrows`}
              onPress={() => router.push('/game?sandbox=ending')}
            />
          </View>
        ) : (
          <MenuButton label="Choose level" onPress={() => router.push('/stages')} />
        )}
        {catalogUpdatedAt != null && (
          <Text style={[styles.stamp, { color: colors.textSecondary }]} accessibilityRole="text">
            Updated {formatCatalogDate(catalogUpdatedAt)}
          </Text>
        )}
      </View>

      <SettingsMenu
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onChangeLevel={() => {
          setSettingsOpen(false);
          router.push('/stages');
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
  },
  iconSpacer: {
    flex: 1,
  },
  iconButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: MIN_TOUCH_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPressed: {
    opacity: 0.6,
  },
  iconGlyph: {
    fontSize: 24,
  },
  header: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    fontSize: 52,
    fontWeight: '800',
    letterSpacing: 4,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.title,
    letterSpacing: 10,
    textAlign: 'center',
  },
  actions: {
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  stamp: {
    ...typography.label,
    textAlign: 'center',
    marginTop: spacing.sm,
    opacity: 0.8,
  },
});
