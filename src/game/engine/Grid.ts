import {
  ArrowDefinition,
  CELL_BLOCKER,
  CELL_FLOOR,
  GridCell,
  LevelGrid,
  cellKey,
} from '../../levels/types';

/**
 * Occupancy index of the arrows currently on the board.
 * Rebuilt whenever an arrow escapes, so collision always reflects live state.
 */
export class OccupancyIndex {
  private readonly map = new Map<string, string>();

  constructor(arrows: readonly ArrowDefinition[]) {
    for (const arrow of arrows) {
      for (const cell of arrow.cells) {
        this.map.set(cellKey(cell), arrow.id);
      }
    }
  }

  /** Arrow id occupying the cell, or undefined when free. */
  occupantAt(cell: GridCell): string | undefined {
    return this.map.get(cellKey(cell));
  }

  isFree(cell: GridCell): boolean {
    return !this.map.has(cellKey(cell));
  }
}

export function isInsideGrid(grid: LevelGrid, cell: GridCell): boolean {
  return cell.row >= 0 && cell.col >= 0 && cell.row < grid.rows && cell.col < grid.cols;
}

/** Static blocker cell — stops a slide the same way another arrow does. */
export function isBlocker(grid: LevelGrid, cell: GridCell): boolean {
  return isInsideGrid(grid, cell) && grid.matrix[cell.row][cell.col] === CELL_BLOCKER;
}

/** A cell an arrow body may legally rest on. */
export function isFloor(grid: LevelGrid, cell: GridCell): boolean {
  return isInsideGrid(grid, cell) && grid.matrix[cell.row][cell.col] === CELL_FLOOR;
}

/** True once a cell has left the board bounds entirely. */
export function isOutsideBounds(grid: LevelGrid, cell: GridCell): boolean {
  return !isInsideGrid(grid, cell);
}
