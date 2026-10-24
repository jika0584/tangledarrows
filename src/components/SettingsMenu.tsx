import React from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { PaddingSize, TapZoneSize } from "../game/engine/HitTest";
import { useSettingsStore } from "../store/settingsStore";
import { useStageSize } from "./RotatedStage";
import {
  MIN_TOUCH_TARGET,
  spacing,
  typography,
  useColors,
} from "../theme/theme";

interface SettingsMenuProps {
  visible: boolean;
  onClose: () => void;
  onChangeLevel: () => void;
  onRestart?: () => void;
  onReturnHome?: () => void;
  /** Render in-tree instead of in a Modal window, so parent transforms apply. */
  inline?: boolean;
}

export function SettingsMenu({
  visible,
  onClose,
  onChangeLevel,
  onRestart,
  onReturnHome,
  inline = false,
}: SettingsMenuProps) {
  const colors = useColors();
  const stage = useStageSize();
  const wide = stage.width > stage.height;
  const heartsEnabled = useSettingsStore((state) => state.heartsEnabled);
  const darkMode = useSettingsStore((state) => state.darkMode);
  const progressTintsEnabled = useSettingsStore(
    (state) => state.progressTintsEnabled,
  );
  const setHeartsEnabled = useSettingsStore((state) => state.setHeartsEnabled);
  const setDarkMode = useSettingsStore((state) => state.setDarkMode);
  const setProgressTintsEnabled = useSettingsStore(
    (state) => state.setProgressTintsEnabled,
  );
  const devMode = useSettingsStore((state) => state.devMode);
  const tapZoneSize = useSettingsStore((state) => state.tapZoneSize);
  const headPadding = useSettingsStore((state) => state.headPadding);
  const tailPadding = useSettingsStore((state) => state.tailPadding);
  const showPadding = useSettingsStore((state) => state.showPadding);
  const setDevMode = useSettingsStore((state) => state.setDevMode);
  const setTapZoneSize = useSettingsStore((state) => state.setTapZoneSize);
  const setHeadPadding = useSettingsStore((state) => state.setHeadPadding);
  const setTailPadding = useSettingsStore((state) => state.setTailPadding);
  const setShowPadding = useSettingsStore((state) => state.setShowPadding);

  if (inline && !visible) return null;

  const body = (
    <View
      style={[
        inline ? styles.backdropInline : styles.backdrop,
        { backgroundColor: colors.overlay },
      ]}
    >
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityLabel="Close settings"
      />
      <View
        style={[
          styles.card,
          wide && styles.cardWide,
          { backgroundColor: colors.surface },
        ]}
      >
        <Text
          style={[styles.title, { color: colors.textPrimary }]}
          accessibilityRole="header"
        >
          Settings
        </Text>

        {/* Toggles and actions split into columns on a short viewport, where
            one tall stack does not fit. */}
        <ScrollView style={styles.bodyScroll} contentContainerStyle={styles.body}>
          <View style={wide ? styles.bodyWide : undefined}>
          <View style={[styles.group, wide && styles.groupWide]}>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>
                Activate hearts
              </Text>
              <Switch
                value={heartsEnabled}
                onValueChange={(value) => void setHeartsEnabled(value)}
                trackColor={{ false: colors.heartEmpty, true: colors.accent }}
                thumbColor={colors.onAccent}
                accessibilityLabel="Activate hearts"
              />
            </View>

            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>
                Activate dark mode
              </Text>
              <Switch
                value={darkMode}
                onValueChange={(value) => void setDarkMode(value)}
                trackColor={{ false: colors.heartEmpty, true: colors.accent }}
                thumbColor={colors.onAccent}
                accessibilityLabel="Activate dark mode"
              />
            </View>

            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>
                Progress arrow colors
              </Text>
              <Switch
                value={progressTintsEnabled}
                onValueChange={(value) => void setProgressTintsEnabled(value)}
                trackColor={{ false: colors.heartEmpty, true: colors.accent }}
                thumbColor={colors.onAccent}
                accessibilityLabel="Progress arrow colors"
              />
            </View>
          </View>

          <View style={[styles.group, wide && styles.groupWide]}>
            {onRestart ? (
              <Pressable
                onPress={onRestart}
                accessibilityRole="button"
                accessibilityLabel="Restart level"
                style={({ pressed }) => [
                  styles.action,
                  wide && styles.actionWide,
                  { backgroundColor: colors.boardShape },
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.actionLabel,
                    wide && styles.actionLabelWide,
                    { color: colors.textPrimary },
                  ]}
                >
                  Restart level
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              onPress={onChangeLevel}
              accessibilityRole="button"
              accessibilityLabel="Change level"
              style={({ pressed }) => [
                styles.action,
                wide && styles.actionWide,
                { backgroundColor: colors.boardShape },
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[
                  styles.actionLabel,
                  wide && styles.actionLabelWide,
                  { color: colors.textPrimary },
                ]}
              >
                Change level
              </Text>
            </Pressable>

            {onReturnHome ? (
              <Pressable
                onPress={onReturnHome}
                accessibilityRole="button"
                accessibilityLabel="Return home"
                style={({ pressed }) => [
                  styles.action,
                  wide && styles.actionWide,
                  { backgroundColor: colors.boardShape },
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.actionLabel,
                    wide && styles.actionLabelWide,
                    { color: colors.textPrimary },
                  ]}
                >
                  Return home
                </Text>
              </Pressable>
            ) : null}
          </View>
          </View>

          <View style={styles.devSection}>
            <Text style={[styles.devTitle, { color: colors.textSecondary }]}>
              Dev
            </Text>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>
                Activate dev mode
              </Text>
              <Switch
                value={devMode}
                onValueChange={(value) => void setDevMode(value)}
                trackColor={{ false: colors.heartEmpty, true: colors.accent }}
                thumbColor={colors.onAccent}
                accessibilityLabel="Activate dev mode"
              />
            </View>

            {devMode ? (
              <>
                <ChoiceRow
                  label="Tap zone"
                  value={tapZoneSize}
                  options={TAP_ZONE_OPTIONS}
                  onChange={(value) => void setTapZoneSize(value)}
                />
                <ChoiceRow
                  label="Head padding"
                  value={headPadding}
                  options={PADDING_OPTIONS}
                  onChange={(value) => void setHeadPadding(value)}
                />
                <ChoiceRow
                  label="Tail padding"
                  value={tailPadding}
                  options={PADDING_OPTIONS}
                  onChange={(value) => void setTailPadding(value)}
                />
                <View style={styles.row}>
                  <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>
                    Show padding
                  </Text>
                  <Switch
                    value={showPadding}
                    onValueChange={(value) => void setShowPadding(value)}
                    trackColor={{ false: colors.heartEmpty, true: colors.accent }}
                    thumbColor={colors.onAccent}
                    accessibilityLabel="Show padding"
                  />
                </View>
              </>
            ) : null}
          </View>
        </ScrollView>

        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}
        >
          <Text style={[styles.closeLabel, { color: colors.textSecondary }]}>
            Close
          </Text>
        </Pressable>
      </View>
    </View>
  );

  if (inline) return body;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      {body}
    </Modal>
  );
}

const PADDING_OPTIONS: { id: PaddingSize; label: string }[] = [
  { id: "none", label: "None" },
  { id: "small", label: "Small" },
  { id: "big", label: "Big" },
];

const TAP_ZONE_OPTIONS: { id: TapZoneSize; label: string }[] = [
  { id: "small", label: "S" },
  { id: "medium", label: "M" },
  { id: "large", label: "L" },
];

function ChoiceRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const colors = useColors();

  return (
    <View style={styles.choiceBlock}>
      <Text style={[styles.choiceLabel, { color: colors.textPrimary }]}>{label}</Text>
      <View style={styles.choiceRow}>
        {options.map((option) => {
          const selected = option.id === value;
          return (
            <Pressable
              key={option.id}
              onPress={() => onChange(option.id)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${label} ${option.label}`}
              style={({ pressed }) => [
                styles.choice,
                {
                  backgroundColor: selected ? colors.accent : colors.boardShape,
                },
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[
                  styles.choiceText,
                  { color: selected ? colors.onAccent : colors.textPrimary },
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  backdropInline: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    zIndex: 60,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    maxHeight: "92%",
    borderRadius: 28,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardWide: {
    maxWidth: 640,
    padding: spacing.md,
  },
  bodyScroll: {
    flexShrink: 1,
  },
  body: {
    gap: spacing.md,
  },
  bodyWide: {
    flexDirection: "row",
    gap: spacing.lg,
  },
  group: {
    gap: spacing.md,
  },
  groupWide: {
    flex: 1,
  },
  title: {
    ...typography.title,
    textAlign: "center",
    marginBottom: spacing.xs,
  },
  row: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  rowLabel: {
    ...typography.body,
    flex: 1,
  },
  action: {
    minHeight: MIN_TOUCH_TARGET + 8,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  actionWide: {
    minHeight: MIN_TOUCH_TARGET,
  },
  actionLabel: {
    ...typography.heading,
  },
  actionLabelWide: {
    ...typography.body,
  },
  close: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  closeLabel: {
    ...typography.body,
  },
  devSection: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  devTitle: {
    ...typography.label,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  choiceBlock: {
    gap: spacing.xs,
  },
  choiceLabel: {
    ...typography.body,
  },
  choiceRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  choice: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  choiceText: {
    ...typography.label,
  },
  pressed: {
    opacity: 0.7,
  },
});
