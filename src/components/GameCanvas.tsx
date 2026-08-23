import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Canvas, Group, Path, Skia } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { ArrowDefinition, CELL_FLOOR, LevelGrid } from '../levels/types';
import { BoardLayout, buildGridDotsPath } from '../game/rendering/ArrowPath';
import {
  clampTranslation,
  clampZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_DAMPING,
} from '../game/rendering/Camera';
import { buildRulerGuides } from '../game/rendering/RulerGuides';
import { findTappedArrow } from '../game/engine/HitTest';
import { ArrowAnimation, ArrowShape } from './ArrowShape';
import { useColors } from '../theme/theme';

interface GameCanvasProps {
  grid: LevelGrid;
  arrows: ArrowDefinition[];
  layout: BoardLayout;
  width: number;
  height: number;
  animations: Record<string, ArrowAnimation>;
  failedArrowIds: ReadonlySet<string>;
  /** Idle colour for arrows still on the board (progress milestones). */
  arrowTint: string;
  rulerActive: boolean;
  onArrowTap: (arrowId: string) => void;
  onArrowAnimationEnd: (arrowId: string) => void;
}

export function GameCanvas({
  grid,
  arrows,
  layout,
  width,
  height,
  animations,
  failedArrowIds,
  arrowTint,
  rulerActive,
  onArrowTap,
  onArrowAnimationEnd,
}: GameCanvasProps) {
  const colors = useColors();
  const zoom = useSharedValue(1);
  const savedZoom = useSharedValue(1);

  // Pan and pinch-focal corrections are tracked separately so the two gestures
  // can run at the same time without overwriting each other's translation.
  const panX = useSharedValue(0);
  const panY = useSharedValue(0);
  const savedPanX = useSharedValue(0);
  const savedPanY = useSharedValue(0);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);

  // Snapshot of the camera at the moment a pinch starts.
  const pinchPanX = useSharedValue(0);
  const pinchPanY = useSharedValue(0);
  const pinchTotalX = useSharedValue(0);
  const pinchTotalY = useSharedValue(0);
  const pinchFocalX = useSharedValue(0);
  const pinchFocalY = useSharedValue(0);

  const originX = width / 2;
  const originY = height / 2;

  const boardWidth = grid.cols * layout.cellSize;
  const boardHeight = grid.rows * layout.cellSize;

  const gridDots = useMemo(
    () => buildGridDotsPath(grid.matrix, layout, CELL_FLOOR),
    [grid.matrix, layout],
  );

  const strokeWidth = Math.max(2, layout.cellSize * 0.17);

  const { guides, failed: failedGuides } = useMemo(
    () => buildRulerGuides(arrows, grid, layout, failedArrowIds),
    [arrows, grid, layout, failedArrowIds],
  );
  const emptyGuide = useMemo(() => Skia.Path.Make(), []);

  const handleTap = useCallback(
    (boardXValue: number, boardYValue: number, zoomValue: number) => {
      const arrow = findTappedArrow(boardXValue, boardYValue, arrows, layout, zoomValue, grid);
      if (arrow) onArrowTap(arrow.id);
    },
    [arrows, layout, onArrowTap, grid],
  );

  const pinch = Gesture.Pinch()
    .onStart((event) => {
      savedZoom.value = zoom.value;
      // Everything below is measured against the state at gesture start. Using
      // live values instead would feed each frame's correction back into the
      // next one, and the board would run away from the fingers.
      pinchPanX.value = panX.value;
      pinchPanY.value = panY.value;
      pinchTotalX.value = panX.value + focalX.value;
      pinchTotalY.value = panY.value + focalY.value;
      pinchFocalX.value = event.focalX - originX;
      pinchFocalY.value = event.focalY - originY;
    })
    .onUpdate((event) => {
      const next = clampZoom(savedZoom.value * Math.pow(event.scale, ZOOM_DAMPING));
      const ratio = next / savedZoom.value;

      // Pin the board point that sat under the fingers when the pinch began.
      // The anchor is deliberately fixed: letting it follow the fingers would
      // duplicate the translation the two-finger pan is already applying.
      const targetX = pinchFocalX.value - ratio * (pinchFocalX.value - pinchTotalX.value);
      const targetY = pinchFocalY.value - ratio * (pinchFocalY.value - pinchTotalY.value);

      const clampedX = clampTranslation(targetX, next, width, boardWidth);
      const clampedY = clampTranslation(targetY, next, height, boardHeight);
      focalX.value = clampedX - pinchPanX.value;
      focalY.value = clampedY - pinchPanY.value;
      zoom.value = next;
    })
    .onFinalize(() => {
      panX.value = clampTranslation(panX.value + focalX.value, zoom.value, width, boardWidth);
      panY.value = clampTranslation(panY.value + focalY.value, zoom.value, height, boardHeight);
      focalX.value = 0;
      focalY.value = 0;
    });

  const pan = Gesture.Pan()
    // One finger is enough to scroll the board. The activation distance keeps
    // taps intact: a press that never travels that far stays a tap.
    .minPointers(1)
    .minDistance(PAN_ACTIVATION_DISTANCE)
    .averageTouches(true)
    .onStart(() => {
      savedPanX.value = panX.value;
      savedPanY.value = panY.value;
    })
    .onUpdate((event) => {
      panX.value = clampTranslation(
        savedPanX.value + event.translationX,
        zoom.value,
        width,
        boardWidth,
      );
      panY.value = clampTranslation(
        savedPanY.value + event.translationY,
        zoom.value,
        height,
        boardHeight,
      );
    });

  const tap = Gesture.Tap()
    .numberOfTaps(1)
    .maxDuration(500)
    // Kept below the pan activation distance so a drag can never also be a tap.
    .maxDistance(PAN_ACTIVATION_DISTANCE - 2)
    .onEnd((event) => {
      const tx = clampTranslation(panX.value + focalX.value, zoom.value, width, boardWidth);
      const ty = clampTranslation(panY.value + focalY.value, zoom.value, height, boardHeight);
      const boardXValue = originX + (event.x - originX - tx) / zoom.value;
      const boardYValue = originY + (event.y - originY - ty) / zoom.value;
      runOnJS(handleTap)(boardXValue, boardYValue, zoom.value);
    });

  // Taps resolve immediately. There is no double-tap recogniser to lose a race
  // against, so a quick second tap registers as a second move rather than being
  // swallowed while the gesture system waits to see what follows.
  const gesture = Gesture.Simultaneous(pinch, pan, tap);

  // Clamping here rather than per-gesture means no combination of pinch and pan
  // can strand the board off screen.
  const transform = useDerivedValue(() => [
    {
      translateX: clampTranslation(panX.value + focalX.value, zoom.value, width, boardWidth),
    },
    {
      translateY: clampTranslation(panY.value + focalY.value, zoom.value, height, boardHeight),
    },
    { scale: zoom.value },
  ]);

  const origin = useMemo(() => ({ x: originX, y: originY }), [originX, originY]);

  // Counter-scaled so the guides stay hairline-thin however far you zoom in.
  const guideStrokeWidth = useDerivedValue(() => 1 / zoom.value);

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.container} collapsable={false}>
        <Canvas style={StyleSheet.absoluteFill}>
          <Group transform={transform} origin={origin}>
            <Path path={gridDots} style="fill" color={colors.gridDot} />
            {/* Always mounted under the arrows so toggling the ruler cannot
                register these paths after the arrows and paint them on top. */}
            <Path
              path={rulerActive ? guides : emptyGuide}
              style="stroke"
              strokeWidth={guideStrokeWidth}
              color={colors.rulerGuide}
            />
            <Path
              path={rulerActive && failedGuides ? failedGuides : emptyGuide}
              style="stroke"
              strokeWidth={guideStrokeWidth}
              color={colors.rulerBlocked}
            />
            {arrows.map((arrow) => (
              <ArrowShape
                key={arrow.id}
                arrow={arrow}
                layout={layout}
                grid={grid}
                strokeWidth={strokeWidth}
                animation={animations[arrow.id] ?? IDLE}
                failed={failedArrowIds.has(arrow.id)}
                baseTint={arrowTint}
                onAnimationComplete={onArrowAnimationEnd}
              />
            ))}
          </Group>
        </Canvas>
      </View>
    </GestureDetector>
  );
}

const IDLE: ArrowAnimation = { kind: 'idle' };

/**
 * How far a finger must travel before it counts as a drag rather than a tap.
 * Comfortably above the tap's own tolerance so the two never fight.
 */
const PAN_ACTIVATION_DISTANCE = 14;

export { MAX_ZOOM, MIN_ZOOM };

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
});
