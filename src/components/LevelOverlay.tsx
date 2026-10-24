import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { useCountUp } from "../game/hooks/useCountUp";
import { ScoreLine } from "../game/scoring/levelScore";
import { HighScoreBoard } from "../sync/HighScoreRepository";
import { DigitWheelTotal } from "./DigitWheelTotal";
import { useStageSize } from "./RotatedStage";
import { spacing, typography, useColors } from "../theme/theme";

type WinPhase = "score" | "leaderboard";

interface LevelOverlayProps {
  kind: "won" | "lost";
  onPrimary: () => void;
  onSecondary?: () => void;
  onHome?: () => void;
  onChooseLevel?: () => void;
  elapsedLabel?: string;
  scoreLines?: ScoreLine[];
  totalScore?: number;
  scoreRevealKey?: string;
  highScoreBoard?: HighScoreBoard | null;
  highScoresLoading?: boolean;
  onOpenLeaderboard?: () => void;
}

function formatPoints(points: number): string {
  const prefix = points >= 0 ? "+" : "";
  return `${prefix}${points.toLocaleString()}`;
}

function AnimatedScoreLine({
  line,
  delayMs,
  active,
}: {
  line: ScoreLine;
  delayMs: number;
  active: boolean;
}) {
  const colors = useColors();
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!active) {
      setStarted(false);
      return;
    }
    const timer = setTimeout(() => setStarted(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);

  const animatedPoints = useCountUp(line.points, started, 520);

  return (
    <Animated.View
      entering={FadeInDown.duration(220).delay(delayMs)}
      style={styles.scoreRow}
    >
      <Text style={[styles.scoreLabel, { color: colors.textPrimary }]}>
        {line.label}
      </Text>
      <Text
        style={[
          styles.scoreValue,
          { color: line.points >= 0 ? colors.accent : colors.arrowBlocked },
        ]}
      >
        {formatPoints(started ? animatedPoints : 0)}
      </Text>
    </Animated.View>
  );
}

function WinOverlay({
  elapsedLabel,
  scoreLines,
  totalScore,
  scoreRevealKey,
  highScoreBoard,
  highScoresLoading,
  onOpenLeaderboard,
  onPrimary,
  onSecondary,
  onHome,
  onChooseLevel,
}: Omit<LevelOverlayProps, "kind">) {
  const colors = useColors();
  const stage = useStageSize();
  // Stacking everything vertically runs out of room on the short axis, so the
  // buttons move into a column beside the scores instead.
  const wide = stage.width > stage.height;
  const lines = scoreLines ?? [];
  const total = totalScore ?? 0;
  const [phase, setPhase] = useState<WinPhase>("score");
  const [scoreAnimDone, setScoreAnimDone] = useState(false);

  const lineDelay = (index: number) => 120 + index * 110;
  const totalDelay = lines.length > 0 ? lineDelay(lines.length - 1) + 200 : 120;

  useEffect(() => {
    setPhase("score");
    setScoreAnimDone(false);
  }, [scoreRevealKey]);

  useEffect(() => {
    const done = setTimeout(() => setScoreAnimDone(true), totalDelay + 1100);
    return () => clearTimeout(done);
  }, [totalDelay, scoreRevealKey]);

  const rankedScores = useMemo(
    () => highScoreBoard?.entries ?? [],
    [highScoreBoard],
  );

  const openLeaderboard = () => {
    onOpenLeaderboard?.();
    setPhase("leaderboard");
  };

  return (
    <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
      <View
        style={[
          styles.card,
          wide && styles.cardWide,
          { backgroundColor: colors.surface },
        ]}
      >
        {phase === "score" ? (
          <Animated.View
            entering={FadeIn.duration(220)}
            style={[styles.phase, wide && styles.phaseWide]}
          >
            <View style={[styles.info, wide && styles.infoWide]}>
              <Text style={[styles.title, { color: colors.textPrimary }]}>
                Cleared
              </Text>
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                Every arrow escaped.
              </Text>
              {elapsedLabel ? (
                <Text style={[styles.meta, { color: colors.textSecondary }]}>
                  Time {elapsedLabel}
                </Text>
              ) : null}

              <ScrollView
                style={styles.scoreScroll}
                contentContainerStyle={styles.scoreTable}
              >
                {lines.map((line, index) => (
                  <AnimatedScoreLine
                    key={line.label}
                    line={line}
                    delayMs={lineDelay(index)}
                    active
                  />
                ))}
              </ScrollView>

              <View style={styles.totalHero}>
                <Text
                  style={[styles.totalCaption, { color: colors.textSecondary }]}
                >
                  Total score
                </Text>
                <DigitWheelTotal
                  value={total}
                  active
                  settleMs={Math.max(900, totalDelay + 400)}
                  color={colors.arrowEscaping}
                />
              </View>
            </View>

            <View style={[styles.actions, wide && styles.actionsWide]}>
              <Pressable
                onPress={openLeaderboard}
                disabled={!scoreAnimDone}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.primary,
                  wide && styles.primaryWide,
                  {
                    backgroundColor: colors.accent,
                    opacity: scoreAnimDone ? 1 : 0.45,
                  },
                  pressed && scoreAnimDone && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.primaryLabel,
                    wide && styles.compactLabel,
                    { color: colors.onAccent },
                  ]}
                >
                  Next
                </Text>
              </Pressable>
            </View>
          </Animated.View>
        ) : (
          <Animated.View
            entering={FadeIn.duration(280)}
            style={[styles.phase, wide && styles.phaseWide]}
          >
            <View style={[styles.info, wide && styles.infoWide]}>
              <Text style={[styles.title, { color: colors.textPrimary }]}>
                High scores
              </Text>
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                Top 10 for this level
              </Text>

              <View
                style={[
                  styles.leaderHeader,
                  { borderBottomColor: colors.boardShape },
                ]}
              >
                <Text
                  style={[
                    styles.leaderHeaderRank,
                    { color: colors.textSecondary },
                  ]}
                >
                  #
                </Text>
                <Text
                  style={[
                    styles.leaderHeaderScore,
                    { color: colors.textSecondary },
                  ]}
                >
                  Score
                </Text>
              </View>

              <ScrollView
                style={styles.leaderScroll}
                contentContainerStyle={styles.leaderTable}
              >
                {highScoresLoading ? (
                  <Text
                    style={[
                      styles.leaderEmpty,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Loading scores…
                  </Text>
                ) : rankedScores.length === 0 ? (
                  <Text
                    style={[
                      styles.leaderEmpty,
                      { color: colors.textSecondary },
                    ]}
                  >
                    No scores yet — yours will appear here.
                  </Text>
                ) : (
                  rankedScores.map((entry, index) => {
                    const highlight = entry.isCurrentRun || entry.isMine;
                    return (
                      <View
                        key={`${entry.score}-${entry.achievedAt}-${index}`}
                        style={[
                          styles.leaderRow,
                          {
                            backgroundColor: highlight
                              ? colors.boardShape
                              : "transparent",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.leaderRank,
                            { color: colors.textSecondary },
                          ]}
                        >
                          {index + 1}
                        </Text>
                        <Text
                          style={[
                            styles.leaderScore,
                            { color: colors.arrowEscaping },
                          ]}
                        >
                          {entry.score.toLocaleString()}
                          {entry.isCurrentRun
                            ? "  ★"
                            : entry.isMine
                              ? "  · you"
                              : ""}
                        </Text>
                      </View>
                    );
                  })
                )}
              </ScrollView>

              {highScoreBoard?.myRank != null &&
              highScoreBoard.myRank > rankedScores.length ? (
                <Text
                  style={[styles.leaderEmpty, { color: colors.textSecondary }]}
                >
                  Your best: #{highScoreBoard.myRank} ·{" "}
                  {highScoreBoard.myBest?.toLocaleString()}
                </Text>
              ) : null}
            </View>

            <View style={[styles.actions, wide && styles.actionsWide]}>
              <Pressable
                onPress={onPrimary}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.primary,
                  wide && styles.primaryWide,
                  { backgroundColor: colors.accent },
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.primaryLabel,
                    wide && styles.compactLabel,
                    { color: colors.onAccent },
                  ]}
                >
                  Next level
                </Text>
              </Pressable>

              {(onHome || onChooseLevel) && (
                <View style={styles.navRow}>
                  {onHome ? (
                    <Pressable
                      onPress={onHome}
                      accessibilityRole="button"
                      accessibilityLabel="Home"
                      style={({ pressed }) => [
                        styles.navIcon,
                        wide && styles.navIconWide,
                        { backgroundColor: colors.boardShape },
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text
                        style={[styles.navGlyph, { color: colors.textPrimary }]}
                      >
                        ⌂
                      </Text>
                    </Pressable>
                  ) : null}
                  {onChooseLevel ? (
                    <Pressable
                      onPress={onChooseLevel}
                      accessibilityRole="button"
                      accessibilityLabel="Choose level"
                      style={({ pressed }) => [
                        styles.navChoose,
                        wide && styles.navChooseWide,
                        { backgroundColor: colors.boardShape },
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.navChooseLabel,
                          wide && styles.compactLabel,
                          { color: colors.textPrimary },
                        ]}
                      >
                        Choose level
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              )}

              {onSecondary ? (
                <Pressable
                  onPress={onSecondary}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.secondary,
                    wide && styles.secondaryWide,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.secondaryLabel,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Replay level
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </Animated.View>
        )}
      </View>
    </View>
  );
}

export function LevelOverlay(props: LevelOverlayProps) {
  const colors = useColors();
  const won = props.kind === "won";

  if (won) {
    return <WinOverlay {...props} />;
  }

  return (
    <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          Out of hearts
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Keep going from here, or start the board over.
        </Text>
        {props.elapsedLabel ? (
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Time {props.elapsedLabel}
          </Text>
        ) : null}

        <Pressable
          onPress={props.onPrimary}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.primary,
            { backgroundColor: colors.accent },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.primaryLabel, { color: colors.onAccent }]}>
            Continue anyway
          </Text>
        </Pressable>

        {props.onSecondary ? (
          <Pressable
            onPress={props.onSecondary}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.secondary,
              pressed && styles.pressed,
            ]}
          >
            <Text
              style={[styles.secondaryLabel, { color: colors.textSecondary }]}
            >
              Try again
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    zIndex: 50,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    maxHeight: "90%",
    borderRadius: 28,
    padding: spacing.lg,
    gap: spacing.sm,
    alignItems: "stretch",
  },
  cardWide: {
    maxWidth: 720,
    maxHeight: "94%",
    padding: spacing.md,
  },
  phase: {
    width: "100%",
    flexShrink: 1,
    alignItems: "center",
    gap: spacing.sm,
  },
  phaseWide: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: spacing.md,
  },
  info: {
    alignSelf: "stretch",
    flexShrink: 1,
    alignItems: "center",
    gap: spacing.sm,
  },
  infoWide: {
    flex: 1,
  },
  actions: {
    alignSelf: "stretch",
    gap: spacing.sm,
  },
  actionsWide: {
    width: 220,
    flexGrow: 0,
    flexShrink: 0,
    justifyContent: "center",
  },
  title: {
    ...typography.title,
    textAlign: "center",
  },
  subtitle: {
    ...typography.body,
    textAlign: "center",
  },
  meta: {
    ...typography.label,
    marginBottom: spacing.xs,
  },
  scoreScroll: {
    width: "100%",
    flexShrink: 1,
    maxHeight: 220,
    marginTop: spacing.xs,
  },
  scoreTable: {
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  scoreRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  scoreLabel: {
    ...typography.body,
    flex: 1,
  },
  scoreValue: {
    ...typography.label,
    fontVariant: ["tabular-nums"],
  },
  totalHero: {
    width: "100%",
    alignItems: "center",
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  totalCaption: {
    ...typography.label,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  leaderHeader: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    paddingBottom: spacing.xs,
    marginTop: spacing.xs,
  },
  leaderHeaderRank: {
    ...typography.label,
    width: 36,
  },
  leaderHeaderScore: {
    ...typography.label,
    flex: 1,
    textAlign: "right",
  },
  leaderScroll: {
    width: "100%",
    flexShrink: 1,
    maxHeight: 260,
    marginVertical: spacing.sm,
  },
  leaderTable: {
    gap: spacing.xs,
  },
  leaderEmpty: {
    ...typography.body,
    textAlign: "center",
    paddingVertical: spacing.md,
  },
  leaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: 14,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  leaderRank: {
    ...typography.label,
    width: 36,
    fontVariant: ["tabular-nums"],
  },
  leaderScore: {
    ...typography.heading,
    flex: 1,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
  primary: {
    width: "100%",
    minHeight: 60,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryWide: {
    minHeight: 52,
  },
  primaryLabel: {
    ...typography.heading,
  },
  /** Headline sizes do not fit the narrow action column. */
  compactLabel: {
    ...typography.body,
  },
  navRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  navIcon: {
    width: 56,
    minHeight: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  navIconWide: {
    width: 48,
    minHeight: 48,
  },
  navChooseWide: {
    minHeight: 48,
  },
  navGlyph: {
    fontSize: 28,
    fontWeight: "700",
  },
  navChoose: {
    flex: 1,
    minHeight: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  navChooseLabel: {
    ...typography.heading,
  },
  secondary: {
    width: "100%",
    minHeight: 56,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryWide: {
    minHeight: 44,
  },
  secondaryLabel: {
    ...typography.body,
  },
  pressed: {
    opacity: 0.7,
  },
});
