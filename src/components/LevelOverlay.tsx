import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '../theme/theme';

interface LevelOverlayProps {
  kind: 'won' | 'lost';
  onPrimary: () => void;
  onSecondary?: () => void;
}

export function LevelOverlay({ kind, onPrimary, onSecondary }: LevelOverlayProps) {
  const won = kind === 'won';

  return (
    <View style={styles.backdrop}>
      <View style={styles.card}>
        <Text style={styles.title}>{won ? 'Cleared' : 'Out of hearts'}</Text>
        <Text style={styles.subtitle}>
          {won ? 'Every arrow escaped.' : 'Take another run at it.'}
        </Text>

        <Pressable
          onPress={onPrimary}
          accessibilityRole="button"
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
        >
          <Text style={styles.primaryLabel}>{won ? 'Next level' : 'Try again'}</Text>
        </Pressable>

        {onSecondary && (
          <Pressable
            onPress={onSecondary}
            accessibilityRole="button"
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryLabel}>Replay level</Text>
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
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: 28,
    padding: spacing.lg,
    gap: spacing.sm,
    alignItems: 'center',
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  primary: {
    width: '100%',
    minHeight: 60,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: {
    ...typography.heading,
    color: colors.surface,
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
    color: colors.textSecondary,
  },
  pressed: {
    opacity: 0.7,
  },
});
