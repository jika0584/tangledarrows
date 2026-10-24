import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  AppState,
  LayoutChangeEvent,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Level } from "../src/levels/types";
import { LevelRepository } from "../src/sync/LevelRepository";
import {
  HighScoreBoard,
  HighScoreRepository,
} from "../src/sync/HighScoreRepository";
import { useHighScoreRefresh } from "../src/sync/useHighScoreRefresh";
import { useProgressStore } from "../src/store/progressStore";
import {
  RunCache,
  clearRunCache,
  isResumable,
  loadRunCache,
  saveRunCache,
} from "../src/store/runCache";
import { useBoard } from "../src/game/hooks/useBoard";
import {
  formatElapsed,
  useElapsedTimer,
} from "../src/game/hooks/useElapsedTimer";
import { fitBoardToViewport } from "../src/game/rendering/Camera";
import {
  pickProgressMilestoneTints,
  progressArrowTint,
} from "../src/game/rendering/progressTint";
import {
  describeEscape,
  PROGRESS_TOASTS,
  EscapeEvent,
} from "../src/game/encouragement";
import { computeLevelScore } from "../src/game/scoring/levelScore";
import { GameCanvas } from "../src/components/GameCanvas";
import { Hud } from "../src/components/Hud";
import { LevelOverlay } from "../src/components/LevelOverlay";
import { ProgressCheer } from "../src/components/ProgressCheer";
import { ComboBanner } from "../src/components/ComboBanner";
import { ClearFlair } from "../src/components/ClearFlair";
import {
  EncouragementToast,
  useEncouragementToasts,
} from "../src/components/EncouragementToast";
import { RotatedStage, StageSafeArea } from "../src/components/RotatedStage";
import { RotateToggle } from "../src/components/RotateToggle";
import { RulerToggle } from "../src/components/RulerToggle";
import { SettingsMenu } from "../src/components/SettingsMenu";
import { WinCelebration } from "../src/components/WinCelebration";
import { SHOW_DEV_TOOLS } from "../src/dev/flags";
import { useSettingsStore } from "../src/store/settingsStore";
import { spacing, typography, useColors } from "../src/theme/theme";
import {
  DEMO_ENDING_LEVEL,
  DEMO_ENDING_LEVEL_ID,
} from "../src/levels/demoEnding";

export default function GameScreen() {
  const router = useRouter();
  const { sandbox: sandboxParam } = useLocalSearchParams<{
    sandbox?: string | string[];
  }>();
  const sandbox = Array.isArray(sandboxParam) ? sandboxParam[0] : sandboxParam;
  const isDemo = SHOW_DEV_TOOLS && sandbox === "ending";
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
  const [runCache, setRunCache] = useState<RunCache | null | undefined>(
    undefined,
  );

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    let cancelled = false;
    void loadRunCache().then((cache) => {
      if (!cancelled) setRunCache(cache);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The progress cursor is the single source of truth for which level is on
   * screen. Clearing `level` here rather than at the call site matters: a
   * cloud level can resolve on a microtask, so a caller that advanced progress
   * and then cleared the level would wipe the freshly loaded board and leave
   * nothing to trigger another load.
   */
  useEffect(() => {
    if (!hydrated) return;
    if (isDemo) {
      setLevel(DEMO_ENDING_LEVEL);
      setRunCache(null);
      return;
    }
    let cancelled = false;
    setLevel(null);

    void (async () => {
      const resolved = await LevelRepository.getNextLevel({
        curatedLevel: currentCuratedLevel,
        sLevelIndex: currentSLevelIndex,
      });
      if (cancelled) return;

      if (resolved.usedFallback && currentCuratedLevel !== null) {
        // Drop the campaign cursor and show the endless board in the same
        // turn — returning without setLevel left an infinite loading screen
        // when the effect re-run raced with cancellation.
        await exhaustCuratedLevels();
        if (!cancelled) setLevel(resolved.level);
        return;
      }
      setLevel(resolved.level);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    hydrated,
    currentCuratedLevel,
    currentSLevelIndex,
    exhaustCuratedLevels,
    isDemo,
  ]);

  // Replaces rather than pops: the board can be reached from the menu or from
  // the stage picker, and either way "menu" should mean the menu.
  const goToMenu = useCallback(() => router.replace("/"), [router]);

  const colors = useColors();

  if (!level || !hydrated || (!isDemo && runCache === undefined)) {
    return (
      <SafeAreaView
        style={[styles.loading, { backgroundColor: colors.background }]}
      >
        <ActivityIndicator size="large" color={colors.arrow} />
        <Text style={[styles.loadingLabel, { color: colors.textSecondary }]}>
          Preparing your maze…
        </Text>
      </SafeAreaView>
    );
  }

  const restored =
    isResumable(runCache) && runCache.levelId === level.id ? runCache : null;

  return (
    <Board
      key={level.id}
      level={level}
      restored={restored}
      persistProgress={!isDemo}
      viewport={viewport}
      onViewportChange={setViewport}
      onHome={goToMenu}
      onChooseLevel={() => router.push("/stages")}
      onAdvance={async () => {
        if (isDemo || level.id === DEMO_ENDING_LEVEL_ID) {
          goToMenu();
          return;
        }
        await clearRunCache();
        setRunCache(null);
        void LevelRepository.onLevelCompleted(level.id);
        await completeLevel(level.id);
      }}
    />
  );
}

interface BoardProps {
  level: Level;
  restored: RunCache | null;
  persistProgress: boolean;
  viewport: { width: number; height: number };
  onViewportChange: (size: { width: number; height: number }) => void;
  onAdvance: () => void;
  onHome: () => void;
  onChooseLevel: () => void;
}

function Board({
  level,
  restored,
  persistProgress,
  viewport,
  onViewportChange,
  onAdvance,
  onHome,
  onChooseLevel,
}: BoardProps) {
  const router = useRouter();
  const colors = useColors();
  const heartsEnabled = useSettingsStore((state) => state.heartsEnabled);
  const progressTintsEnabled = useSettingsStore(
    (state) => state.progressTintsEnabled,
  );
  const { toast, showToast } = useEncouragementToasts();
  const progressShown = useRef(new Set<number>());
  const progressPrevRatio = useRef(1);
  const scoreSubmitted = useRef(false);
  const [highScoreBoard, setHighScoreBoard] = useState<HighScoreBoard | null>(
    null,
  );
  const [highScoresLoading, setHighScoresLoading] = useState(false);

  const handleEscape = useCallback(
    (event: EscapeEvent) => {
      const detail = describeEscape(event);
      if (detail) showToast(detail.emoji, detail.message);
    },
    [showToast],
  );

  const {
    state,
    animations,
    failedArrowIds,
    combo,
    comboPayouts,
    mistakeCount,
    hadMistake,
    tapArrow,
    onArrowAnimationEnd,
    restart,
    continueAnyway,
  } = useBoard(level, restored, { heartsEnabled, onEscape: handleEscape });
  const [milestoneTints, setMilestoneTints] = useState(() =>
    pickProgressMilestoneTints(),
  );
  const [rulerActive, setRulerActive] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const toggleRuler = useCallback(() => setRulerActive((on) => !on), []);
  const landscapeMode = useSettingsStore((state) => state.landscapeMode);
  const setLandscapeMode = useSettingsStore((state) => state.setLandscapeMode);
  const toggleLandscape = useCallback(
    () => void setLandscapeMode(!landscapeMode),
    [landscapeMode, setLandscapeMode],
  );
  const [resultElapsed, setResultElapsed] = useState<number | null>(null);

  const playing = state.status === "playing";
  const timerActive = playing && state.moves > 0;
  const persistEnabled = useRef(persistProgress);
  const { getElapsed, reset } = useElapsedTimer(
    timerActive,
    restored?.elapsedMs ?? 0,
  );
  useHighScoreRefresh(level.id);

  const snapshotRef = useRef({
    levelId: level.id,
    remainingArrowIds: state.arrows.map((arrow) => arrow.id),
    lives: state.lives,
    failedArrowIds: [...failedArrowIds],
    moves: state.moves,
    status: state.status,
  });
  snapshotRef.current = {
    levelId: level.id,
    remainingArrowIds: state.arrows.map((arrow) => arrow.id),
    lives: state.lives,
    failedArrowIds: [...failedArrowIds],
    moves: state.moves,
    status: state.status,
  };

  const persistOrClear = useCallback(() => {
    const snap = snapshotRef.current;
    if (
      !persistEnabled.current ||
      snap.status !== "playing" ||
      snap.moves === 0
    ) {
      if (!persistEnabled.current || snap.status !== "playing") {
        void clearRunCache();
      }
      return;
    }
    void saveRunCache({
      levelId: snap.levelId,
      remainingArrowIds: snap.remainingArrowIds,
      lives: snap.lives,
      failedArrowIds: snap.failedArrowIds,
      elapsedMs: getElapsed(),
      moves: snap.moves,
    });
  }, [getElapsed]);

  useEffect(() => {
    persistOrClear();
  }, [
    persistOrClear,
    state.arrows,
    state.lives,
    state.moves,
    state.status,
    failedArrowIds,
  ]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") persistOrClear();
    });
    return () => {
      persistOrClear();
      sub.remove();
    };
  }, [persistOrClear]);

  useEffect(() => {
    if (state.status === "playing") {
      setResultElapsed(null);
      return;
    }
    setResultElapsed(getElapsed());
    void clearRunCache();
  }, [state.status, getElapsed]);

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

  const handleRestart = useCallback(() => {
    persistEnabled.current = persistProgress;
    progressShown.current.clear();
    progressPrevRatio.current = 1;
    setMilestoneTints(pickProgressMilestoneTints());
    restart();
    reset(0);
    setResultElapsed(null);
    if (persistProgress) void clearRunCache();
  }, [restart, reset, persistProgress]);

  const handleAdvance = useCallback(() => {
    persistEnabled.current = false;
    void clearRunCache();
    onAdvance();
  }, [onAdvance]);

  useEffect(() => {
    if (!heartsEnabled && state.status === "lost") continueAnyway();
  }, [heartsEnabled, state.status, continueAnyway]);

  const arrowsLeft = state.arrows.filter(
    (arrow) => animations[arrow.id]?.kind !== "escape",
  ).length;
  const arrowTint = progressTintsEnabled
    ? progressArrowTint(
        level.arrows.length > 0 ? arrowsLeft / level.arrows.length : 1,
        colors.arrow,
        milestoneTints,
      )
    : colors.arrow;
  const elapsedLabel = formatElapsed(resultElapsed ?? getElapsed());

  const scoreResult = useMemo(() => {
    if (state.status !== "won" || resultElapsed == null) return null;
    return computeLevelScore({
      elapsedMs: resultElapsed,
      heartsEnabled,
      lives: state.lives,
      perfect: !hadMistake,
      mistakeCount,
      comboPayouts,
    });
  }, [
    state.status,
    resultElapsed,
    heartsEnabled,
    state.lives,
    hadMistake,
    mistakeCount,
    comboPayouts,
  ]);

  const refreshHighScores = useCallback(async () => {
    setHighScoresLoading(true);
    try {
      const board = await HighScoreRepository.fetch(level.id, { force: true });
      setHighScoreBoard(board);
    } finally {
      setHighScoresLoading(false);
    }
  }, [level.id]);

  const submitHighScore = useCallback(async () => {
    if (scoreResult == null) return;
    setHighScoresLoading(true);
    try {
      const board = await HighScoreRepository.submit(
        level.id,
        scoreResult.total,
      );
      setHighScoreBoard(board);
    } finally {
      setHighScoresLoading(false);
    }
  }, [level.id, scoreResult]);

  useEffect(() => {
    scoreSubmitted.current = false;
    setHighScoreBoard(null);
  }, [level.id]);

  const handleOpenLeaderboard = useCallback(() => {
    if (scoreSubmitted.current) {
      void refreshHighScores();
      return;
    }
    scoreSubmitted.current = true;
    void submitHighScore();
  }, [refreshHighScores, submitHighScore]);

  useEffect(() => {
    progressShown.current.clear();
    progressPrevRatio.current = 1;
  }, [level.id, level.arrows.length]);

  useEffect(() => {
    if (!playing || level.arrows.length <= 0) return;
    const ratio = arrowsLeft / level.arrows.length;
    const prevRatio = progressPrevRatio.current;
    progressPrevRatio.current = ratio;

    for (const threshold of PROGRESS_TOASTS) {
      if (
        prevRatio > threshold.ratio &&
        ratio <= threshold.ratio &&
        !progressShown.current.has(threshold.ratio)
      ) {
        progressShown.current.add(threshold.ratio);
        showToast(threshold.emoji, threshold.message);
      }
    }
  }, [arrowsLeft, level.arrows.length, playing, showToast]);

  const levelLabel =
    level.id === DEMO_ENDING_LEVEL_ID
      ? "Ending test"
      : level.id.startsWith("S")
        ? `Endless ${level.id.slice(1)}`
        : `Level ${level.id}`;

  // The controls hint only earns its screen space while the player is learning.
  const showHint = level.id === "1";

  return (
    <RotatedStage landscape={landscapeMode} backgroundColor={colors.background}>
      <StageSafeArea>
        <View style={styles.canvasArea} onLayout={handleLayout}>
          {layout && (
            <GameCanvas
              grid={level.grid}
              arrows={state.arrows}
              layout={layout}
              width={viewport.width}
              height={viewport.height}
              animations={animations}
              failedArrowIds={failedArrowIds}
              arrowTint={arrowTint}
              rulerActive={rulerActive}
              onArrowTap={tapArrow}
              onArrowAnimationEnd={onArrowAnimationEnd}
            />
          )}
          <RulerToggle active={rulerActive} onToggle={toggleRuler} />
          <RotateToggle landscape={landscapeMode} onToggle={toggleLandscape} />
        </View>

        {showHint ? (
          <Text
            style={[styles.hint, { color: colors.textSecondary }]}
            accessibilityRole="text"
          >
            Tap an arrow head to send it out. Drag to pan, pinch to zoom.
          </Text>
        ) : null}
      </StageSafeArea>

      {/* After the board so it paints on top; it floats rather than taking a
          row of its own. */}
      <Hud
        levelLabel={levelLabel}
        lives={state.lives}
        arrowsLeft={arrowsLeft}
        heartsEnabled={heartsEnabled}
        onSkip={SHOW_DEV_TOOLS ? handleAdvance : undefined}
        onSettings={() => setSettingsOpen(true)}
        messages={
          <>
            <ComboBanner combo={combo} />
            <ProgressCheer
              arrowsLeft={arrowsLeft}
              arrowTotal={level.arrows.length}
              playing={playing}
            />
            <EncouragementToast message={toast} />
          </>
        }
      />

      {state.status === "won" && (
        <>
          <WinCelebration active />
          <LevelOverlay
            kind="won"
            elapsedLabel={elapsedLabel}
            scoreLines={scoreResult?.lines}
            totalScore={scoreResult?.total}
            scoreRevealKey={
              resultElapsed != null ? `${level.id}-${resultElapsed}` : undefined
            }
            highScoreBoard={highScoreBoard}
            highScoresLoading={highScoresLoading}
            onOpenLeaderboard={handleOpenLeaderboard}
            onPrimary={handleAdvance}
            onSecondary={handleRestart}
            onHome={onHome}
            onChooseLevel={onChooseLevel}
          />
          <ClearFlair
            perfect={!hadMistake}
            firstTry={heartsEnabled && state.lives > 0}
          />
        </>
      )}
      {heartsEnabled && state.status === "lost" && (
        <LevelOverlay
          kind="lost"
          elapsedLabel={elapsedLabel}
          onPrimary={continueAnyway}
          onSecondary={handleRestart}
        />
      )}

      <SettingsMenu
        visible={settingsOpen}
        // A Modal opens its own window, which never inherits the stage's
        // rotation, so the turned board needs the inline overlay instead.
        inline={landscapeMode}
        onClose={() => setSettingsOpen(false)}
        onRestart={() => {
          setSettingsOpen(false);
          handleRestart();
        }}
        onChangeLevel={() => {
          setSettingsOpen(false);
          router.push("/stages");
        }}
        onReturnHome={() => {
          setSettingsOpen(false);
          onHome();
        }}
      />
    </RotatedStage>
  );
}

const styles = StyleSheet.create({
  canvasArea: {
    flex: 1,
    marginHorizontal: spacing.sm,
    position: "relative",
  },
  hint: {
    ...typography.body,
    textAlign: "center",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  loadingLabel: {
    ...typography.body,
  },
});
