import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Level } from '../src/levels/types';
import { LevelRepository } from '../src/sync/LevelRepository';
import { useProgressStore } from '../src/store/progressStore';
import { useBoard } from '../src/game/hooks/useBoard';
import { fitBoardToViewport } from '../src/game/rendering/Camera';
import { GameCanvas } from '../src/components/GameCanvas';
import { Hud } from '../src/components/Hud';
import { LevelOverlay } from '../src/components/LevelOverlay';
import { colors, spacing, typography } from '../src/theme/theme';

export default function GameScreen() {
  const {
    hydrated,
    hydrate,
    currentCuratedLevel,
    currentSLevelIndex,
    completeLevel,
    exhaustCuratedLevels,
  } = useProgressStore();

  const [level, setLevel] = useState<Level | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const loadLevel = useCallback(async () => {
    const resolved = await LevelRepository.getNextLevel({
      curatedLevel: currentCuratedLevel,
      sLevelIndex: currentSLevelIndex,
    });

    if (resolved.usedFallback && currentCuratedLevel !== null) {
      await exhaustCuratedLevels();
    }
    setLevel(resolved.level);
  }, [currentCuratedLevel, currentSLevelIndex, exhaustCuratedLevels]);

  useEffect(() => {
    if (!hydrated) return;
    void loadLevel();
  }, [hydrated, loadLevel]);

  if (!level || !hydrated) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator size="large" color={colors.arrow} />
        <Text style={styles.loadingLabel}>Preparing your maze…</Text>
      </SafeAreaView>
    );
  }

  return (
    <Board
      level={level}
      viewport={viewport}
      onViewportChange={setViewport}
      onAdvance={async () => {
        await completeLevel(level.id);
        void LevelRepository.onLevelCompleted(level.id);
        setLevel(null);
      }}
    />
  );
}

interface BoardProps {
  level: Level;
  viewport: { width: number; height: number };
  onViewportChange: (size: { width: number; height: number }) => void;
  onAdvance: () => void;
}

function Board({ level, viewport, onViewportChange, onAdvance }: BoardProps) {
  const { state, animations, tapArrow, onArrowAnimationEnd, restart } = useBoard(level);

  const layout = useMemo(
    () =>
      viewport.width > 0 && viewport.height > 0
        ? fitBoardToViewport(level.grid, viewport)
        : null,
    [level.grid, viewport],
  );

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      onViewportChange({ width, height });
    },
    [onViewportChange],
  );

  const levelLabel = level.id.startsWith('S')
    ? `Endless ${level.id.slice(1)}`
    : `Level ${level.id}`;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Hud levelLabel={levelLabel} lives={state.lives} onRestart={restart} />

      <View style={styles.canvasArea} onLayout={handleLayout}>
        {layout && (
          <GameCanvas
            grid={level.grid}
            arrows={state.arrows}
            layout={layout}
            width={viewport.width}
            height={viewport.height}
            animations={animations}
            onArrowTap={tapArrow}
            onArrowAnimationEnd={onArrowAnimationEnd}
          />
        )}
      </View>

      <Text style={styles.hint} accessibilityRole="text">
        Tap an arrow head to send it out. Pinch or drag with two fingers to zoom.
      </Text>

      {state.status === 'won' && <LevelOverlay kind="won" onPrimary={onAdvance} />}
      {state.status === 'lost' && <LevelOverlay kind="lost" onPrimary={restart} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  canvasArea: {
    flex: 1,
    marginHorizontal: spacing.sm,
  },
  hint: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
  },
  loadingLabel: {
    ...typography.body,
    color: colors.textSecondary,
  },
});
