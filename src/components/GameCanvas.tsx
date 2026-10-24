import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Canvas, Circle, Group, Path, Skia } from "@shopify/react-native-skia";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  FadeOut,
  ZoomIn,
  runOnJS,
  useDerivedValue,
  useSharedValue,
} from "react-native-reanimated";
import { ArrowDefinition, CELL_FLOOR, LevelGrid } from "../levels/types";
import { BoardLayout, buildGridDotsPath } from "../game/rendering/ArrowPath";
import {
  clampTranslation,
  clampZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_DAMPING,
} from "../game/rendering/Camera";
import { buildRulerGuides } from "../game/rendering/RulerGuides";
import {
  escapableArrows,
  findTappedArrow,
  HEAD_PADDING,
  headTip,
  TAIL_PADDING,
  TAP_ZONE_RADIUS,
} from "../game/engine/HitTest";
import { useSettingsStore } from "../store/settingsStore";
import { ArrowAnimation, ArrowShape } from "./ArrowShape";
import { useColors } from "../theme/theme";

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
  const devMode = useSettingsStore((state) => state.devMode);
  const tapZoneSize = useSettingsStore((state) => state.tapZoneSize);
  const headPadding = useSettingsStore((state) => state.headPadding);
  const tailPadding = useSettingsStore((state) => state.tailPadding);
  const showPadding = useSettingsStore((state) => state.showPadding);
  const [tapMark, setTapMark] = useState<{ id: number; x: number; y: number } | null>(
    null,
  );
  const zoom = useSharedValue(1);
  const savedZoom = useSharedValue(1);

  // Pan and pinch-focal corrections are tracked separately so the two gestures
  // can run at the same time without overwriting each other's translation.
  const panX = useSharedValue(0);
  const panY = useSharedValue(0);
  const savedPanX = useSharedValue(0);
  const savedPanY = useSharedValue(0);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);
  const panPointers = useSharedValue(0);
  // RN locationX/Y, which follow a parent rotate(). 0/0 is a real point, so a
  // separate flag records whether a sample has arrived this press.
  const touchX = useSharedValue(0);
  const touchY = useSharedValue(0);
  const touchSeen = useSharedValue(0);
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
  const paddingMarks = useMemo(() => {
    if (!devMode || !showPadding) return [];
    const headExtra = HEAD_PADDING[headPadding] * layout.cellSize;
    const tailExtra = TAIL_PADDING[tailPadding] * layout.cellSize;
    return escapableArrows(arrows, grid).map((arrow) => {
      const tip = headTip(arrow, layout);
      const head = arrow.cells[arrow.cells.length - 1];
      const tails = arrow.cells
        .filter((cell) => cell.row !== head.row || cell.col !== head.col)
        .map((cell) => ({
          x: layout.originX + (cell.col + 0.5) * layout.cellSize,
          y: layout.originY + (cell.row + 0.5) * layout.cellSize,
          r: layout.cellSize * 0.5 + tailExtra,
        }));
      return {
        id: arrow.id,
        tipX: tip.x,
        tipY: tip.y,
        tipR: layout.cellSize * 0.42 + headExtra,
        tails,
      };
    });
  }, [arrows, grid, layout, devMode, showPadding, headPadding, tailPadding]);

  const handleTap = useCallback(
    (
      viewX: number,
      viewY: number,
      boardXValue: number,
      boardYValue: number,
      zoomValue: number,
    ) => {
      if (devMode) {
        setTapMark({ id: Date.now(), x: viewX, y: viewY });
      }
      const arrow = findTappedArrow(
        boardXValue,
        boardYValue,
        arrows,
        layout,
        zoomValue,
        grid,
        devMode ? { headPadding, tailPadding } : undefined,
      );
      if (arrow) onArrowTap(arrow.id);
    },
    [arrows, layout, onArrowTap, grid, devMode, headPadding, tailPadding],
  );

  useEffect(() => {
    if (!tapMark) return;
    const id = tapMark.id;
    const timer = setTimeout(() => {
      setTapMark((current) => (current?.id === id ? null : current));
    }, 900);
    return () => clearTimeout(timer);
  }, [tapMark]);

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
      const next = clampZoom(
        savedZoom.value * Math.pow(event.scale, ZOOM_DAMPING),
      );
      const ratio = next / savedZoom.value;

      // Pin the board point that sat under the fingers when the pinch began.
      // The anchor is deliberately fixed: letting it follow the fingers would
      // duplicate the translation the two-finger pan is already applying.
      const targetX =
        pinchFocalX.value - ratio * (pinchFocalX.value - pinchTotalX.value);
      const targetY =
        pinchFocalY.value - ratio * (pinchFocalY.value - pinchTotalY.value);

      const clampedX = clampTranslation(targetX, next, width, boardWidth);
      const clampedY = clampTranslation(targetY, next, height, boardHeight);
      focalX.value = clampedX - pinchPanX.value;
      focalY.value = clampedY - pinchPanY.value;
      zoom.value = next;
    })
    .onFinalize(() => {
      panX.value = clampTranslation(
        panX.value + focalX.value,
        zoom.value,
        width,
        boardWidth,
      );
      panY.value = clampTranslation(
        panY.value + focalY.value,
        zoom.value,
        height,
        boardHeight,
      );
      focalX.value = 0;
      focalY.value = 0;
    });

  const pan = Gesture.Pan()
    // One finger is enough to scroll the board. The activation distance keeps
    // taps intact: a press that never travels that far stays a tap.
    .minPointers(1)
    .minDistance(PAN_ACTIVATION_DISTANCE)
    .averageTouches(true)
    .onStart((event) => {
      savedPanX.value = panX.value;
      savedPanY.value = panY.value;
      panStartX.value = event.x;
      panStartY.value = event.y;
      panPointers.value = event.numberOfPointers;
    })
    .onUpdate((event) => {
      // event.x/y are averaged across the pointers, so putting a second finger
      // down for a pinch teleports them to the midpoint. Re-anchor on the new
      // average instead of reading that as a drag.
      if (event.numberOfPointers !== panPointers.value) {
        panPointers.value = event.numberOfPointers;
        savedPanX.value = panX.value;
        savedPanY.value = panY.value;
        panStartX.value = event.x;
        panStartY.value = event.y;
        return;
      }

      // Deliberately not event.translationX/Y: those are measured on the raw
      // touch stream, so they ignore any rotation applied to an ancestor and
      // the axes come out swapped once the board is turned. event.x/y are
      // resolved against this view, so they follow the board either way.
      const dx = event.x - panStartX.value;
      const dy = event.y - panStartY.value;
      panX.value = clampTranslation(
        savedPanX.value + dx,
        zoom.value,
        width,
        boardWidth,
      );
      panY.value = clampTranslation(
        savedPanY.value + dy,
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
      const tx = clampTranslation(
        panX.value + focalX.value,
        zoom.value,
        width,
        boardWidth,
      );
      const ty = clampTranslation(
        panY.value + focalY.value,
        zoom.value,
        height,
        boardHeight,
      );
      // Prefer the view-local sample captured on the RN responder. Gesture
      // Handler's event.x/y ignore a parent rotation, which is how landscape
      // taps land a cell away from the finger.
      const viewX = touchSeen.value ? touchX.value : event.x;
      const viewY = touchSeen.value ? touchY.value : event.y;
      const boardXValue = originX + (viewX - originX - tx) / zoom.value;
      const boardYValue = originY + (viewY - originY - ty) / zoom.value;
      runOnJS(handleTap)(viewX, viewY, boardXValue, boardYValue, zoom.value);
    });

  // Taps resolve immediately. There is no double-tap recogniser to lose a race
  // against, so a quick second tap registers as a second move rather than being
  // swallowed while the gesture system waits to see what follows.
  const gesture = Gesture.Simultaneous(pinch, pan, tap);

  // Clamping here rather than per-gesture means no combination of pinch and pan
  // can strand the board off screen.
  const transform = useDerivedValue(() => [
    {
      translateX: clampTranslation(
        panX.value + focalX.value,
        zoom.value,
        width,
        boardWidth,
      ),
    },
    {
      translateY: clampTranslation(
        panY.value + focalY.value,
        zoom.value,
        height,
        boardHeight,
      ),
    },
    { scale: zoom.value },
  ]);

  const origin = useMemo(
    () => ({ x: originX, y: originY }),
    [originX, originY],
  );

  // Counter-scaled so the guides stay hairline-thin however far you zoom in.
  const guideStrokeWidth = useDerivedValue(() => 1 / zoom.value);

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={styles.container}
        collapsable={false}
        onTouchStart={(event) => {
          touchX.value = event.nativeEvent.locationX;
          touchY.value = event.nativeEvent.locationY;
          touchSeen.value = 1;
        }}
        onTouchMove={(event) => {
          touchX.value = event.nativeEvent.locationX;
          touchY.value = event.nativeEvent.locationY;
        }}
        onTouchEnd={(event) => {
          touchX.value = event.nativeEvent.locationX;
          touchY.value = event.nativeEvent.locationY;
        }}
      >
        <Canvas style={StyleSheet.absoluteFill}>
          <Group transform={transform} origin={origin}>
            <Path path={gridDots} style="fill" color={colors.gridDot} />
            {paddingMarks.map((mark) => (
              <Group key={mark.id}>
                <Circle
                  cx={mark.tipX}
                  cy={mark.tipY}
                  r={mark.tipR}
                  color={PADDING_HALO}
                />
                {mark.tails.map((tail, index) => (
                  <Circle
                    key={`${mark.id}-t${index}`}
                    cx={tail.x}
                    cy={tail.y}
                    r={tail.r}
                    color={PADDING_HALO}
                  />
                ))}
              </Group>
            ))}
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
        {devMode && tapMark ? (
          <Animated.View
            key={tapMark.id}
            pointerEvents="none"
            entering={ZoomIn.duration(90)}
            exiting={FadeOut.duration(420)}
            style={[
              styles.tapMark,
              {
                width: TAP_ZONE_RADIUS[tapZoneSize] * 2,
                height: TAP_ZONE_RADIUS[tapZoneSize] * 2,
                borderRadius: TAP_ZONE_RADIUS[tapZoneSize],
                left: tapMark.x - TAP_ZONE_RADIUS[tapZoneSize],
                top: tapMark.y - TAP_ZONE_RADIUS[tapZoneSize],
              },
            ]}
          />
        ) : null}
      </View>
    </GestureDetector>
  );
}

const IDLE: ArrowAnimation = { kind: "idle" };

/**
 * How far a finger must travel before it counts as a drag rather than a tap.
 * Comfortably above the tap's own tolerance so the two never fight.
 */
const PAN_ACTIVATION_DISTANCE = 14;
const PADDING_HALO = "rgba(61, 184, 255, 0.22)";
const TAP_HALO = "rgba(47, 191, 113, 0.28)";
const TAP_HALO_EDGE = "rgba(47, 191, 113, 0.7)";

export { MAX_ZOOM, MIN_ZOOM };

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: "hidden",
  },
  tapMark: {
    position: "absolute",
    borderWidth: 2,
    borderColor: TAP_HALO_EDGE,
    backgroundColor: TAP_HALO,
  },
});
