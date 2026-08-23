import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ScoreLine } from '../game/scoring/levelScore';
import { spacing, typography, useColors } from '../theme/theme';

interface LevelOverlayProps {
  kind: 'won' | 'lost';
  onPrimary: () => void;
  onSecondary?: () => void;
  elapsedLabel?: string;
  scoreLines?: ScoreLine[];
  totalScore?: number;
}

function formatPoints(points: number): string {
  const prefix = points >= 0 ? '+' : '';
  return `${prefix}${points.toLocaleString()}`;
}

export function LevelOverlay({
  kind,
  onPrimary,
  onSecondary,
  elapsedLabel,
  scoreLines,
  totalScore,
}: LevelOverlayProps) {
  const colors = useColors();
  const won = kind === 'won';
  const showScore = won && scoreLines != null && scoreLines.length > 0 && totalScore != null;

  return (
    <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          {won ? 'Cleared' : 'Out of hearts'}
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {won ? 'Every arrow escaped.' : 'Keep going from here, or start the board over.'}
        </Text>

        {won && elapsedLabel ? (
          <Text style={[styles.meta, { color: colors.textSecondary }]}>Time {elapsedLabel}</Text>
        ) : null}

        {showScore ? (
          <ScrollView style={styles.scoreScroll} contentContainerStyle={styles.scoreTable}>
            {scoreLines.map((line) => (
              <View key={line.label} style={styles.scoreRow}>
                <Text style={[styles.scoreLabel, { color: colors.textPrimary }]}>{line.label}</Text>
                <Text
                  style={[
                    styles.scoreValue,
                    { color: line.points >= 0 ? colors.accent : colors.arrowBlocked },
                  ]}
                >
                  {formatPoints(line.points)}
                </Text>
              </View>
            ))}
            <View style={[styles.scoreDivider, { backgroundColor: colors.boardShape }]} />
            <View style={styles.scoreRow}>
              <Text style={[styles.totalLabel, { color: colors.textPrimary }]}>Total</Text>
              <Text style={[styles.totalValue, { color: colors.textPrimary }]}>
                {totalScore.toLocaleString()}
              </Text>
            </View>
          </ScrollView>
        ) : null}

        {!won && elapsedLabel ? (
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Time {elapsedLabel}</Text>
        ) : null}

        <Pressable
          onPress={onPrimary}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.primary,
            { backgroundColor: colors.accent },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.primaryLabel, { color: colors.onAccent }]}>
            {won ? 'Next level' : 'Continue anyway'}
          </Text>
        </Pressable>

        {onSecondary && (
          <Pressable
            onPress={onSecondary}
            accessibilityRole="button"
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          >
            <Text style={[styles.secondaryLabel, { color: colors.textSecondary }]}>
              {won ? 'Replay level' : 'Try again'}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    maxHeight: '88%',
    borderRadius: 28,
    padding: spacing.lg,
    gap: spacing.sm,
    alignItems: 'center',
  },
  title: {
    ...typography.title,
  },
  subtitle: {
    ...typography.body,
    textAlign: 'center',
  },
  meta: {
    ...typography.label,
    marginBottom: spacing.xs,
  },
  scoreScroll: {
    width: '100%',
    maxHeight: 240,
    marginBottom: spacing.sm,
  },
  scoreTable: {
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  scoreLabel: {
    ...typography.body,
    flex: 1,
  },
  scoreValue: {
    ...typography.label,
    fontVariant: ['tabular-nums'],
  },
  scoreDivider: {
    height: 1,
    width: '100%',
    marginVertical: spacing.xs,
  },
  totalLabel: {
    ...typography.heading,
  },
  totalValue: {
    ...typography.heading,
    fontVariant: ['tabular-nums'],
  },
  primary: {
    width: '100%',
    minHeight: 60,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: {
    ...typography.heading,
  },
  secondary: {
    width: '100%',
    minHeight: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryLabel: {
    ...typography.body,
  },
  pressed: {
    opacity: 0.7,
  },
});
