import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Canvas, Group, Path } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { ArrowDefinition, CELL_FLOOR, LevelGrid } from '../levels/types';
import { BoardLayout, buildBoardShapePath } from '../game/rendering/ArrowPath';
import { clampTranslation, clampZoom, MAX_ZOOM, MIN_ZOOM } from '../game/rendering/Camera';
import { findTappedArrow } from '../game/engine/HitTest';
import { ArrowAnimation, ArrowShape } from './ArrowShape';
import { colors } from '../theme/theme';

interface GameCanvasProps {
  grid: LevelGrid;
  arrows: ArrowDefinition[];
  layout: BoardLayout;
  width: number;
  height: number;
  animations: Record<string, ArrowAnimation>;
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
  onArrowTap,
  onArrowAnimationEnd,
}: GameCanvasProps) {
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

  const originX = width / 2;
  const originY = height / 2;

  const boardWidth = grid.cols * layout.cellSize;
  const boardHeight = grid.rows * layout.cellSize;

  const boardShape = useMemo(
    () => buildBoardShapePath(grid.matrix, layout, CELL_FLOOR),
    [grid.matrix, layout],
  );

  const strokeWidth = Math.max(3, layout.cellSize * 0.28);

  const handleTap = useCallback(
    (boardXValue: number, boardYValue: number, zoomValue: number) => {
      const arrow = findTappedArrow(boardXValue, boardYValue, arrows, layout, zoomValue);
      if (arrow) onArrowTap(arrow.id);
    },
    [arrows, layout, onArrowTap],
  );

  const pinch = Gesture.Pinch()
    .onStart(() => {
      savedZoom.value = zoom.value;
    })
    .onUpdate((event) => {
      const next = clampZoom(savedZoom.value * event.scale);
      const ratio = next / savedZoom.value;

      // Keep the board point under the fingers pinned while scaling.
      const totalX = panX.value + focalX.value;
      const totalY = panY.value + focalY.value;
      const fx = event.focalX - originX;
      const fy = event.focalY - originY;

      focalX.value = fx - ratio * (fx - totalX) - panX.value;
      focalY.value = fy - ratio * (fy - totalY) - panY.value;
      zoom.value = next;
    });

  const pan = Gesture.Pan()
    .minPointers(2)
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

  // Double tap toggles between fitted and magnified views for low-dexterity use.
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(320)
    .onEnd(() => {
      const target = zoom.value > 1.4 ? 1 : 2;
      zoom.value = withTiming(target, { duration: 220 });
      if (target === 1) {
        panX.value = withTiming(0, { duration: 220 });
        panY.value = withTiming(0, { duration: 220 });
        focalX.value = withTiming(0, { duration: 220 });
        focalY.value = withTiming(0, { duration: 220 });
      }
    });

  const tap = Gesture.Tap()
    .numberOfTaps(1)
    .maxDuration(500)
    .maxDistance(28)
    .onEnd((event) => {
      const tx = panX.value + focalX.value;
      const ty = panY.value + focalY.value;
      const boardXValue = originX + (event.x - originX - tx) / zoom.value;
      const boardYValue = originY + (event.y - originY - ty) / zoom.value;
      runOnJS(handleTap)(boardXValue, boardYValue, zoom.value);
    });

  const gesture = Gesture.Simultaneous(
    pinch,
    pan,
    Gesture.Exclusive(doubleTap, tap),
  );

  const transform = useDerivedValue(() => [
    { translateX: panX.value + focalX.value },
    { translateY: panY.value + focalY.value },
    { scale: zoom.value },
  ]);

  const origin = useMemo(() => ({ x: originX, y: originY }), [originX, originY]);

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.container} collapsable={false}>
        <Canvas style={StyleSheet.absoluteFill}>
          <Group transform={transform} origin={origin}>
            <Path path={boardShape} style="fill" color={colors.boardShape} />
            {arrows.map((arrow) => (
              <ArrowShape
                key={arrow.id}
                arrow={arrow}
                layout={layout}
                strokeWidth={strokeWidth}
                animation={animations[arrow.id] ?? IDLE}
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

export { MAX_ZOOM, MIN_ZOOM };

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
});
