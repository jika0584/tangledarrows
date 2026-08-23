import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { MIN_TOUCH_TARGET, useColors } from '../theme/theme';

interface RulerToggleProps {
  active: boolean;
  onToggle: () => void;
}

/**
 * Floating toggle for the straight-edge overlay.
 *
 * Filling the button when active gives the state at a glance without a label,
 * which keeps the board uncluttered.
 */
export function RulerToggle({ active, onToggle }: RulerToggleProps) {
  const colors = useColors();

  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityState={{ checked: active }}
      accessibilityLabel="Ruler guides"
      accessibilityHint="Shows a guide line along every arrow that has a clear path out"
      hitSlop={12}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: active ? colors.rulerActive : colors.rulerInactive },
        pressed && styles.pressed,
      ]}
    >
      <RulerIcon active={active} />
    </Pressable>
  );
}

/** A set square: a right triangle with tick marks along its hypotenuse. */
function RulerIcon({ active }: { active: boolean }) {
  const colors = useColors();
  const tint = active ? colors.onAccent : colors.arrow;

  return (
    <View style={styles.icon}>
      <View style={[styles.triangle, { borderLeftColor: tint }]} />
      <View style={[styles.tick, styles.tickOne, { backgroundColor: tint }]} />
      <View style={[styles.tick, styles.tickTwo, { backgroundColor: tint }]} />
      <View style={[styles.tick, styles.tickThree, { backgroundColor: tint }]} />
    </View>
  );
}

const SIZE = Math.max(MIN_TOUCH_TARGET + 8, 56);

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#123543',
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  pressed: {
    opacity: 0.75,
  },
  icon: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  triangle: {
    width: 0,
    height: 0,
    borderTopWidth: 22,
    borderTopColor: 'transparent',
    borderLeftWidth: 22,
  },
  tick: {
    position: 'absolute',
    width: 2,
    height: 5,
    borderRadius: 1,
    transform: [{ rotate: '45deg' }],
  },
  tickOne: {
    left: 6,
    top: 9,
  },
  tickTwo: {
    left: 10,
    top: 5,
  },
  tickThree: {
    left: 14,
    top: 1,
  },
});
