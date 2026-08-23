import React from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { UpdatePhase } from '../sync/useLaunchUpdate';
import { spacing, typography, useColors } from '../theme/theme';

interface UpdatePromptProps {
  phase: UpdatePhase;
  onUpdate: () => void;
  onLater: () => void;
}

export function UpdatePrompt({ phase, onUpdate, onLater }: UpdatePromptProps) {
  const colors = useColors();
  const visible = phase === 'available' || phase === 'downloading' || phase === 'error';
  const downloading = phase === 'downloading';
  const failed = phase === 'error';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={downloading ? undefined : onLater}>
      <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[styles.title, { color: colors.textPrimary }]} accessibilityRole="header">
            {failed ? 'Update failed' : 'Update available'}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {failed
              ? 'Could not download the update. Check your connection and try again.'
              : downloading
                ? 'Downloading. The game will restart when it is ready.'
                : 'A newer version of the game is ready. Update now? The app will restart on its own.'}
          </Text>

          {downloading ? (
            <ActivityIndicator size="large" color={colors.accent} />
          ) : (
            <>
              <Pressable
                onPress={onUpdate}
                accessibilityRole="button"
                accessibilityLabel="Update now"
                style={({ pressed }) => [
                  styles.primary,
                  { backgroundColor: colors.accent },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.primaryLabel, { color: colors.onAccent }]}>
                  {failed ? 'Try again' : 'Update now'}
                </Text>
              </Pressable>
              <Pressable
                onPress={onLater}
                accessibilityRole="button"
                accessibilityLabel="Later"
                style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
              >
                <Text style={[styles.secondaryLabel, { color: colors.textSecondary }]}>Later</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 28,
    padding: spacing.lg,
    gap: spacing.sm,
    alignItems: 'center',
  },
  title: {
    ...typography.title,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.body,
    marginBottom: spacing.sm,
    textAlign: 'center',
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
