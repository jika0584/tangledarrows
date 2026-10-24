import { useEffect, useRef } from 'react';
import { GridCell, Level, MAX_LIVES } from '../../../src/levels/types';
import { colors } from '../../../src/theme/theme';
import {
  arrowsInRect,
  cellAtBoard,
  cellCenter,
  fitLayout,
  hitArrow,
  isBlockerCell,
  isFloorCell,
  posTanAt,
  travelPath,
  type Layout,
} from './boardMath';
import {
  arrowByTailCell,
  canAddAnchor,
  cellsFromPencilAnchors,
  commitEraserStroke,
  commitPencilExtend,
  commitPencilStroke,
  expandAnchors,
  pencilStrokeReady,
  type EditTool,
} from './editArrows';
import { escapableArrowIds, neverEscapableArrowIds } from '../../../src/game/engine/WinCondition';
import { easeInQuad, RECOIL_BACK_MS, slideDurationMs } from '../../../src/game/rendering/slideTiming';
import { PlayAnimation, usePlay } from './usePlay';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 12;
const RECOIL_OVERSHOOT = 0.55;
const HEAD_REACH = 0.48;
const HEAD_BACK = 0.22;
const HEAD_HALF = 0.34;

interface PlayfieldProps {
  level: Level | null;
  /** When false, +/- / R stay out of the way of dialogs and form fields. */
  keysEnabled?: boolean;
  editMode?: boolean;
  editTool?: EditTool;
  selectedIds?: ReadonlySet<string>;
  onSelect?: (ids: string[]) => void;
  onDraftChange?: (level: Level, selectedIds: string[]) => void;
  /** Glow arrows that can slide off the board in the current position. */
  highlightOpen?: boolean;
  /** Glow arrows that can never clear (unsolvable deadlock). */
  highlightStuck?: boolean;
  viewMode?: 'construction' | 'blocks' | 'solveOrder';
}

interface Camera {
  zoom: number;
  panX: number;
  panY: number;
}

interface AnimClock {
  token: number;
  kind: PlayAnimation['kind'];
  distance: number;
  started: number;
  duration: number;
}

interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function Playfield({
  level,
  keysEnabled = true,
  editMode = false,
  editTool = 'select',
  selectedIds,
  onSelect,
  onDraftChange,
  highlightOpen = false,
  highlightStuck = false,
  viewMode = 'construction',
}: PlayfieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const play = usePlay(level);
  const playRef = useRef(play);
  playRef.current = play;
  const levelRef = useRef(level);
  levelRef.current = level;
  const camera = useRef<Camera>({ zoom: 1, panX: 0, panY: 0 });
  const layoutRef = useRef<Layout>({ cellSize: 16, originX: 0, originY: 0 });
  const clocks = useRef(new Map<string, AnimClock>());
  const drag = useRef<{
    kind: 'pan' | 'marquee';
    x: number;
    y: number;
    panX: number;
    panY: number;
    moved: boolean;
    shift: boolean;
    stroke?: boolean;
  } | null>(null);
  const marquee = useRef<Marquee | null>(null);
  const strokeAnchors = useRef<GridCell[]>([]);
  /** When set, pencil is lengthening this arrow from its tail tip. */
  const extendingArrowId = useRef<string | null>(null);
  const hoverCell = useRef<GridCell | null>(null);
  const size = useRef({ width: 1, height: 1 });
  const keysEnabledRef = useRef(keysEnabled);
  keysEnabledRef.current = keysEnabled;
  const editModeRef = useRef(editMode);
  editModeRef.current = editMode;
  const editToolRef = useRef(editTool);
  editToolRef.current = editTool;
  const highlightOpenRef = useRef(highlightOpen);
  highlightOpenRef.current = highlightOpen;
  const highlightStuckRef = useRef(highlightStuck);
  highlightStuckRef.current = highlightStuck;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;

  useEffect(() => {
    camera.current = { zoom: 1, panX: 0, panY: 0 };
    clocks.current.clear();
    strokeAnchors.current = [];
    extendingArrowId.current = null;
    hoverCell.current = null;
  }, [level?.id]);

  useEffect(() => {
    strokeAnchors.current = [];
    extendingArrowId.current = null;
    hoverCell.current = null;
  }, [editTool, editMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let raf = 0;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      size.current = { width: rect.width, height: rect.height };
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    const screenToBoard = (sx: number, sy: number) => {
      const { width, height } = size.current;
      const cam = camera.current;
      return {
        x: (sx - width / 2 - cam.panX) / cam.zoom + width / 2,
        y: (sy - height / 2 - cam.panY) / cam.zoom + height / 2,
      };
    };

    const zoomAt = (sx: number, sy: number, factor: number) => {
      const { width, height } = size.current;
      const cam = camera.current;
      const world = screenToBoard(sx, sy);
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * factor));
      cam.panX = sx - width / 2 - (world.x - width / 2) * next;
      cam.panY = sy - height / 2 - (world.y - height / 2) * next;
      cam.zoom = next;
    };

    const pickCell = (sx: number, sy: number): GridCell | null => {
      const levelNow = levelRef.current;
      if (!levelNow) return null;
      const board = screenToBoard(sx, sy);
      return cellAtBoard(board.x, board.y, layoutRef.current, levelNow.grid);
    };

    const finishStroke = () => {
      const levelNow = levelRef.current;
      const anchors = strokeAnchors.current;
      const extendId = extendingArrowId.current;
      strokeAnchors.current = [];
      extendingArrowId.current = null;
      hoverCell.current = null;
      if (!levelNow || anchors.length === 0) return;
      const tool = editToolRef.current;
      const result =
        tool === 'eraser'
          ? commitEraserStroke(levelNow, anchors)
          : extendId
            ? commitPencilExtend(levelNow, extendId, anchors)
            : commitPencilStroke(levelNow, anchors);
      if (result.error) {
        window.alert(result.error);
        return;
      }
      onDraftChangeRef.current?.(result.level, result.selectedIds);
    };

    const addStrokePoint = (cell: GridCell) => {
      const levelNow = levelRef.current;
      if (!levelNow) return;
      if (!isFloorCell(levelNow.grid, cell.row, cell.col)) return;

      const anchors = strokeAnchors.current;
      const last = anchors[anchors.length - 1];
      // Same node twice in a row finalizes (replaces fragile double-click).
      if (last && last.row === cell.row && last.col === cell.col) {
        if (editToolRef.current === 'pencil') {
          if (pencilStrokeReady(anchors, extendingArrowId.current)) finishStroke();
        } else if (anchors.length >= 1) {
          finishStroke();
        }
        return;
      }

      if (anchors.length === 0 && editToolRef.current === 'pencil') {
        const atTail = arrowByTailCell(levelNow, cell);
        if (atTail) {
          extendingArrowId.current = atTail.id;
          strokeAnchors.current = [{ ...cell }];
          return;
        }
        // New arrow must start on an empty floor cell (first click = head).
        const occupied = levelNow.arrows.some((arrow) =>
          arrow.cells.some((c) => c.row === cell.row && c.col === cell.col),
        );
        if (occupied) return;
      }

      if (!canAddAnchor(anchors, cell)) return;

      if (editToolRef.current === 'pencil' && extendingArrowId.current) {
        const arrow = levelNow.arrows.find((a) => a.id === extendingArrowId.current);
        const body = arrow?.cells[1];
        if (
          anchors.length === 1 &&
          body &&
          body.row === cell.row &&
          body.col === cell.col
        ) {
          return;
        }
        const trial = [...anchors, cell];
        if (trial.length >= 2 && !expandAnchors(trial)) return;
      } else if (editToolRef.current === 'pencil') {
        const trial = [...anchors, cell];
        const cells = cellsFromPencilAnchors(trial);
        if (trial.length >= 2 && !cells) return;
      }

      strokeAnchors.current = [...anchors, cell];
    };

    const draw = (now: number) => {
      paintCanvas(canvas, now, {
        level: levelRef.current,
        play: playRef.current,
        camera: camera.current,
        layoutRef,
        clocks: clocks.current,
        size: size.current,
        editMode: editModeRef.current,
        editTool: editToolRef.current,
        highlightOpen: highlightOpenRef.current,
        highlightStuck: highlightStuckRef.current,
        selectedIds: selectedIdsRef.current,
        marquee: marquee.current,
        strokeAnchors: strokeAnchors.current,
        extendingArrowId: extendingArrowId.current,
        hoverCell: hoverCell.current,
        viewMode: viewModeRef.current,
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(event.clientX - rect.left, event.clientY - rect.top, event.deltaY < 0 ? 1.12 : 1 / 1.12);
    };
    const onPointerDown = (event: PointerEvent) => {
      canvas.focus();
      canvas.setPointerCapture(event.pointerId);
      const rect = canvas.getBoundingClientRect();
      const drawing =
        editModeRef.current &&
        (editToolRef.current === 'pencil' || editToolRef.current === 'eraser');
      const strokeClick = drawing && event.button === 0;
      const selectClick =
        editModeRef.current && editToolRef.current === 'select' && event.button === 0;

      drag.current = {
        kind: selectClick ? 'marquee' : 'pan',
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        panX: camera.current.panX,
        panY: camera.current.panY,
        moved: false,
        shift: event.shiftKey,
        stroke: strokeClick,
      };
      if (selectClick) {
        marquee.current = {
          x0: drag.current.x,
          y0: drag.current.y,
          x1: drag.current.x,
          y1: drag.current.y,
        };
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (
        editModeRef.current &&
        (editToolRef.current === 'pencil' || editToolRef.current === 'eraser')
      ) {
        hoverCell.current = pickCell(x, y);
      } else {
        hoverCell.current = null;
      }
      if (!drag.current) return;
      const dx = x - drag.current.x;
      const dy = y - drag.current.y;
      if (Math.hypot(dx, dy) > 4) drag.current.moved = true;
      if (drag.current.kind === 'pan' && drag.current.moved && !drag.current.stroke) {
        camera.current.panX = drag.current.panX + dx;
        camera.current.panY = drag.current.panY + dy;
      } else if (drag.current.kind === 'marquee') {
        marquee.current = { x0: drag.current.x, y0: drag.current.y, x1: x, y1: y };
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const session = drag.current;
      drag.current = null;
      marquee.current = null;
      if (!session) return;

      if (session.stroke && !session.moved && event.button === 0) {
        const cell = pickCell(x, y);
        if (cell) addStrokePoint(cell);
        return;
      }

      if (editModeRef.current && session.kind === 'marquee' && editToolRef.current === 'select') {
        const board = screenToBoard(x, y);
        const start = screenToBoard(session.x, session.y);
        const arrows = levelRef.current?.arrows ?? [];
        const previous = selectedIdsRef.current ?? new Set<string>();
        let next: string[];
        if (session.moved) {
          next = arrowsInRect(start.x, start.y, board.x, board.y, arrows, layoutRef.current).map(
            (arrow) => arrow.id,
          );
        } else {
          const hit = hitArrow(board.x, board.y, arrows, layoutRef.current);
          next = hit ? [hit.id] : [];
        }
        if (session.shift) {
          const union = new Set(previous);
          if (session.moved) {
            for (const id of next) union.add(id);
            next = [...union];
          } else if (next[0]) {
            if (union.has(next[0])) union.delete(next[0]);
            else union.add(next[0]);
            next = [...union];
          }
        }
        onSelectRef.current?.(next);
        return;
      }

      const { state, tapArrow } = playRef.current;
      if (
        editModeRef.current ||
        session.kind !== 'pan' ||
        session.moved ||
        session.stroke ||
        !state ||
        state.status !== 'playing'
      ) {
        return;
      }
      const board = screenToBoard(x, y);
      const hit = hitArrow(board.x, board.y, state.arrows, layoutRef.current);
      if (hit) tapArrow(hit.id);
    };
    const onContextMenu = (event: Event) => {
      if (editModeRef.current) event.preventDefault();
    };
    const onPointerCancel = () => {
      drag.current = null;
      marquee.current = null;
    };
    const onKey = (event: KeyboardEvent) => {
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement
      ) {
        return;
      }
      if (document.querySelector('.modal')) return;
      if (event.key === 'Escape' && editModeRef.current) {
        strokeAnchors.current = [];
        extendingArrowId.current = null;
        hoverCell.current = null;
        return;
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoomAt(size.current.width / 2, size.current.height / 2, 1.18);
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        zoomAt(size.current.width / 2, size.current.height / 2, 1 / 1.18);
      } else if (event.key === '0') {
        camera.current = { zoom: 1, panX: 0, panY: 0 };
      } else if (event.key === 'r' || event.key === 'R') {
        if (editModeRef.current) return;
        playRef.current.restart();
        clocks.current.clear();
      }
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('keydown', onKey);
    canvas.tabIndex = 0;
    window.addEventListener('keydown', onKey);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div className="playfield" ref={wrapRef}>
      <canvas ref={canvasRef} />
    </div>
  );
}

function paintCanvas(
  canvas: HTMLCanvasElement,
  now: number,
  args: {
    level: Level | null;
    play: ReturnType<typeof usePlay>;
    camera: Camera;
    layoutRef: { current: Layout };
    clocks: Map<string, AnimClock>;
    size: { width: number; height: number };
    editMode: boolean;
    editTool: EditTool;
    highlightOpen: boolean;
    highlightStuck: boolean;
    selectedIds?: ReadonlySet<string>;
    marquee: Marquee | null;
    strokeAnchors: GridCell[];
    extendingArrowId: string | null;
    hoverCell: GridCell | null;
    viewMode: 'construction' | 'blocks' | 'solveOrder';
  },
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const { width, height } = args.size;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, width, height);

  const { level, play } = args;
  if (!level || (!args.editMode && !play.state)) {
    ctx.fillStyle = colors.textSecondary;
    ctx.font = '500 20px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Select or generate a level to play it here.', width / 2, height / 2);
    return;
  }

  args.layoutRef.current = fitLayout(level.grid, width, height);
  const cam = args.camera;
  ctx.save();
  ctx.translate(width / 2 + cam.panX, height / 2 + cam.panY);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-width / 2, -height / 2);

  drawBoard(ctx, level, args.layoutRef.current);

  const openIds = args.highlightOpen
    ? new Set(
        escapableArrowIds({
          level,
          arrows: level.arrows,
          lives: MAX_LIVES,
          moves: 0,
          status: 'playing',
        }),
      )
    : null;
  const stuckIds = args.highlightStuck ? new Set(neverEscapableArrowIds(level)) : null;

  const arrowHighlight = (id: string): { open: boolean; stuck: boolean; dimmed: boolean } => {
    const open = openIds?.has(id) ?? false;
    const stuck = stuckIds?.has(id) ?? false;
    const dimmed = Boolean((openIds && !open) || (stuckIds && !stuck));
    return { open, stuck, dimmed };
  };

  if (args.editMode) {
    for (const arrow of level.arrows) {
      const hi = arrowHighlight(arrow.id);
      drawArrow(
        ctx,
        arrow,
        level,
        args.layoutRef.current,
        undefined,
        now,
        false,
        args.selectedIds?.has(arrow.id) ?? false,
        hi.open,
        hi.dimmed,
        args.viewMode,
        hi.stuck,
      );
    }
    drawStrokePreview(
      ctx,
      level,
      args.layoutRef.current,
      args.strokeAnchors,
      args.hoverCell,
      args.editTool,
      args.extendingArrowId,
    );
    ctx.restore();
    if (args.marquee) drawMarquee(ctx, args.marquee);
    drawHud(ctx, width, height, 0, 'playing', cam.zoom, true);
    return;
  }

  if (!play.state) return;

  const playOpenIds = args.highlightOpen ? new Set(escapableArrowIds(play.state)) : null;
  const playStuckIds = args.highlightStuck ? new Set(neverEscapableArrowIds(level)) : null;

  const playHighlight = (id: string): { open: boolean; stuck: boolean; dimmed: boolean } => {
    const open = playOpenIds?.has(id) ?? false;
    const stuck = playStuckIds?.has(id) ?? false;
    const dimmed = Boolean((playOpenIds && !open) || (playStuckIds && !stuck));
    return { open, stuck, dimmed };
  };

  const { animations, failed, onAnimationEnd } = play;

  for (const [id, anim] of Object.entries(animations)) {
    const existing = args.clocks.get(id);
    if (existing && existing.token === anim.token) continue;
    args.clocks.set(id, {
      token: anim.token,
      kind: anim.kind,
      distance: anim.distance,
      started: now,
      duration:
        anim.kind === 'recoil' ? RECOIL_BACK_MS + 90 : slideDurationMs(anim.distance),
    });
  }

  const drawn = new Set<string>();
  for (const arrow of play.state.arrows) {
    const hi = playHighlight(arrow.id);
    drawArrow(
      ctx,
      arrow,
      level,
      args.layoutRef.current,
      args.clocks.get(arrow.id),
      now,
      failed.has(arrow.id),
      false,
      hi.open,
      hi.dimmed,
      args.viewMode,
      hi.stuck,
    );
    drawn.add(arrow.id);
  }

  for (const [id, anim] of Object.entries(animations)) {
    if (drawn.has(id) || anim.kind !== 'escape') continue;
    const source = level.arrows.find((arrow) => arrow.id === id);
    if (!source) continue;
    drawArrow(
      ctx,
      source,
      level,
      args.layoutRef.current,
      args.clocks.get(id),
      now,
      false,
      false,
      false,
      false,
      args.viewMode,
      false,
    );
  }

  for (const [id, clock] of [...args.clocks.entries()]) {
    if (now - clock.started >= clock.duration) {
      args.clocks.delete(id);
      onAnimationEnd(id);
    }
  }

  ctx.restore();
  drawHud(ctx, width, height, play.state.lives, play.state.status, cam.zoom, false);
}

function drawStrokePreview(
  ctx: CanvasRenderingContext2D,
  level: Level,
  layout: Layout,
  anchors: GridCell[],
  hover: GridCell | null,
  tool: EditTool,
  extendingArrowId: string | null,
) {
  if (tool !== 'pencil' && tool !== 'eraser') return;
  const previewAnchors =
    hover && canAddAnchor(anchors, hover) ? [...anchors, hover] : anchors;
  if (previewAnchors.length === 0) return;

  const extending = tool === 'pencil' && !!extendingArrowId;
  const path = extending
    ? expandAnchors(previewAnchors) ??
      (previewAnchors.length === 1 ? [{ ...previewAnchors[0] }] : null)
    : tool === 'pencil'
      ? cellsFromPencilAnchors(previewAnchors) ??
        (previewAnchors.length === 1 ? [{ ...previewAnchors[0] }] : null)
      : expandAnchors(previewAnchors);
  if (!path || path.length === 0) return;

  const stroke = tool === 'eraser' ? colors.arrowBlocked : colors.arrowFiller;
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = stroke;
  ctx.fillStyle = stroke;
  ctx.lineWidth = layout.cellSize * 0.42;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (path.length === 1) {
    const c = cellCenter(path[0], layout);
    ctx.beginPath();
    ctx.arc(c.x, c.y, layout.cellSize * 0.28, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    const first = cellCenter(path[0], layout);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < path.length; i++) {
      const p = cellCenter(path[i], layout);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    if (tool === 'pencil' && !extending) {
      const tip = cellCenter(path[path.length - 1], layout);
      const neck = cellCenter(path[path.length - 2], layout);
      const angle = Math.atan2(tip.y - neck.y, tip.x - neck.x);
      ctx.translate(tip.x, tip.y);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(layout.cellSize * HEAD_REACH, 0);
      ctx.lineTo(-layout.cellSize * HEAD_BACK, layout.cellSize * HEAD_HALF);
      ctx.lineTo(-layout.cellSize * HEAD_BACK, -layout.cellSize * HEAD_HALF);
      ctx.closePath();
      ctx.fill();
    } else if (extending) {
      const tip = cellCenter(path[path.length - 1], layout);
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, layout.cellSize * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // Dim illegal hover.
  if (hover && anchors.length > 0 && !canAddAnchor(anchors, hover)) {
    const c = cellCenter(hover, layout);
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = colors.arrowBlocked;
    ctx.beginPath();
    ctx.arc(c.x, c.y, layout.cellSize * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  void level;
}

function drawBoard(ctx: CanvasRenderingContext2D, level: Level, layout: Layout) {
  const { cellSize, originX, originY } = layout;
  const radius = Math.max(1, cellSize * 0.07);
  ctx.fillStyle = colors.gridDot;
  for (let row = 0; row < level.grid.rows; row++) {
    for (let col = 0; col < level.grid.cols; col++) {
      if (isFloorCell(level.grid, row, col)) {
        ctx.beginPath();
        ctx.arc(originX + (col + 0.5) * cellSize, originY + (row + 0.5) * cellSize, radius, 0, Math.PI * 2);
        ctx.fill();
      } else if (isBlockerCell(level.grid, row, col)) {
        ctx.fillStyle = colors.arrowHighlight;
        ctx.fillRect(
          originX + col * cellSize,
          originY + row * cellSize,
          cellSize + 0.5,
          cellSize + 0.5,
        );
        ctx.fillStyle = colors.gridDot;
      }
    }
  }
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  arrow: Level['arrows'][number],
  level: Level,
  layout: Layout,
  clock: AnimClock | undefined,
  now: number,
  failed: boolean,
  selected = false,
  open = false,
  dimmed = false,
  viewMode: 'construction' | 'blocks' | 'solveOrder' = 'construction',
  stuck = false,
) {
  const path = travelPath(arrow, layout, level.grid);
  const cell = layout.cellSize;
  let start = 0;
  if (clock) {
    const t = easeInQuad(Math.min(1, (now - clock.started) / clock.duration));
    if (clock.kind === 'escape') start = clock.distance * cell * t;
    else {
      const bump = (clock.distance + RECOIL_OVERSHOOT) * cell;
      const swing = t < 0.45 ? t / 0.45 : 1 - (t - 0.45) / 0.55;
      start = bump * Math.max(0, swing);
    }
  }
  const end = start + path.bodyLength;
  ctx.save();
  if (dimmed) ctx.globalAlpha = 0.28;
  const fill = selected
    ? '#E02020'
    : failed
      ? colors.arrowBlocked
      : clock?.kind === 'escape'
        ? colors.arrowEscaping
        : paintColor(arrow, level, viewMode);
  if (open) {
    const pulse = 0.4 + 0.35 * (0.5 + 0.5 * Math.sin(now / 160));
    ctx.strokeStyle = colors.arrowEscaping;
    ctx.globalAlpha = (dimmed ? 0.28 : 1) * pulse;
    ctx.lineWidth = cell * 0.88;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    strokeWindow(ctx, path, start, end - cell * HEAD_BACK);
    ctx.globalAlpha = dimmed ? 0.28 : 1;
  } else if (stuck) {
    const pulse = 0.45 + 0.4 * (0.5 + 0.5 * Math.sin(now / 140));
    ctx.strokeStyle = colors.arrowBlocked;
    ctx.globalAlpha = (dimmed ? 0.28 : 1) * pulse;
    ctx.lineWidth = cell * 0.88;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    strokeWindow(ctx, path, start, end - cell * HEAD_BACK);
    ctx.globalAlpha = dimmed ? 0.28 : 1;
  }
  ctx.strokeStyle = fill;
  ctx.fillStyle = fill;
  ctx.lineWidth = cell * (selected || open || stuck ? 0.62 : 0.42);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  strokeWindow(ctx, path, start, end - cell * HEAD_BACK);

  const tip = posTanAt(path.xs, path.ys, path.cumulative, end);
  ctx.translate(tip.x, tip.y);
  ctx.rotate(tip.angle);
  ctx.beginPath();
  ctx.moveTo(cell * HEAD_REACH, 0);
  ctx.lineTo(-cell * HEAD_BACK, cell * HEAD_HALF);
  ctx.lineTo(-cell * HEAD_BACK, -cell * HEAD_HALF);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

const BLOCK_COLORS = ['#E4572E', '#F4C430', '#2FBF71', '#8B5CF6', '#0EA5E9', '#D946EF', '#22C55E'];

function paintColor(
  arrow: Level['arrows'][number],
  level: Level,
  viewMode: 'construction' | 'blocks' | 'solveOrder',
): string {
  if (viewMode === 'blocks') {
    const block = arrow.blockId ?? 0;
    return BLOCK_COLORS[Math.abs(block) % BLOCK_COLORS.length] ?? colors.arrow;
  }
  if (viewMode === 'solveOrder') {
    const maxSolve = Math.max(
      1,
      ...level.arrows.map((a) => a.solveIndex ?? 0),
    );
    const index = arrow.solveIndex ?? 0;
    const t = maxSolve <= 1 ? 0 : (index - 1) / (maxSolve - 1);
    return `hsl(${210 - t * 160} 70% ${42 + t * 18}%)`;
  }
  if (arrow.role === 'crumb' || arrow.id.startsWith('crumb-')) return colors.arrowCrumb;
  if (arrow.role === 'filler' || arrow.id.startsWith('filler-') || arrow.id.startsWith('draw-')) {
    return colors.arrowFiller;
  }
  return colors.arrow;
}

function strokeWindow(
  ctx: CanvasRenderingContext2D,
  path: ReturnType<typeof travelPath>,
  start: number,
  end: number,
) {
  if (end <= start) return;
  ctx.beginPath();
  let started = false;
  for (let d = start; d <= end; d += Math.max(1, (end - start) / 64)) {
    const p = posTanAt(path.xs, path.ys, path.cumulative, d);
    if (!started) {
      ctx.moveTo(p.x, p.y);
      started = true;
    } else ctx.lineTo(p.x, p.y);
  }
  const tip = posTanAt(path.xs, path.ys, path.cumulative, end);
  ctx.lineTo(tip.x, tip.y);
  ctx.stroke();
}

function drawMarquee(ctx: CanvasRenderingContext2D, box: Marquee) {
  const x = Math.min(box.x0, box.x1);
  const y = Math.min(box.y0, box.y1);
  const w = Math.abs(box.x1 - box.x0);
  const h = Math.abs(box.y1 - box.y0);
  ctx.save();
  ctx.strokeStyle = colors.arrowEscaping;
  ctx.fillStyle = 'rgba(47, 191, 113, 0.12)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function drawHud(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  lives: number,
  status: string,
  zoom: number,
  editing: boolean,
) {
  ctx.fillStyle = colors.textPrimary;
  ctx.font = '600 13px Segoe UI, sans-serif';
  ctx.textAlign = 'left';
  if (editing) {
    ctx.fillStyle = colors.textSecondary;
    ctx.fillText('Edit · scroll to zoom · Esc cancels a stroke', 14, 22);
  } else {
    ctx.fillText(`Lives ${lives}`, 14, 22);
    ctx.fillStyle = colors.textSecondary;
    ctx.fillText(`${Math.round(zoom * 100)}%`, 14, 40);
  }
  if (status === 'won' || status === 'lost') {
    ctx.fillStyle = colors.overlay;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = colors.textPrimary;
    ctx.font = '700 28px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(status === 'won' ? 'Cleared' : 'Out of lives', width / 2, height / 2);
  }
}
