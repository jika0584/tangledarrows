import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MAX_LIVES } from '../levels/types';
import { colors, MIN_TOUCH_TARGET, spacing, typography } from '../theme/theme';

interface HudProps {
  levelLabel: string;
  lives: number;
  onRestart: () => void;
  onSettings?: () => void;
}

export function Hud({ levelLabel, lives, onRestart, onSettings }: HudProps) {
  return (
    <View style={styles.container}>
      <HudButton label="Restart" glyph="↺" onPress={onRestart} />

      <View style={styles.center} accessibilityRole="header">
        <Text style={styles.levelLabel}>{levelLabel}</Text>
        <View
          style={styles.hearts}
          accessibilityLabel={`${lives} of ${MAX_LIVES} lives remaining`}
        >
          {Array.from({ length: MAX_LIVES }, (_, index) => (
            <Text
              key={index}
              style={[styles.heart, index >= lives && styles.heartEmpty]}
              accessibilityElementsHidden
            >
              ♥
            </Text>
          ))}
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
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={16}
      style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
    >
      <Text style={styles.iconGlyph}>{glyph}</Text>
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
    color: colors.textSecondary,
    letterSpacing: 1,
  },
  hearts: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  heart: {
    fontSize: 30,
    lineHeight: 34,
    color: colors.heart,
  },
  heartEmpty: {
    color: colors.heartEmpty,
  },
  iconButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: MIN_TOUCH_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  iconButtonPressed: {
    opacity: 0.6,
  },
  iconGlyph: {
    fontSize: 24,
    color: colors.textPrimary,
  },
});
