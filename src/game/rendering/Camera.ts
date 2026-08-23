import { LevelGrid } from '../../levels/types';
import { BoardLayout } from './ArrowPath';

/** How far out pinch can go. 1 = whole board fitted; lower = smaller on screen. */
export const MIN_ZOOM = 0.22;

/**
 * Zoom 1 fits the whole board on screen, so the ceiling has to cover the
 * largest boards: a 60-wide grid fitted to a phone leaves cells a few pixels
 * across, and the player needs to get close enough to read and tap one.
 */
export const MAX_ZOOM = 9;

/**
 * Pinch scale is raised to this power before being applied. Below 1 it damps
 * the gesture, so a given finger spread changes the zoom less than the raw
 * ratio would — the difference between "twitchy" and "controllable".
 */
export const ZOOM_DAMPING = 0.8;

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
 * How much of the viewport must still show the board. The rest of the puzzle
 * may sit off that edge so a pinch on the rim can stay under the fingers.
 */
const EDGE_KEEP = 0.1;

/**
 * Lets the board travel until only a thin strip remains on screen. That is
 * enough to zoom and pan at the rim without the camera yanking the puzzle
 * back toward the centre.
 */
export function clampTranslation(
  value: number,
  zoom: number,
  viewportExtent: number,
  boardExtent: number,
): number {
  'worklet';
  const scaled = boardExtent * zoom;
  const keepVisible = Math.min(scaled, viewportExtent) * EDGE_KEEP;
  const slack = scaled / 2 + viewportExtent / 2 - keepVisible;
  if (slack <= 0) return 0;
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
