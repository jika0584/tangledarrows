import React, { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

const COMBO_COLORS = [
  '#2FBF71',
  '#F4C430',
  '#FF6B45',
  '#7B4FD1',
  '#E45C9A',
  '#3DB8FF',
  '#F0544F',
] as const;

interface ComboBannerProps {
  /** Consecutive escapes within the live window; banners start at 2. */
  combo: number;
}

export function ComboBanner({ combo }: ComboBannerProps) {
  const translateX = useSharedValue(-48);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (combo < 2) {
      opacity.value = 0;
      return;
    }

    translateX.value = -48;
    opacity.value = 0;
    opacity.value = withTiming(1, { duration: 100 });
    translateX.value = withSequence(
      withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) }),
      withDelay(480, withTiming(56, { duration: 260, easing: Easing.in(Easing.cubic) })),
    );
    opacity.value = withDelay(
      700,
      withTiming(0, { duration: 220, easing: Easing.in(Easing.quad) }),
    );
  }, [combo, opacity, translateX]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: translateX.value }],
  }));

  if (combo < 2) return null;

  const color = COMBO_COLORS[(combo - 2) % COMBO_COLORS.length];
  const fontSize = Math.min(22, 15 + (combo - 2) * 1.5);
  const label = combo === 2 ? 'Combo' : `Combo x${combo}`;

  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, style]}>
      <Text
        style={[
          styles.label,
          {
            color,
            fontSize,
            lineHeight: fontSize + 4,
          },
        ]}
        accessibilityRole="text"
      >
        {label}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 10,
    left: 12,
    zIndex: 30,
  },
  label: {
    fontWeight: '700',
    letterSpacing: 0.5,
    opacity: 0.92,
  },
});
