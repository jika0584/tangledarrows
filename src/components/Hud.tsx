import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MAX_LIVES } from "../levels/types";
import { useStageInsets } from "./RotatedStage";
import {
  MIN_TOUCH_TARGET,
  spacing,
  typography,
  useColors,
} from "../theme/theme";

interface HudProps {
  levelLabel: string;
  lives: number;
  arrowsLeft: number;
  heartsEnabled?: boolean;
  onSkip?: () => void;
  onSettings?: () => void;
  /** Combo and encouragement banners, stacked under the status pill. */
  messages?: React.ReactNode;
}

/**
 * Floats over the board instead of sitting above it. A full-width bar cost more
 * height than its contents were worth, and in landscape it ate the short axis.
 */
export function Hud({
  levelLabel,
  lives,
  arrowsLeft,
  heartsEnabled = false,
  onSkip,
  onSettings,
  messages,
}: HudProps) {
  const colors = useColors();
  const insets = useStageInsets();

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top + GAP,
          paddingLeft: insets.left + GAP,
          paddingRight: insets.right + GAP,
        },
      ]}
      pointerEvents="box-none"
    >
      <View style={styles.left} pointerEvents="box-none">
        <View
          style={[
            styles.pill,
            {
              backgroundColor: colors.surface,
              shadowColor: colors.textPrimary,
            },
          ]}
          // Nothing in here is tappable without a skip target, so let taps fall
          // through to whatever arrow sits underneath.
          pointerEvents={onSkip ? "box-none" : "none"}
        >
          <Pressable
            onPress={onSkip}
            disabled={!onSkip}
            accessibilityRole={onSkip ? "button" : "text"}
            accessibilityLabel={
              onSkip ? `${levelLabel}. Skip to the next level` : levelLabel
            }
            hitSlop={10}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Text style={[styles.levelLabel, { color: colors.textSecondary }]}>
              {levelLabel}
              {onSkip ? " ›" : ""}
            </Text>
          </Pressable>

          <View
            style={[styles.divider, { backgroundColor: colors.textSecondary }]}
          />

          <View
            style={styles.arrowCount}
            accessibilityLabel={`${arrowsLeft} arrows remaining`}
          >
            <Text style={[styles.arrowGlyph, { color: colors.arrow }]}>↗</Text>
            <Text style={[styles.arrowCountValue, { color: colors.arrow }]}>
              {arrowsLeft}
            </Text>
          </View>

          {heartsEnabled ? (
            <>
              <View
                style={[
                  styles.divider,
                  { backgroundColor: colors.textSecondary },
                ]}
              />
              <View
                style={styles.hearts}
                accessibilityLabel={`${lives} of ${MAX_LIVES} lives remaining`}
              >
                {Array.from({ length: MAX_LIVES }, (_, index) => {
                  const spent = index >= lives;
                  return (
                    <Text
                      key={index}
                      style={[
                        styles.heart,
                        { color: spent ? colors.heartEmpty : colors.heart },
                      ]}
                      accessibilityElementsHidden
                    >
                      {/* Hollow rather than merely dimmed: a colour change alone
                          is easy to miss mid-puzzle, a change of shape is not. */}
                      {spent ? "♡" : "♥"}
                    </Text>
                  );
                })}
              </View>
            </>
          ) : null}
        </View>

        {messages ? (
          <View style={styles.messages} pointerEvents="none">
            {messages}
          </View>
        ) : null}
      </View>

      <Pressable
        onPress={onSettings}
        accessibilityRole="button"
        accessibilityLabel="Menu"
        hitSlop={12}
        style={({ pressed }) => [
          styles.menuButton,
          { backgroundColor: colors.surface, shadowColor: colors.textPrimary },
          pressed && styles.pressed,
        ]}
      >
        <Text style={[styles.menuGlyph, { color: colors.textPrimary }]}>⚙</Text>
      </Pressable>
    </View>
  );
}

const MENU_SIZE = MIN_TOUCH_TARGET;

/** Breathing room between the HUD and the system bars it sits next to. */
const GAP = spacing.sm;

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
    zIndex: 20,
  },
  left: {
    flexShrink: 1,
    alignItems: "flex-start",
    gap: 6,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: 999,
    elevation: 3,
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  divider: {
    width: 1,
    height: 14,
    opacity: 0.35,
  },
  levelLabel: {
    ...typography.label,
    fontSize: 14,
    letterSpacing: 0.5,
  },
  arrowCount: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  arrowGlyph: {
    fontSize: 13,
    fontWeight: "700",
  },
  arrowCountValue: {
    ...typography.label,
    fontSize: 14,
    fontVariant: ["tabular-nums"],
  },
  hearts: {
    flexDirection: "row",
    gap: 2,
  },
  heart: {
    fontSize: 15,
    lineHeight: 18,
  },
  messages: {
    alignItems: "flex-start",
    gap: 4,
  },
  menuButton: {
    width: MENU_SIZE,
    height: MENU_SIZE,
    borderRadius: MENU_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  menuGlyph: {
    fontSize: 22,
  },
  pressed: {
    opacity: 0.6,
  },
});
