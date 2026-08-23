import React, { useEffect, useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Canvas, Circle, Group, RoundedRect } from '@shopify/react-native-skia';
import {
  Easing,
  SharedValue,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '../theme/theme';

const CONFETTI_COLORS = [
  colors.arrowEscaping,
  colors.heart,
  colors.accent,
  colors.arrow,
  '#F4C430',
  '#FFFFFF',
  '#7B4FD1',
];

const FIREWORK_COLORS = ['#F4C430', '#FFFFFF', colors.heart, colors.arrowEscaping, '#7B4FD1'];

interface ConfettiSpec {
  x0: number;
  y0: number;
  vx: number;
  vy: number;
  gravity: number;
  spin: number;
  width: number;
  height: number;
  color: string;
}

interface SparkSpec {
  cx: number;
  cy: number;
  vx: number;
  vy: number;
  delay: number;
  life: number;
  radius: number;
  color: string;
}

interface WinCelebrationProps {
  active: boolean;
}

export function WinCelebration({ active }: WinCelebrationProps) {
  const { width, height } = useWindowDimensions();
  const confettiClock = useSharedValue(0);
  const fireworkClock = useSharedValue(0);

  const confetti = useMemo(() => makeConfetti(width, height), [width, height]);
  const sparks = useMemo(() => makeSparks(width, height), [width, height]);

  useEffect(() => {
    if (!active) {
      confettiClock.value = 0;
      fireworkClock.value = 0;
      return;
    }
    confettiClock.value = 0;
    confettiClock.value = withTiming(1, { duration: 3800, easing: Easing.linear });
    fireworkClock.value = 0;
    fireworkClock.value = withRepeat(
      withTiming(1, { duration: 2400, easing: Easing.linear }),
      -1,
      false,
    );
  }, [active, confettiClock, fireworkClock]);

  if (!active) return null;

  return (
    <View pointerEvents="none" style={styles.layer}>
      <Canvas style={StyleSheet.absoluteFill}>
        {confetti.map((piece, index) => (
          <ConfettiPiece key={`c${index}`} piece={piece} clock={confettiClock} duration={3.8} />
        ))}
        {sparks.map((spark, index) => (
          <SparkPiece key={`s${index}`} spark={spark} clock={fireworkClock} loopSeconds={2.4} />
        ))}
      </Canvas>
    </View>
  );
}

function ConfettiPiece({
  piece,
  clock,
  duration,
}: {
  piece: ConfettiSpec;
  clock: SharedValue<number>;
  duration: number;
}) {
  const transform = useDerivedValue(() => {
    const t = clock.value * duration;
    const x = piece.x0 + piece.vx * t;
    const y = piece.y0 + piece.vy * t + 0.5 * piece.gravity * t * t;
    const rot = piece.spin * t;
    return [{ translateX: x }, { translateY: y }, { rotate: rot }];
  });

  const opacity = useDerivedValue(() => {
    const t = clock.value;
    if (t < 0.08) return t / 0.08;
    if (t > 0.82) return Math.max(0, (1 - t) / 0.18);
    return 1;
  });

  return (
    <Group transform={transform} opacity={opacity}>
      <RoundedRect
        x={-piece.width / 2}
        y={-piece.height / 2}
        width={piece.width}
        height={piece.height}
        r={2}
        color={piece.color}
      />
    </Group>
  );
}

function SparkPiece({
  spark,
  clock,
  loopSeconds,
}: {
  spark: SparkSpec;
  clock: SharedValue<number>;
  loopSeconds: number;
}) {
  const transform = useDerivedValue(() => {
    const local = clock.value * loopSeconds - spark.delay;
    if (local < 0 || local > spark.life) {
      return [{ translateX: -9999 }, { translateY: -9999 }];
    }
    const x = spark.cx + spark.vx * local;
    const y = spark.cy + spark.vy * local;
    return [{ translateX: x }, { translateY: y }];
  });

  const opacity = useDerivedValue(() => {
    const local = clock.value * loopSeconds - spark.delay;
    if (local < 0 || local > spark.life) return 0;
    const fade = 1 - local / spark.life;
    return fade * fade;
  });

  const radius = useDerivedValue(() => {
    const local = Math.max(0, clock.value * loopSeconds - spark.delay);
    return spark.radius * (1 - (local / spark.life) * 0.45);
  });

  return (
    <Group transform={transform} opacity={opacity}>
      <Circle cx={0} cy={0} r={radius} color={spark.color} />
    </Group>
  );
}

function makeConfetti(width: number, height: number): ConfettiSpec[] {
  const cannons = [0.18, 0.5, 0.82];
  const pieces: ConfettiSpec[] = [];
  for (let i = 0; i < 72; i++) {
    const cannon = cannons[i % cannons.length];
    pieces.push({
      x0: width * cannon + rand(-36, 36),
      y0: height + 16,
      vx: rand(-220, 220),
      vy: rand(-980, -620),
      gravity: 920,
      spin: rand(-14, 14),
      width: rand(7, 16),
      height: rand(5, 11),
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    });
  }
  return pieces;
}

function makeSparks(width: number, height: number): SparkSpec[] {
  const bursts = [
    { x: width * 0.22, y: height * 0.28, delay: 0.1 },
    { x: width * 0.78, y: height * 0.22, delay: 0.45 },
    { x: width * 0.5, y: height * 0.18, delay: 0.75 },
    { x: width * 0.3, y: height * 0.38, delay: 1.15 },
    { x: width * 0.7, y: height * 0.34, delay: 1.5 },
    { x: width * 0.5, y: height * 0.3, delay: 1.9 },
  ];
  const sparks: SparkSpec[] = [];
  for (const burst of bursts) {
    const count = 18;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + rand(-0.12, 0.12);
      const speed = rand(140, 280);
      sparks.push({
        cx: burst.x,
        cy: burst.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        delay: burst.delay,
        life: 0.7,
        radius: rand(3.2, 6.4),
        color: FIREWORK_COLORS[i % FIREWORK_COLORS.length],
      });
    }
  }
  return sparks;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFill,
    zIndex: 40,
  },
});

