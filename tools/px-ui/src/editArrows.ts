import {
  ArrowDefinition,
  CELL_FLOOR,
  Direction,
  GridCell,
  Level,
  cellKey,
} from '../../../src/levels/types';

export function cloneLevel(level: Level): Level {
  return {
    ...level,
    grid: {
      ...level.grid,
      matrix: level.grid.matrix.map((row) => [...row]),
    },
    arrows: level.arrows.map(cloneArrow),
    metadata: { ...level.metadata },
  };
}

export function stampMetadata(level: Level): Level {
  return {
    ...level,
    metadata: {
      ...level.metadata,
      arrowCount: level.arrows.length,
      solutionOrder: undefined,
    },
  };
}

export function deleteArrows(level: Level, ids: ReadonlySet<string>): Level {
  return stampMetadata({
    ...level,
    arrows: level.arrows.filter((arrow) => !ids.has(arrow.id)),
  });
}

export function canSeparate(level: Level, ids: ReadonlySet<string>): boolean {
  return level.arrows.some((arrow) => ids.has(arrow.id) && plannedCuts(arrow.cells).length > 0);
}

export function canMerge(level: Level, ids: ReadonlySet<string>): boolean {
  const selected = level.arrows.filter((arrow) => ids.has(arrow.id));
  for (let i = 0; i < selected.length; i++) {
    for (let j = i + 1; j < selected.length; j++) {
      if (joinPair(selected[i], selected[j])) return true;
    }
  }
  return false;
}

export function separateArrows(
  level: Level,
  ids: ReadonlySet<string>,
): { level: Level; selectedIds: string[] } {
  const used = new Set(level.arrows.map((arrow) => arrow.id));
  const next: ArrowDefinition[] = [];
  const selectedIds: string[] = [];

  for (const arrow of level.arrows) {
    if (!ids.has(arrow.id)) {
      next.push(arrow);
      continue;
    }
    const pieces = splitPolyline(arrow.cells);
    if (pieces.length < 2) {
      next.push(arrow);
      continue;
    }
    used.delete(arrow.id);
    for (let i = 0; i < pieces.length; i++) {
      const id = uniqueId(used, `${arrow.id}-${i + 1}`);
      used.add(id);
      const piece: ArrowDefinition = {
        id,
        cells: pieces[i],
        direction: directionFromCells(pieces[i]),
        blockId: arrow.blockId,
        role: arrow.role,
      };
      next.push(piece);
      selectedIds.push(id);
    }
  }

  return { level: stampMetadata({ ...level, arrows: next }), selectedIds };
}

export function mergeArrows(
  level: Level,
  ids: ReadonlySet<string>,
): { level: Level; selectedIds: string[] } {
  const selected = level.arrows.filter((arrow) => ids.has(arrow.id));
  if (selected.length < 2) {
    return { level, selectedIds: [...ids] };
  }

  const pool = selected.map(cloneArrow);
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const joined = joinPair(pool[i], pool[j]);
        if (!joined) continue;
        pool.splice(j, 1);
        pool.splice(i, 1);
        pool.push(joined);
        merged = true;
        break outer;
      }
    }
  }

  const used = new Set(level.arrows.filter((arrow) => !ids.has(arrow.id)).map((arrow) => arrow.id));
  const rewritten = pool.map((arrow, index) => {
    const id = uniqueId(used, index === 0 && pool.length === 1 ? selected[0].id : `${selected[0].id}-m${index + 1}`);
    used.add(id);
    return { ...arrow, id };
  });

  const next = [
    ...level.arrows.filter((arrow) => !ids.has(arrow.id)),
    ...rewritten,
  ];

  return {
    level: stampMetadata({ ...level, arrows: next }),
    selectedIds: rewritten.map((arrow) => arrow.id),
  };
}

export function turnCellIndices(cells: GridCell[]): number[] {
  const turns: number[] = [];
  for (let i = 1; i < cells.length - 1; i++) {
    const inR = cells[i].row - cells[i - 1].row;
    const inC = cells[i].col - cells[i - 1].col;
    const outR = cells[i + 1].row - cells[i].row;
    const outC = cells[i + 1].col - cells[i].col;
    if (inR !== outR || inC !== outC) turns.push(i);
  }
  return turns;
}

function plannedCuts(cells: GridCell[]): number[] {
  const turns = turnCellIndices(cells);
  if (turns.length === 0 || cells.length < 4) return [];

  const n = turns.length;
  const pieceCount = n % 2 === 1 ? 2 : n / 2 + 1;
  const needed = pieceCount - 1;
  const len = cells.length;
  const used = new Set<number>();
  const raw: number[] = [];

  for (let p = 1; p <= needed; p++) {
    const target = Math.round((len * p) / pieceCount);
    let best = -1;
    let bestDist = Infinity;
    for (const turn of turns) {
      if (used.has(turn)) continue;
      if (turn < 2 || turn > len - 2) continue;
      const dist = Math.abs(turn - target);
      if (dist < bestDist) {
        bestDist = dist;
        best = turn;
      }
    }
    if (best < 0) continue;
    used.add(best);
    raw.push(best);
  }

  raw.sort((a, b) => a - b);
  const cuts: number[] = [];
  let prev = 0;
  for (const cut of raw) {
    if (cut - prev >= 2 && len - cut >= 2) {
      cuts.push(cut);
      prev = cut;
    }
  }
  return cuts;
}

function splitPolyline(cells: GridCell[]): GridCell[][] {
  const cuts = plannedCuts(cells);
  if (cuts.length === 0) return [cells];
  const bounds = [0, ...cuts, cells.length];
  const pieces: GridCell[][] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const piece = cells.slice(bounds[i], bounds[i + 1]).map((cell) => ({ ...cell }));
    if (piece.length < 2) return [cells];
    pieces.push(piece);
  }
  return pieces;
}

function joinPair(a: ArrowDefinition, b: ArrowDefinition): ArrowDefinition | null {
  const aTail = a.cells[0];
  const aHead = a.cells[a.cells.length - 1];
  const bTail = b.cells[0];
  const bHead = b.cells[b.cells.length - 1];

  if (manhattan(aHead, bTail) === 1) return stitch(a, b.cells, false);
  if (manhattan(bHead, aTail) === 1) return stitch(b, a.cells, false);
  if (manhattan(aHead, bHead) === 1) return stitch(a, [...b.cells].reverse(), false);
  if (manhattan(aTail, bTail) === 1) return stitch(a, b.cells, true);
  return null;
}

function stitch(lead: ArrowDefinition, extra: GridCell[], reverseLead: boolean): ArrowDefinition | null {
  const first = reverseLead ? [...lead.cells].reverse() : lead.cells;
  const cells = [...first, ...extra].map((cell) => ({ ...cell }));
  if (cells.length < 2) return null;
  const seen = new Set<string>();
  for (const cell of cells) {
    const key = cellKey(cell);
    if (seen.has(key)) return null;
    seen.add(key);
  }
  for (let i = 1; i < cells.length; i++) {
    if (manhattan(cells[i - 1], cells[i]) !== 1) return null;
  }
  return {
    id: lead.id,
    cells,
    direction: directionFromCells(cells),
    blockId: lead.blockId,
    role: lead.role,
  };
}

function directionFromCells(cells: GridCell[]): Direction {
  const neck = cells[cells.length - 2];
  const tip = cells[cells.length - 1];
  const dr = tip.row - neck.row;
  const dc = tip.col - neck.col;
  if (dr === -1 && dc === 0) return 'up';
  if (dr === 1 && dc === 0) return 'down';
  if (dr === 0 && dc === -1) return 'left';
  return 'right';
}

function manhattan(a: GridCell, b: GridCell): number {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

function uniqueId(used: Set<string>, base: string): string {
  if (!used.has(base)) return base;
  let n = 2;
  let id = `${base}-${n}`;
  while (used.has(id)) {
    n += 1;
    id = `${base}-${n}`;
  }
  return id;
}

function cloneArrow(arrow: ArrowDefinition): ArrowDefinition {
  return { ...arrow, cells: arrow.cells.map((cell) => ({ ...cell })) };
}

export type EditTool = 'select' | 'pencil' | 'eraser';

/** Axis-aligned cells from a → b inclusive, or null if not a rook move. */
export function straightRun(a: GridCell, b: GridCell): GridCell[] | null {
  if (a.row === b.row && a.col === b.col) return [{ ...a }];
  if (a.row !== b.row && a.col !== b.col) return null;
  const cells: GridCell[] = [];
  if (a.row === b.row) {
    const step = a.col < b.col ? 1 : -1;
    for (let col = a.col; col !== b.col + step; col += step) cells.push({ row: a.row, col });
  } else {
    const step = a.row < b.row ? 1 : -1;
    for (let row = a.row; row !== b.row + step; row += step) cells.push({ row, col: a.col });
  }
  return cells;
}

/** Expand click anchors into a continuous polyline (first anchor = pencil head). */
export function expandAnchors(anchors: GridCell[]): GridCell[] | null {
  if (anchors.length === 0) return [];
  if (anchors.length === 1) return [{ ...anchors[0] }];
  const cells: GridCell[] = [{ ...anchors[0] }];
  for (let i = 1; i < anchors.length; i++) {
    const run = straightRun(anchors[i - 1], anchors[i]);
    if (!run || run.length < 2) return null;
    for (let j = 1; j < run.length; j++) cells.push(run[j]);
  }
  return cells;
}

/**
 * Whether `next` may extend the stroke. First point free; later points must be
 * a straight rook move from the last anchor, continuing or turning 90° (no U-turn).
 */
export function canAddAnchor(anchors: GridCell[], next: GridCell): boolean {
  if (anchors.length === 0) return true;
  const last = anchors[anchors.length - 1];
  if (last.row === next.row && last.col === next.col) return false;
  if (last.row !== next.row && last.col !== next.col) return false;
  if (anchors.length === 1) return true;
  const prev = anchors[anchors.length - 2];
  const inR = Math.sign(last.row - prev.row);
  const inC = Math.sign(last.col - prev.col);
  const outR = Math.sign(next.row - last.row);
  const outC = Math.sign(next.col - last.col);
  if (inR === -outR && inC === -outC) return false;
  return true;
}

/** Tail→head cells for a pencil stroke (anchors[0] is the head). */
export function cellsFromPencilAnchors(anchors: GridCell[]): GridCell[] | null {
  const forward = expandAnchors(anchors);
  if (!forward || forward.length < 2) return null;
  const seen = new Set<string>();
  for (const cell of forward) {
    const key = cellKey(cell);
    if (seen.has(key)) return null;
    seen.add(key);
  }
  return forward.map((cell) => ({ ...cell })).reverse();
}

export function commitPencilStroke(
  level: Level,
  anchors: GridCell[],
): { level: Level; selectedIds: string[]; error?: string } {
  const cells = cellsFromPencilAnchors(anchors);
  if (!cells) {
    return { level, selectedIds: [], error: 'Need at least two cells on a straight or 90° path.' };
  }
  for (const cell of cells) {
    if (level.grid.matrix[cell.row]?.[cell.col] !== CELL_FLOOR) {
      return { level, selectedIds: [], error: 'Arrow must stay on floor cells.' };
    }
  }
  const occupied = new Set<string>();
  for (const arrow of level.arrows) {
    for (const cell of arrow.cells) occupied.add(cellKey(cell));
  }
  for (const cell of cells) {
    if (occupied.has(cellKey(cell))) {
      return { level, selectedIds: [], error: 'That path overlaps an existing arrow.' };
    }
  }
  const used = new Set(level.arrows.map((arrow) => arrow.id));
  const id = uniqueId(used, `draw-${cells[cells.length - 1].row}x${cells[cells.length - 1].col}`);
  const arrow: ArrowDefinition = {
    id,
    cells,
    direction: directionFromCells(cells),
    role: 'filler',
  };
  return {
    level: stampMetadata({ ...level, arrows: [...level.arrows, arrow] }),
    selectedIds: [id],
  };
}

/** Arrow whose storage-tail (`cells[0]`) sits on this cell, if any. */
export function arrowByTailCell(level: Level, cell: GridCell): ArrowDefinition | null {
  for (const arrow of level.arrows) {
    const tail = arrow.cells[0];
    if (tail && tail.row === cell.row && tail.col === cell.col) return arrow;
  }
  return null;
}

/**
 * Grow an existing arrow from its tail. `anchors[0]` must be the current tail;
 * later anchors walk outward along straight / 90° runs. New cells are prepended.
 */
export function commitPencilExtend(
  level: Level,
  arrowId: string,
  anchors: GridCell[],
): { level: Level; selectedIds: string[]; error?: string } {
  const index = level.arrows.findIndex((arrow) => arrow.id === arrowId);
  if (index < 0) {
    return { level, selectedIds: [], error: 'That arrow is gone.' };
  }
  const arrow = level.arrows[index];
  const tail = arrow.cells[0];
  if (
    anchors.length === 0 ||
    !tail ||
    anchors[0].row !== tail.row ||
    anchors[0].col !== tail.col
  ) {
    return { level, selectedIds: [], error: 'Start from the arrow’s tail tip.' };
  }
  const extension = expandAnchors(anchors);
  if (!extension || extension.length < 2) {
    return { level, selectedIds: [], error: 'Need at least one new cell past the tail.' };
  }
  const prepend = extension.slice(1).reverse().map((cell) => ({ ...cell }));
  for (const cell of prepend) {
    if (level.grid.matrix[cell.row]?.[cell.col] !== CELL_FLOOR) {
      return { level, selectedIds: [], error: 'Arrow must stay on floor cells.' };
    }
  }
  const occupied = new Set<string>();
  for (const other of level.arrows) {
    if (other.id === arrowId) continue;
    for (const cell of other.cells) occupied.add(cellKey(cell));
  }
  for (const cell of arrow.cells) occupied.add(cellKey(cell));
  for (const cell of prepend) {
    if (occupied.has(cellKey(cell))) {
      return { level, selectedIds: [], error: 'That path overlaps an existing arrow.' };
    }
  }
  const cells = [...prepend, ...arrow.cells.map((cell) => ({ ...cell }))];
  const next: ArrowDefinition = {
    ...arrow,
    cells,
    direction: directionFromCells(cells),
  };
  const arrows = level.arrows.slice();
  arrows[index] = next;
  return {
    level: stampMetadata({ ...level, arrows }),
    selectedIds: [arrowId],
  };
}

/** Whether a pencil stroke (new or extend) can be finalized from these anchors. */
export function pencilStrokeReady(
  anchors: GridCell[],
  extendingArrowId: string | null,
): boolean {
  if (extendingArrowId) {
    const extension = expandAnchors(anchors);
    return !!extension && extension.length >= 2;
  }
  return cellsFromPencilAnchors(anchors) !== null;
}

/**
 * Erase every arrow cell that lies on the stroke polyline. Remnant runs of
 * length ≥ 2 are kept; each remnant keeps order so the end nearest the old
 * head (or the cut facing the old head) becomes the head.
 */
export function commitEraserStroke(
  level: Level,
  anchors: GridCell[],
): { level: Level; selectedIds: string[]; error?: string } {
  const path = expandAnchors(anchors);
  if (!path || path.length === 0) {
    return { level, selectedIds: [], error: 'Click at least one cell on an arrow.' };
  }
  const erase = new Set(path.map(cellKey));
  const used = new Set<string>();
  const next: ArrowDefinition[] = [];
  const selectedIds: string[] = [];

  for (const arrow of level.arrows) {
    const keptMask = arrow.cells.map((cell) => !erase.has(cellKey(cell)));
    if (keptMask.every(Boolean)) {
      next.push(arrow);
      used.add(arrow.id);
      continue;
    }
    if (keptMask.every((keep) => !keep)) {
      continue;
    }

    let runStart = -1;
    const pushRun = (from: number, to: number) => {
      const cells = arrow.cells.slice(from, to).map((cell) => ({ ...cell }));
      if (cells.length < 2) return;
      const id = uniqueId(used, `${arrow.id}-e${from}`);
      used.add(id);
      const piece: ArrowDefinition = {
        id,
        cells,
        direction: directionFromCells(cells),
        blockId: arrow.blockId,
        role: arrow.role,
      };
      next.push(piece);
      selectedIds.push(id);
    };

    for (let i = 0; i <= keptMask.length; i++) {
      const keep = i < keptMask.length && keptMask[i];
      if (keep) {
        if (runStart < 0) runStart = i;
      } else if (runStart >= 0) {
        pushRun(runStart, i);
        runStart = -1;
      }
    }
  }

  return {
    level: stampMetadata({ ...level, arrows: next }),
    selectedIds,
  };
}
