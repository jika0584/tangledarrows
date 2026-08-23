import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MIN_TOUCH_TARGET, spacing, typography, useColors } from '../theme/theme';

interface MenuButtonProps {
  label: string;
  /** Small line under the label, e.g. what pressing this will resume. */
  caption?: string;
  variant?: 'primary' | 'secondary';
  onPress: () => void;
  compact?: boolean;
}

export function MenuButton({
  label,
  caption,
  variant = 'secondary',
  onPress,
  compact = false,
}: MenuButtonProps) {
  const colors = useColors();
  const primary = variant === 'primary';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={caption ? `${label}. ${caption}` : label}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? colors.accent : colors.surface,
          paddingVertical: compact ? undefined : primary ? spacing.lg : spacing.md,
        },
        compact && styles.compact,
        pressed && styles.pressed,
      ]}
    >
      <View>
        <Text
          style={[
            primary ? styles.primaryLabel : styles.secondaryLabel,
            { color: primary ? colors.onAccent : colors.textPrimary },
            compact && styles.compactLabel,
          ]}
        >
          {label}
        </Text>
        {caption && (
          <Text
            style={[
              styles.caption,
              { color: primary ? colors.onAccent : colors.textSecondary },
              primary && styles.primaryCaption,
            ]}
          >
            {caption}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  compact: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  compactLabel: {
    fontSize: 20,
    letterSpacing: 0,
  },
  pressed: {
    opacity: 0.7,
  },
  primaryLabel: {
    ...typography.title,
    textAlign: 'center',
    letterSpacing: 2,
  },
  secondaryLabel: {
    ...typography.heading,
    textAlign: 'center',
  },
  caption: {
    ...typography.label,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  primaryCaption: {
    opacity: 0.85,
  },
});
