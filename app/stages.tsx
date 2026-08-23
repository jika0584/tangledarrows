import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MenuButton } from '../src/components/MenuButton';
import { SHOW_DEV_TOOLS } from '../src/dev/flags';
import { LAST_CURATED_LEVEL } from '../src/procedural/CuratedGenerator';
import { LevelRepository } from '../src/sync/LevelRepository';
import { useProgressStore } from '../src/store/progressStore';
import { MIN_TOUCH_TARGET, spacing, typography, useColors } from '../src/theme/theme';

const COLS = 5;
const GAP = 8;

export default function StagePickerScreen() {
  const router = useRouter();
  const colors = useColors();
  const {
    hydrated,
    hydrate,
    clearedCuratedLevels,
    currentSLevelIndex,
    selectCuratedLevel,
    selectEndlessLevel,
  } = useProgressStore();
  const [highestKnown, setHighestKnown] = useState(1);
  const [gridWidth, setGridWidth] = useState(0);
  const [syncing, setSyncing] = useState(true);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const refreshCatalog = useCallback(async () => {
    setSyncing(true);
    setStatus(null);
    try {
      const { highest, error } = await LevelRepository.syncFullCatalog();
      setHighestKnown(Math.max(1, highest ?? 0));
      if (error) setStatus(error);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not load cloud levels.');
    } finally {
      setSyncing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshCatalog();
    }, [refreshCatalog]),
  );

  const lastShown = Math.min(LAST_CURATED_LEVEL, highestKnown);
  const levels = useMemo(
    () => Array.from({ length: lastShown }, (_, i) => i + 1),
    [lastShown],
  );

  const tileSize =
    gridWidth > 0 ? Math.floor((gridWidth - GAP * (COLS - 1)) / COLS) : MIN_TOUCH_TARGET;

  const play = async (levelNumber: number) => {
    await selectCuratedLevel(levelNumber);
    router.replace('/game');
  };

  const playEndless = async () => {
    await selectEndlessLevel(currentSLevelIndex);
    router.replace('/game');
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={16}
          style={({ pressed }) => [
            styles.back,
            { backgroundColor: colors.surface },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.backGlyph, { color: colors.textPrimary }]}>←</Text>
        </Pressable>
        <Text style={[styles.title, { color: colors.textPrimary }]} accessibilityRole="header">
          Choose level
        </Text>
        {syncing && <ActivityIndicator size="small" color={colors.arrow} />}
      </View>
      {SHOW_DEV_TOOLS && status ? (
        <Text style={[styles.status, { color: colors.arrowBlocked }]}>{status}</Text>
      ) : null}

      <ScrollView style={styles.scroller} contentContainerStyle={styles.content}>
        <View
          style={styles.grid}
          onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}
        >
          {hydrated &&
            levels.map((levelNumber, index) => {
              const col = index % COLS;
              const row = Math.floor(index / COLS);
              const completed = levelNumber <= clearedCuratedLevels;
              const unlocked = SHOW_DEV_TOOLS || levelNumber <= clearedCuratedLevels + 1;
              const checkerDark = (row + col) % 2 === 1;

              return (
                <LevelTile
                  key={levelNumber}
                  levelNumber={levelNumber}
                  size={tileSize}
                  completed={completed}
                  unlocked={unlocked}
                  checkerDark={checkerDark}
                  onPress={() => void play(levelNumber)}
                />
              );
            })}
        </View>
      </ScrollView>

      <View
        style={[
          styles.endlessDock,
          { backgroundColor: colors.background, borderTopColor: colors.boardShape },
        ]}
      >
        <MenuButton
          label="Endless"
          caption={`Board ${currentSLevelIndex}`}
          onPress={() => void playEndless()}
        />
      </View>
    </SafeAreaView>
  );
}

function LevelTile({
  levelNumber,
  size,
  completed,
  unlocked,
  checkerDark,
  onPress,
}: {
  levelNumber: number;
  size: number;
  completed: boolean;
  unlocked: boolean;
  checkerDark: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const label = completed
    ? `Level ${levelNumber}, completed`
    : unlocked
      ? `Level ${levelNumber}`
      : `Level ${levelNumber}, locked`;

  const backgroundColor = completed
    ? colors.arrowEscaping
    : !unlocked
      ? colors.heartEmpty
      : checkerDark
        ? colors.boardShape
        : colors.surface;

  const labelColor = completed
    ? colors.onAccent
    : !unlocked
      ? colors.textSecondary
      : colors.textPrimary;

  return (
    <Pressable
      onPress={onPress}
      disabled={!unlocked}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !unlocked }}
      style={({ pressed }) => [
        styles.tile,
        { width: size, height: size, backgroundColor, opacity: unlocked ? 1 : 0.55 },
        unlocked && pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.tileLabel, { color: labelColor }]}>{levelNumber}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  back: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: MIN_TOUCH_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backGlyph: {
    fontSize: 24,
  },
  title: {
    ...typography.heading,
  },
  status: {
    ...typography.label,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  scroller: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  endlessDock: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderTopWidth: 1,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
  },
  tile: {
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: {
    ...typography.heading,
  },
  pressed: {
    opacity: 0.7,
  },
});
