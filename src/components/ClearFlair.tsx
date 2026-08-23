import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { spacing, typography, useColors } from '../theme/theme';

interface ClearFlairProps {
  perfect: boolean;
  firstTry: boolean;
}

/**
 * Extra win flourishes above the result card: a zooming PERFECT stamp when the
 * board was cleared with no blocked taps, and a first-try line when hearts
 * were on and none were spent.
 */
export function ClearFlair({ perfect, firstTry }: ClearFlairProps) {
  const colors = useColors();
  const stampScale = useSharedValue(0.35);
  const stampRotate = useSharedValue(-18);

  useEffect(() => {
    if (!perfect) return;
    stampScale.value = 0.35;
    stampRotate.value = -18;
    stampScale.value = withSequence(
      withTiming(1.18, { duration: 420, easing: Easing.out(Easing.back) }),
      withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) }),
    );
    stampRotate.value = withTiming(0, { duration: 480, easing: Easing.out(Easing.cubic) });
  }, [perfect, stampRotate, stampScale]);

  const stampStyle = useAnimatedStyle(() => ({
    transform: [{ scale: stampScale.value }, { rotate: `${stampRotate.value}deg` }],
  }));

  if (!perfect && !firstTry) return null;

  return (
    <View pointerEvents="none" style={styles.layer}>
      {perfect ? (
        <Animated.View style={[styles.stampWrap, stampStyle]}>
          <Text
            style={[
              styles.perfect,
              { color: colors.arrowEscaping, textShadowColor: colors.arrowEscaping },
            ]}
          >
            PERFECT
          </Text>
        </Animated.View>
      ) : null}
      {firstTry ? (
        <Animated.View
          entering={FadeInDown.delay(perfect ? 380 : 80).duration(320)}
          style={styles.firstTryWrap}
        >
          <Text
            style={[
              styles.firstTry,
              {
                color: colors.accent,
                backgroundColor: colors.surface,
                shadowColor: colors.textPrimary,
              },
            ]}
          >
            Cleared on the first try
          </Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFill,
    zIndex: 45,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: '18%',
    gap: spacing.md,
  },
  stampWrap: {
    alignItems: 'center',
  },
  perfect: {
    fontSize: 52,
    fontWeight: '900',
    letterSpacing: 6,
    textAlign: 'center',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 16,
  },
  firstTryWrap: {
    marginTop: spacing.sm,
  },
  firstTry: {
    ...typography.heading,
    overflow: 'hidden',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    textAlign: 'center',
    elevation: 4,
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },
});
