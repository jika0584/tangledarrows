import { useEffect, useRef } from 'react';
import { Level, MAX_LIVES } from '../../../src/levels/types';
import { colors } from '../../../src/theme/theme';
import {
  arrowsInRect,
  fitLayout,
  hitArrow,
  isBlockerCell,
  isFloorCell,
  posTanAt,
  travelPath,
  type Layout,
} from './boardMath';
import { shortestSolution } from '../../../src/game/engine/Solution';
import { escapableArrowIds } from '../../../src/game/engine/WinCondition';
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
  selectedIds?: ReadonlySet<string>;
  onSelect?: (ids: string[]) => void;
  demoToken?: number;
  onDemoFinished?: () => void;
  /** Glow arrows that can slide off the board in the current position. */
  highlightOpen?: boolean;
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
  selectedIds,
  onSelect,
  demoToken = 0,
  onDemoFinished,
  highlightOpen = false,
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
  } | null>(null);
  const marquee = useRef<Marquee | null>(null);
  const size = useRef({ width: 1, height: 1 });
  const keysEnabledRef = useRef(keysEnabled);
  keysEnabledRef.current = keysEnabled;
  const editModeRef = useRef(editMode);
  editModeRef.current = editMode;
  const highlightOpenRef = useRef(highlightOpen);
  highlightOpenRef.current = highlightOpen;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onDemoFinishedRef = useRef(onDemoFinished);
  onDemoFinishedRef.current = onDemoFinished;
  const wasPlayingDemo = useRef(false);

  useEffect(() => {
    camera.current = { zoom: 1, panX: 0, panY: 0 };
    clocks.current.clear();
  }, [level?.id]);

  useEffect(() => {
    if (!demoToken || editMode || !level) return;
    const order = shortestSolution(level);
    if (!order || order.length === 0) {
      onDemoFinishedRef.current?.();
      return;
    }
    wasPlayingDemo.current = true;
    playRef.current.playSolution(order);
  }, [demoToken, editMode, level]);

  useEffect(() => {
    if (wasPlayingDemo.current && !play.playingDemo) {
      wasPlayingDemo.current = false;
      onDemoFinishedRef.current?.();
    }
  }, [play.playingDemo]);

  useEffect(() => {
    if (editMode) {
      playRef.current.stopSolution();
      wasPlayingDemo.current = false;
    }
  }, [editMode]);

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

    const draw = (now: number) => {
      paintCanvas(canvas, now, {
        level: levelRef.current,
        play: playRef.current,
        camera: camera.current,
        layoutRef,
        clocks: clocks.current,
        size: size.current,
        editMode: editModeRef.current,
        highlightOpen: highlightOpenRef.current,
        selectedIds: selectedIdsRef.current,
        marquee: marquee.current,
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
      const pan = !editModeRef.current || event.button !== 0;
      drag.current = {
        kind: pan ? 'pan' : 'marquee',
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        panX: camera.current.panX,
        panY: camera.current.panY,
        moved: false,
        shift: event.shiftKey,
      };
      if (!pan) {
        marquee.current = {
          x0: drag.current.x,
          y0: drag.current.y,
          x1: drag.current.x,
          y1: drag.current.y,
        };
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!drag.current) return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const dx = x - drag.current.x;
      const dy = y - drag.current.y;
      if (Math.hypot(dx, dy) > 4) drag.current.moved = true;
      if (drag.current.kind === 'pan' && drag.current.moved) {
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

      if (editModeRef.current && session.kind === 'marquee') {
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
      if (session.kind !== 'pan' || session.moved || !state || state.status !== 'playing') return;
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
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) {
        return;
      }
      if (document.querySelector('.modal')) return;
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
    highlightOpen: boolean;
    selectedIds?: ReadonlySet<string>;
    marquee: Marquee | null;
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

  if (args.editMode) {
    for (const arrow of level.arrows) {
      drawArrow(ctx, arrow, level.grid, args.layoutRef.current, undefined, now, false, args.selectedIds?.has(arrow.id) ?? false);
    }
    ctx.restore();
    if (args.marquee) drawMarquee(ctx, args.marquee);
    drawHud(ctx, width, height, 0, 'playing', cam.zoom, true);
    return;
  }

  if (!play.state) return;

  const openIds =
    args.highlightOpen ? new Set(escapableArrowIds(play.state)) : null;

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
        anim.kind === 'recoil'
          ? RECOIL_BACK_MS + 90
          : slideDurationMs(anim.distance),
    });
  }

  const drawn = new Set<string>();
  for (const arrow of play.state.arrows) {
    drawArrow(
      ctx,
      arrow,
      level.grid,
      args.layoutRef.current,
      args.clocks.get(arrow.id),
      now,
      failed.has(arrow.id),
      false,
      openIds?.has(arrow.id) ?? false,
      Boolean(openIds && !openIds.has(arrow.id)),
    );
    drawn.add(arrow.id);
  }

  for (const [id, anim] of Object.entries(animations)) {
    if (drawn.has(id) || anim.kind !== 'escape') continue;
    const source = level.arrows.find((arrow) => arrow.id === id);
    if (!source) continue;
    drawArrow(ctx, source, level.grid, args.layoutRef.current, args.clocks.get(id), now, false);
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
  grid: Level['grid'],
  layout: Layout,
  clock: AnimClock | undefined,
  now: number,
  failed: boolean,
  selected = false,
  open = false,
  dimmed = false,
) {
  const path = travelPath(arrow, layout, grid);
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
        : paintColor(arrow);
  if (open) {
    const pulse = 0.4 + 0.35 * (0.5 + 0.5 * Math.sin(now / 160));
    ctx.strokeStyle = colors.arrowEscaping;
    ctx.globalAlpha = (dimmed ? 0.28 : 1) * pulse;
    ctx.lineWidth = cell * 0.88;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    strokeWindow(ctx, path, start, end - cell * HEAD_BACK);
    ctx.globalAlpha = dimmed ? 0.28 : 1;
  }
  ctx.strokeStyle = fill;
  ctx.fillStyle = fill;
  ctx.lineWidth = cell * (selected || open ? 0.62 : 0.42);
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

function paintColor(arrow: Level['arrows'][number]): string {
  if (arrow.role === 'crumb' || arrow.id.startsWith('crumb-')) return colors.arrowCrumb;
  if (arrow.role === 'filler' || arrow.id.startsWith('filler-')) return colors.arrowFiller;
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
  for (let i = 1; i < path.cumulative.length; i++) {
    const a = path.cumulative[i - 1];
    const b = path.cumulative[i];
    if (b < start || a > end) continue;
    const span = Math.max(0.0001, b - a);
    const fromT = Math.max(0, (start - a) / span);
    const toT = Math.min(1, (end - a) / span);
    const x1 = path.xs[i - 1] + (path.xs[i] - path.xs[i - 1]) * fromT;
    const y1 = path.ys[i - 1] + (path.ys[i] - path.ys[i - 1]) * fromT;
    const x2 = path.xs[i - 1] + (path.xs[i] - path.xs[i - 1]) * toT;
    const y2 = path.ys[i - 1] + (path.ys[i] - path.ys[i - 1]) * toT;
    if (!started) {
      ctx.moveTo(x1, y1);
      started = true;
    }
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();
}

function drawMarquee(ctx: CanvasRenderingContext2D, marquee: Marquee) {
  const x = Math.min(marquee.x0, marquee.x1);
  const y = Math.min(marquee.y0, marquee.y1);
  const w = Math.abs(marquee.x1 - marquee.x0);
  const h = Math.abs(marquee.y1 - marquee.y0);
  ctx.save();
  ctx.fillStyle = 'rgba(224, 32, 32, 0.12)';
  ctx.strokeStyle = '#E02020';
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
  status: 'playing' | 'won' | 'lost',
  zoom: number,
  editMode: boolean,
) {
  ctx.font = '600 16px Segoe UI, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = colors.textPrimary;
  if (editMode) {
    ctx.fillText('Edit', 16, 28);
    ctx.fillStyle = colors.textSecondary;
    ctx.fillText(
      `${Math.round(zoom * 100)}%   click to select   drag to box-select   right-drag to pan`,
      70,
      28,
    );
    return;
  }
  ctx.fillText(
    `${'♥'.repeat(Math.max(0, lives))}${'♡'.repeat(Math.max(0, MAX_LIVES - lives))}`,
    16,
    28,
  );
  ctx.fillStyle = colors.textSecondary;
  ctx.fillText(`${Math.round(zoom * 100)}%   wheel or +/- to zoom   drag to pan   R restart`, 110, 28);

  if (status === 'playing') return;
  ctx.fillStyle = colors.overlay;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 34px Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(status === 'won' ? 'Cleared' : 'Out of hearts', width / 2, height / 2 - 8);
  ctx.font = '500 18px Segoe UI, sans-serif';
  ctx.fillText('Press R to try again', width / 2, height / 2 + 28);
}
