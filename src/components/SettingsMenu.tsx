import React from 'react';
import { Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useSettingsStore } from '../store/settingsStore';
import { MIN_TOUCH_TARGET, spacing, typography, useColors } from '../theme/theme';

interface SettingsMenuProps {
  visible: boolean;
  onClose: () => void;
  onChangeLevel: () => void;
  onReturnHome?: () => void;
}

export function SettingsMenu({
  visible,
  onClose,
  onChangeLevel,
  onReturnHome,
}: SettingsMenuProps) {
  const colors = useColors();
  const heartsEnabled = useSettingsStore((state) => state.heartsEnabled);
  const darkMode = useSettingsStore((state) => state.darkMode);
  const setHeartsEnabled = useSettingsStore((state) => state.setHeartsEnabled);
  const setDarkMode = useSettingsStore((state) => state.setDarkMode);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close settings" />
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[styles.title, { color: colors.textPrimary }]} accessibilityRole="header">
            Settings
          </Text>

          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>Activate hearts</Text>
            <Switch
              value={heartsEnabled}
              onValueChange={(value) => void setHeartsEnabled(value)}
              trackColor={{ false: colors.heartEmpty, true: colors.accent }}
              thumbColor={colors.onAccent}
              accessibilityLabel="Activate hearts"
            />
          </View>

          <Pressable
            onPress={onChangeLevel}
            accessibilityRole="button"
            accessibilityLabel="Change level"
            style={({ pressed }) => [
              styles.action,
              { backgroundColor: colors.boardShape },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.actionLabel, { color: colors.textPrimary }]}>Change level</Text>
          </Pressable>

          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>Activate dark mode</Text>
            <Switch
              value={darkMode}
              onValueChange={(value) => void setDarkMode(value)}
              trackColor={{ false: colors.heartEmpty, true: colors.accent }}
              thumbColor={colors.onAccent}
              accessibilityLabel="Activate dark mode"
            />
          </View>

          {onReturnHome ? (
            <Pressable
              onPress={onReturnHome}
              accessibilityRole="button"
              accessibilityLabel="Return home"
              style={({ pressed }) => [
                styles.action,
                { backgroundColor: colors.boardShape },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.actionLabel, { color: colors.textPrimary }]}>Return home</Text>
            </Pressable>
          ) : null}

          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}
          >
            <Text style={[styles.closeLabel, { color: colors.textSecondary }]}>Close</Text>
          </Pressable>
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
    gap: spacing.md,
  },
  title: {
    ...typography.title,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  row: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  rowLabel: {
    ...typography.body,
    flex: 1,
  },
  action: {
    minHeight: MIN_TOUCH_TARGET + 8,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  actionLabel: {
    ...typography.heading,
  },
  close: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeLabel: {
    ...typography.body,
  },
  pressed: {
    opacity: 0.7,
  },
});
