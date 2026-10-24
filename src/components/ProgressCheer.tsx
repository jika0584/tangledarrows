import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text } from "react-native";
import Animated, { FadeInDown, FadeOutUp } from "react-native-reanimated";
import { spacing, typography, useColors } from "../theme/theme";

const THRESHOLDS = [
  { ratio: 0.75, message: "Nice start!" },
  { ratio: 0.5, message: "Halfway there!" },
  { ratio: 0.2, message: "You've got this!" },
  { ratio: 0.1, message: "So close!" },
] as const;

interface ProgressCheerProps {
  arrowsLeft: number;
  arrowTotal: number;
  playing: boolean;
}

export function ProgressCheer({
  arrowsLeft,
  arrowTotal,
  playing,
}: ProgressCheerProps) {
  const colors = useColors();
  const [message, setMessage] = useState<string | null>(null);
  const shown = useRef(new Set<number>());
  const previous = useRef(arrowTotal);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    shown.current.clear();
    previous.current = arrowTotal;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
    setMessage(null);
  }, [arrowTotal]);

  useEffect(() => {
    if (!playing) {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = null;
      setMessage(null);
      return;
    }
    if (arrowTotal <= 0) return;

    if (arrowsLeft >= arrowTotal) {
      shown.current.clear();
      previous.current = arrowsLeft;
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = null;
      setMessage(null);
      return;
    }

    const prevRatio = previous.current / arrowTotal;
    const nextRatio = arrowsLeft / arrowTotal;
    previous.current = arrowsLeft;

    let latest: (typeof THRESHOLDS)[number] | null = null;
    for (const threshold of THRESHOLDS) {
      if (prevRatio > threshold.ratio && nextRatio <= threshold.ratio) {
        if (!shown.current.has(threshold.ratio)) {
          shown.current.add(threshold.ratio);
          latest = threshold;
        }
      }
    }
    if (!latest) return;

    setMessage(latest.message);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      setMessage(null);
      hideTimer.current = null;
    }, 1700);
  }, [arrowsLeft, arrowTotal, playing]);

  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );

  if (!message || !playing) return null;

  return (
    <Animated.View
      key={message}
      pointerEvents="none"
      entering={FadeInDown.duration(220)}
      exiting={FadeOutUp.duration(220)}
      style={styles.wrap}
    >
      <Text
        style={[
          styles.label,
          {
            color: colors.accent,
            backgroundColor: colors.surface,
            shadowColor: colors.textPrimary,
          },
        ]}
      >
        {message}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: "flex-start",
  },
  label: {
    ...typography.label,
    overflow: "hidden",
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: 999,
    textAlign: "center",
    elevation: 4,
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
});
