import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Group, Path } from '@shopify/react-native-skia';
import {
  Easing,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { ArrowDefinition, DIRECTION_DELTA } from '../levels/types';
import { BoardLayout, buildHeadPath, buildShaftPath } from '../game/rendering/ArrowPath';
import { colors } from '../theme/theme';

/** Slide speed in milliseconds per cell — tuned to feel instant but readable. */
const MS_PER_CELL = 26;
const MIN_SLIDE_MS = 130;
const RECOIL_MS = 90;

export type ArrowAnimation =
  | { kind: 'idle' }
  | { kind: 'escape'; distance: number; token: number }
  | { kind: 'recoil'; distance: number; token: number };

interface ArrowShapeProps {
  arrow: ArrowDefinition;
  layout: BoardLayout;
  animation: ArrowAnimation;
  strokeWidth: number;
  onAnimationComplete?: (arrowId: string) => void;
}

function ArrowShapeComponent({
  arrow,
  layout,
  animation,
  strokeWidth,
  onAnimationComplete,
}: ArrowShapeProps) {
  const shaft = useMemo(() => buildShaftPath(arrow, layout), [arrow, layout]);
  const head = useMemo(() => buildHeadPath(arrow, layout), [arrow, layout]);

  // Cells travelled, animated on the UI thread.
  const progress = useSharedValue(0);
  const blockedFlash = useSharedValue(0);

  // Held in a ref so a new callback identity from the parent can never restart
  // an animation that is already in flight.
  const completeRef = useRef(onAnimationComplete);
  completeRef.current = onAnimationComplete;

  const arrowId = arrow.id;

  const notifyComplete = useCallback(() => {
    completeRef.current?.(arrowId);
  }, [arrowId]);

  useEffect(() => {
    if (animation.kind === 'idle') {
      progress.value = 0;
      blockedFlash.value = 0;
      return;
    }

    if (animation.kind === 'escape') {
      const duration = Math.max(MIN_SLIDE_MS, animation.distance * MS_PER_CELL);
      progress.value = withTiming(
        animation.distance,
        { duration, easing: Easing.in(Easing.cubic) },
        (finished) => {
          'worklet';
          if (finished) runOnJS(notifyComplete)();
        },
      );
      return;
    }

    // Blocked: travel the clear distance, bump the obstacle, then settle back.
    const travel = Math.max(animation.distance, 0);
    const bump = travel + 0.35;
    const outDuration = Math.max(MIN_SLIDE_MS * 0.6, travel * MS_PER_CELL);
    const backDuration = RECOIL_MS * 2;

    blockedFlash.value = withSequence(
      withTiming(1, { duration: RECOIL_MS }),
      withTiming(0, { duration: backDuration }),
    );

    progress.value = withSequence(
      withTiming(bump, { duration: outDuration, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: backDuration, easing: Easing.elastic(1.1) }, (finished) => {
        'worklet';
        if (finished) runOnJS(notifyComplete)();
      }),
    );
  }, [animation, notifyComplete, progress, blockedFlash]);

  const delta = DIRECTION_DELTA[arrow.direction];

  const transform = useDerivedValue(() => [
    { translateX: delta.col * progress.value * layout.cellSize },
    { translateY: delta.row * progress.value * layout.cellSize },
  ]);

  const strokeColor = useDerivedValue(() =>
    blockedFlash.value > 0.5 ? colors.arrowBlocked : colors.arrow,
  );

  return (
    <Group transform={transform}>
      <Path
        path={shaft}
        style="stroke"
        strokeWidth={strokeWidth}
        strokeCap="round"
        strokeJoin="round"
        color={strokeColor}
      />
      <Path path={head} style="fill" color={strokeColor} />
    </Group>
  );
}

export const ArrowShape = React.memo(ArrowShapeComponent);
