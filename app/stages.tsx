import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LevelThumbnail } from '../src/components/LevelThumbnail';
import { MenuButton } from '../src/components/MenuButton';
import { NewRibbon } from '../src/components/NewRibbon';
import { SHOW_DEV_TOOLS } from '../src/dev/flags';
import { Level } from '../src/levels/types';
import { generateCuratedLevel, LAST_CURATED_LEVEL } from '../src/procedural/CuratedGenerator';
import { LevelRepository } from '../src/sync/LevelRepository';
import { LocalCache } from '../src/sync/LocalCache';
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
    staleCuratedLevels,
  } = useProgressStore();
  const staleSet = useMemo(() => new Set(staleCuratedLevels), [staleCuratedLevels]);
  const [highestKnown, setHighestKnown] = useState(1);
  const [gridWidth, setGridWidth] = useState(0);
  const [syncing, setSyncing] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [previewLevel, setPreviewLevel] = useState<Level | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewNumber, setPreviewNumber] = useState<number | null>(null);

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

  const openPreview = async (levelNumber: number) => {
    setPreviewNumber(levelNumber);
    setPreviewLevel(null);
    setPreviewLoading(true);
    try {
      let level = await LocalCache.getLevel(levelNumber);
      if (!level) {
        const resolved = await LevelRepository.getNextLevel({
          curatedLevel: levelNumber,
          sLevelIndex: 1,
        });
        level = resolved.level.source === 'curated' ? resolved.level : null;
      }
      if (!level) {
        try {
          level = generateCuratedLevel(levelNumber, { seedAttempts: 1 });
        } catch {
          level = null;
        }
      }
      setPreviewLevel(level);
    } finally {
      setPreviewLoading(false);
    }
  };

  const play = async (levelNumber: number) => {
    setPreviewNumber(null);
    setPreviewLevel(null);
    await selectCuratedLevel(levelNumber);
    router.replace('/game');
  };

  const playEndless = async () => {
    await selectEndlessLevel(currentSLevelIndex);
    router.replace('/game');
  };

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.background }]}
      edges={['top', 'bottom', 'left', 'right']}
    >
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
      </View>
      {SHOW_DEV_TOOLS && status ? (
        <Text style={[styles.status, { color: colors.arrowBlocked }]}>{status}</Text>
      ) : null}

      {syncing ? (
        <View style={styles.loadingPane}>
          <ActivityIndicator size="large" color={colors.arrow} />
          <Text style={[styles.loadingLabel, { color: colors.textSecondary }]}>
            Loading levels…
          </Text>
          <View style={styles.pulseRow}>
            {[0, 1, 2, 3, 4].map((i) => (
              <View
                key={i}
                style={[
                  styles.pulseDot,
                  {
                    backgroundColor: colors.accent,
                    opacity: 0.35 + (i % 3) * 0.2,
                  },
                ]}
              />
            ))}
          </View>
        </View>
      ) : (
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
                const stale = completed && staleSet.has(levelNumber);
                const unlocked = SHOW_DEV_TOOLS || levelNumber <= clearedCuratedLevels + 1;
                const checkerDark = (row + col) % 2 === 1;

                return (
                  <LevelTile
                    key={levelNumber}
                    levelNumber={levelNumber}
                    size={tileSize}
                    completed={completed}
                    stale={stale}
                    unlocked={unlocked}
                    checkerDark={checkerDark}
                    onPress={() => void openPreview(levelNumber)}
                  />
                );
              })}
          </View>
        </ScrollView>
      )}

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

      <Modal
        visible={previewNumber != null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setPreviewNumber(null);
          setPreviewLevel(null);
        }}
      >
        <View style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>
              Level {previewNumber}
            </Text>
            {previewLoading ? (
              <View style={styles.thumbPlaceholder}>
                <ActivityIndicator size="large" color={colors.arrow} />
              </View>
            ) : previewLevel ? (
              <LevelThumbnail level={previewLevel} size={260} />
            ) : (
              <View style={[styles.thumbPlaceholder, { backgroundColor: colors.boardShape }]}>
                <Text style={[styles.loadingLabel, { color: colors.textSecondary }]}>
                  Preview unavailable
                </Text>
              </View>
            )}
            <Pressable
              onPress={() => previewNumber != null && void play(previewNumber)}
              disabled={previewLoading}
              accessibilityRole="button"
              accessibilityLabel="Play"
              style={({ pressed }) => [
                styles.playButton,
                { backgroundColor: colors.accent, opacity: previewLoading ? 0.5 : 1 },
                pressed && !previewLoading && styles.pressed,
              ]}
            >
              <Text style={[styles.playLabel, { color: colors.onAccent }]}>Play</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setPreviewNumber(null);
                setPreviewLevel(null);
              }}
              accessibilityRole="button"
              style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
            >
              <Text style={[styles.cancelLabel, { color: colors.textSecondary }]}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function LevelTile({
  levelNumber,
  size,
  completed,
  stale,
  unlocked,
  checkerDark,
  onPress,
}: {
  levelNumber: number;
  size: number;
  completed: boolean;
  stale: boolean;
  unlocked: boolean;
  checkerDark: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const label = completed
    ? stale
      ? `Level ${levelNumber}, updated — play again`
      : `Level ${levelNumber}, completed`
    : unlocked
      ? `Level ${levelNumber}`
      : `Level ${levelNumber}, locked`;

  const backgroundColor = stale
    ? STALE_ORANGE
    : completed
      ? colors.arrowEscaping
      : !unlocked
        ? colors.heartEmpty
        : checkerDark
          ? colors.boardShape
          : colors.surface;

  const labelColor = stale || completed
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
      {stale ? <NewRibbon size={size} /> : null}
    </Pressable>
  );
}

const STALE_ORANGE = '#E67E22';

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
  loadingPane: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  loadingLabel: {
    ...typography.body,
    textAlign: 'center',
  },
  pulseRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  pulseDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
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
    overflow: 'hidden',
  },
  tileLabel: {
    ...typography.heading,
  },
  pressed: {
    opacity: 0.7,
  },
  modalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 28,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.md,
  },
  modalTitle: {
    ...typography.title,
  },
  thumbPlaceholder: {
    width: 260,
    height: 260,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    width: '100%',
    minHeight: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playLabel: {
    fontSize: 28,
    fontWeight: '800',
  },
  cancel: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelLabel: {
    ...typography.body,
  },
});
