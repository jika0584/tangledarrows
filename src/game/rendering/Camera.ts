import { LevelGrid } from '../../levels/types';
import { BoardLayout } from './ArrowPath';

export const MIN_ZOOM = 0.6;
export const MAX_ZOOM = 4;

export interface Viewport {
  width: number;
  height: number;
}

/**
 * Computes a board layout that fits the grid inside the viewport with padding.
 * Cell size is generous by default so tap targets stay large when zoomed out.
 */
export function fitBoardToViewport(
  grid: LevelGrid,
  viewport: Viewport,
  padding = 24,
): BoardLayout {
  const usableWidth = Math.max(1, viewport.width - padding * 2);
  const usableHeight = Math.max(1, viewport.height - padding * 2);

  const cellSize = Math.max(
    8,
    Math.min(usableWidth / grid.cols, usableHeight / grid.rows),
  );

  const boardWidth = cellSize * grid.cols;
  const boardHeight = cellSize * grid.rows;

  return {
    cellSize,
    originX: (viewport.width - boardWidth) / 2,
    originY: (viewport.height - boardHeight) / 2,
  };
}

export function clampZoom(value: number): number {
  'worklet';
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

/**
 * Keeps the board from being panned entirely off-screen. Allows generous
 * overscroll at high zoom so edges of large boards remain reachable.
 */
export function clampTranslation(
  value: number,
  zoom: number,
  viewportExtent: number,
  boardExtent: number,
): number {
  'worklet';
  const scaledExtent = boardExtent * zoom;
  const slack = Math.max(viewportExtent * 0.5, (scaledExtent - viewportExtent) / 2 + viewportExtent * 0.25);
  return Math.min(slack, Math.max(-slack, value));
}

/** Converts a screen point into board space, undoing pan and zoom. */
export function screenToBoard(
  screenX: number,
  screenY: number,
  zoom: number,
  translateX: number,
  translateY: number,
  focalX: number,
  focalY: number,
): { x: number; y: number } {
  'worklet';
  return {
    x: (screenX - translateX - focalX) / zoom + focalX,
    y: (screenY - translateY - focalY) / zoom + focalY,
  };
}
