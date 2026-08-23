import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MAX_LIVES } from '../levels/types';
import { MIN_TOUCH_TARGET, spacing, typography, useColors } from '../theme/theme';

interface HudProps {
  levelLabel: string;
  lives: number;
  arrowsLeft: number;
  heartsEnabled?: boolean;
  onRestart: () => void;
  onSkip?: () => void;
  onSettings?: () => void;
}

export function Hud({
  levelLabel,
  lives,
  arrowsLeft,
  heartsEnabled = false,
  onRestart,
  onSkip,
  onSettings,
}: HudProps) {
  const colors = useColors();

  return (
    <View style={styles.container}>
      <HudButton label="Restart" glyph="↺" onPress={onRestart} />

      <View style={styles.center} accessibilityRole="header">
        <Pressable
          onPress={onSkip}
          disabled={!onSkip}
          accessibilityRole="button"
          accessibilityLabel={onSkip ? `${levelLabel}. Skip to the next level` : levelLabel}
          hitSlop={10}
          style={({ pressed }) => pressed && styles.iconButtonPressed}
        >
          <Text style={[styles.levelLabel, { color: colors.textSecondary }]}>
            {levelLabel}
            {onSkip ? ' ›' : ''}
          </Text>
        </Pressable>
        {heartsEnabled ? (
          <View
            style={styles.hearts}
            accessibilityLabel={`${lives} of ${MAX_LIVES} lives remaining`}
          >
            {Array.from({ length: MAX_LIVES }, (_, index) => {
              const spent = index >= lives;
              return (
                <Text
                  key={index}
                  style={[styles.heart, { color: spent ? colors.heartEmpty : colors.heart }]}
                  accessibilityElementsHidden
                >
                  {/* Hollow rather than merely dimmed: a colour change alone is
                      easy to miss mid-puzzle, a change of shape is not. */}
                  {spent ? '♡' : '♥'}
                </Text>
              );
            })}
          </View>
        ) : null}
        <View
          style={[styles.arrowCount, { backgroundColor: colors.boardShape }]}
          accessibilityLabel={`${arrowsLeft} arrows remaining`}
        >
          <Text style={[styles.arrowGlyph, { color: colors.arrow }]}>↗</Text>
          <Text style={[styles.arrowCountValue, { color: colors.arrow }]}>{arrowsLeft}</Text>
        </View>
      </View>

      <HudButton label="Settings" glyph="⚙" onPress={onSettings} />
    </View>
  );
}

function HudButton({
  label,
  glyph,
  onPress,
}: {
  label: string;
  glyph: string;
  onPress?: () => void;
}) {
  const colors = useColors();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={16}
      style={({ pressed }) => [
        styles.iconButton,
        { backgroundColor: colors.surface },
        pressed && styles.iconButtonPressed,
      ]}
    >
      <Text style={[styles.iconGlyph, { color: colors.textPrimary }]}>{glyph}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  center: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  levelLabel: {
    ...typography.label,
    letterSpacing: 1,
  },
  hearts: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  heart: {
    fontSize: 30,
    lineHeight: 34,
  },
  arrowCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 16,
    minWidth: 72,
    justifyContent: 'center',
  },
  arrowGlyph: {
    fontSize: 16,
    fontWeight: '700',
  },
  arrowCountValue: {
    ...typography.label,
    fontVariant: ['tabular-nums'],
  },
  iconButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: MIN_TOUCH_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonPressed: {
    opacity: 0.6,
  },
  iconGlyph: {
    fontSize: 24,
  },
});
