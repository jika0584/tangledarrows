import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeInLeft, FadeOutLeft } from "react-native-reanimated";
import { spacing, typography, useColors } from "../theme/theme";

export interface EncouragementMessage {
  id: number;
  emoji: string;
  message: string;
}

interface EncouragementToastProps {
  message: EncouragementMessage | null;
}

export function EncouragementToast({ message }: EncouragementToastProps) {
  const colors = useColors();
  if (!message) return null;

  return (
    <Animated.View
      key={message.id}
      pointerEvents="none"
      entering={FadeInLeft.duration(180)}
      exiting={FadeOutLeft.duration(220)}
      style={styles.wrap}
    >
      <View
        style={[
          styles.bubble,
          { backgroundColor: colors.surface, shadowColor: colors.textPrimary },
        ]}
      >
        <Text style={styles.emoji}>{message.emoji}</Text>
        <Text style={[styles.label, { color: colors.textPrimary }]}>
          {message.message}
        </Text>
      </View>
    </Animated.View>
  );
}

/** Shows one toast at a time for ~1s; drops bursts while one is visible. */
export function useEncouragementToasts() {
  const [current, setCurrent] = useState<EncouragementMessage | null>(null);
  const idRef = useRef(0);
  const busyRef = useRef(false);
  const queueRef = useRef<EncouragementMessage[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pump = useCallback(() => {
    if (busyRef.current) return;
    const next = queueRef.current.shift();
    if (!next) return;
    busyRef.current = true;
    setCurrent(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setCurrent(null);
      busyRef.current = false;
      timerRef.current = setTimeout(pump, 80);
    }, 1000);
  }, []);

  const show = useCallback(
    (emoji: string, message: string) => {
      queueRef.current.push({ id: ++idRef.current, emoji, message });
      pump();
    },
    [pump],
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return { toast: current, showToast: show };
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: "flex-start",
    maxWidth: 240,
  },
  bubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 999,
    elevation: 3,
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  emoji: {
    fontSize: 18,
  },
  label: {
    ...typography.label,
    flexShrink: 1,
  },
});
