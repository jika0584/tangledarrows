import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Group, Path } from '@shopify/react-native-skia';
import {
  Easing,
  runOnJS,
  useDerivedValue,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { ArrowDefinition, LevelGrid } from '../levels/types';
import { BoardLayout, buildArrowGeometry, posTanAt } from '../game/rendering/ArrowPath';
import { recoilOutDurationMs, RECOIL_BACK_MS, slideDurationMs } from '../game/rendering/slideTiming';
import { useColors } from '../theme/theme';

/**
 * How far a blocked arrow noses into the obstacle before springing back.
 * Generous on purpose: this bump and the lasting red mark are the only
 * signals that a move cost a life, and on a dense board the cells are small.
 */
const RECOIL_OVERSHOOT_CELLS = 0.6;

export type ArrowAnimation =
  | { kind: 'idle' }
  | { kind: 'escape'; distance: number; token: number }
  | { kind: 'recoil'; distance: number; token: number };

interface ArrowShapeProps {
  arrow: ArrowDefinition;
  layout: BoardLayout;
  grid: LevelGrid;
  animation: ArrowAnimation;
  /** True after a blocked tap; the arrow stays red so the mistake is readable. */
  failed?: boolean;
  /** Idle arrow colour; shifts at 50% / 33% / 10% remaining. */
  baseTint?: string;
  strokeWidth: number;
  onAnimationComplete?: (arrowId: string) => void;
}

function ArrowShapeComponent({
  arrow,
  layout,
  grid,
  animation,
  failed = false,
  baseTint,
  strokeWidth,
  onAnimationComplete,
}: ArrowShapeProps) {
  const colors = useColors();
  const idleTint = baseTint ?? colors.arrow;
  const geometry = useMemo(
    () => buildArrowGeometry(arrow, layout, grid),
    [arrow, layout, grid],
  );

  const { xs, ys, cumulative, bodyLength, totalLength, headInset } = geometry;

  /** Distance travelled along the path, in pixels. */
  const travelled = useSharedValue(0);

  // Held in a ref so a new callback identity from the parent can never restart
  // an animation that is already in flight.
  const completeRef = useRef(onAnimationComplete);
  completeRef.current = onAnimationComplete;

  const arrowId = arrow.id;
  const notifyComplete = useCallback(() => {
    completeRef.current?.(arrowId);
  }, [arrowId]);

  const cellSize = layout.cellSize;

  useEffect(() => {
    if (animation.kind === 'idle') {
      travelled.value = 0;
      return;
    }

    if (animation.kind === 'escape') {
      const target = Math.min(animation.distance * cellSize, totalLength - bodyLength);
      travelled.value = withTiming(
        target,
        {
          duration: slideDurationMs(animation.distance),
          // Quad-in: up to speed fast, then a short zip off the board.
          easing: Easing.in(Easing.quad),
        },
        (finished) => {
          'worklet';
          if (finished) runOnJS(notifyComplete)();
        },
      );
      return;
    }

    // Blocked: run into the obstacle, then spring back to the start.
    const free = Math.max(animation.distance, 0);
    const bump = (free + RECOIL_OVERSHOOT_CELLS) * cellSize;

    travelled.value = withSequence(
      withTiming(bump, {
        duration: recoilOutDurationMs(free),
        easing: Easing.out(Easing.quad),
      }),
      // Deliberately non-overshooting: an elastic settle would pull the arrow
      // back past its own tail.
      withTiming(0, { duration: RECOIL_BACK_MS, easing: Easing.in(Easing.quad) }, (finished) => {
        'worklet';
        if (finished) runOnJS(notifyComplete)();
      }),
    );
  }, [animation, notifyComplete, travelled, cellSize, totalLength, bodyLength]);

  // The visible shaft is a fixed-length window sliding along the travel path.
  const start = useDerivedValue(() => {
    const value = travelled.value / totalLength;
    return value < 0 ? 0 : value > 1 ? 1 : value;
  });

  const end = useDerivedValue(() => {
    const value = (bodyLength + travelled.value - headInset) / totalLength;
    return value < 0 ? 0 : value > 1 ? 1 : value;
  });

  const headTransform = useDerivedValue(() => {
    const { x, y, angle } = posTanAt(xs, ys, cumulative, bodyLength + travelled.value);
    return [{ translateX: x }, { translateY: y }, { rotate: angle }];
  });

  const color =
    animation.kind === 'escape'
      ? colors.arrowEscaping
      : animation.kind === 'recoil' || failed
        ? colors.arrowBlocked
        : idleTint;

  return (
    <Group>
      <Path
        path={geometry.travelPath}
        start={start}
        end={end}
        style="stroke"
        strokeWidth={strokeWidth}
        strokeCap="round"
        strokeJoin="round"
        color={color}
      />
      <Group transform={headTransform}>
        <Path path={geometry.headPath} style="fill" color={color} />
      </Group>
    </Group>
  );
}

export const ArrowShape = React.memo(ArrowShapeComponent);
