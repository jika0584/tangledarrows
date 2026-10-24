import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface DigitWheelTotalProps {
  value: number;
  active: boolean;
  color: string;
  /** How long digits scramble before locking to the real score. */
  settleMs?: number;
}

/**
 * Slot-machine total: digits spin rapidly from the first frame, then lock
 * onto the real score (no empty gap while waiting).
 */
export function DigitWheelTotal({
  value,
  active,
  color,
  settleMs = 1100,
}: DigitWheelTotalProps) {
  const targetDigits = useMemo(() => String(Math.max(0, Math.floor(value))).split(''), [value]);
  const [scramble, setScramble] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!active) {
      setScramble(true);
      return;
    }
    setScramble(true);
    const settle = setTimeout(() => setScramble(false), settleMs);
    return () => clearTimeout(settle);
  }, [active, value, settleMs]);

  useEffect(() => {
    if (!active || !scramble) return;
    const id = setInterval(() => setTick((n) => n + 1), 40);
    return () => clearInterval(id);
  }, [active, scramble]);

  return (
    <View style={styles.wrap} accessibilityLabel={`Total score ${value}`}>
      {targetDigits.map((digit, index) => {
        const shown = scramble ? String((tick * 3 + index * 7 + digit.charCodeAt(0)) % 10) : digit;
        return (
          <Text key={`${index}-${targetDigits.length}`} style={[styles.digit, { color }]}>
            {shown}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minHeight: 62,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  digit: {
    fontSize: 56,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    lineHeight: 62,
    width: 34,
    textAlign: 'center',
  },
});
