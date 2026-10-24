import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MIN_TOUCH_TARGET, useColors } from '../theme/theme';

interface RotateToggleProps {
  landscape: boolean;
  onToggle: () => void;
}

/**
 * Floating portrait/landscape switch, mirroring the ruler toggle on the
 * opposite corner. Filled while the board is rotated.
 */
export function RotateToggle({ landscape, onToggle }: RotateToggleProps) {
  const colors = useColors();
  const tint = landscape ? colors.onAccent : colors.arrow;

  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityState={{ checked: landscape }}
      accessibilityLabel="Rotate screen"
      accessibilityHint={
        landscape ? 'Switches the board back to portrait' : 'Turns the board to landscape'
      }
      hitSlop={12}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: landscape ? colors.rulerActive : colors.rulerInactive },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.icon}>
        {/* The screen outline flips with the state, so the button shows what
            tapping it will do rather than just naming the action. */}
        <View
          style={[
            styles.screen,
            landscape ? styles.screenLandscape : styles.screenPortrait,
            { borderColor: tint },
          ]}
        />
        <Text style={[styles.arrow, { color: tint }]}>⟳</Text>
      </View>
    </Pressable>
  );
}

const SIZE = Math.max(MIN_TOUCH_TARGET + 8, 56);

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    left: 16,
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
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  screen: {
    borderWidth: 2,
    borderRadius: 3,
  },
  screenPortrait: {
    width: 15,
    height: 22,
  },
  screenLandscape: {
    width: 22,
    height: 15,
  },
  arrow: {
    position: 'absolute',
    right: -3,
    top: -4,
    fontSize: 15,
    fontWeight: '700',
  },
});
