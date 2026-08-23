/**
 * Image-to-silhouette checks. Run with: npm run test:levels
 */
import { CELL_FLOOR, CELL_OUTSIDE } from '../../levels/types';
import { gridSizeFromRaster, matrixFromRaster, MAX_SHAPE_GRID, Raster } from '../shapeFromImage';

let failures = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failures++;
    console.error(`  FAIL  ${name}: ${(error as Error).message}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function raster(
  width: number,
  height: number,
  fill: (x: number, y: number) => [number, number, number, number],
): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, g, b, a] = fill(x, y);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { width, height, data };
}

const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const BLUE: [number, number, number, number] = [30, 90, 180, 255];
const GREEN: [number, number, number, number] = [20, 170, 70, 255];
const BLACK: [number, number, number, number] = [0, 0, 0, 255];

check('a blue square on white becomes a filled board', () => {
  const image = raster(80, 80, (x, y) => {
    const inset = x >= 8 && x < 72 && y >= 8 && y < 72;
    return inset ? BLUE : WHITE;
  });
  const matrix = matrixFromRaster(image, 32);
  const floor = matrix.flat().filter((cell) => cell === CELL_FLOOR).length;
  assert(matrix.length === 32, `expected 32 rows, got ${matrix.length}`);
  assert(matrix[16][16] === CELL_FLOOR, 'square centre should be floor');
  assert(floor / (32 * 32) > 0.7, `square fill ${floor} is too sparse`);
});

check('a blue ring keeps a hollow middle', () => {
  const size = 96;
  const centre = (size - 1) / 2;
  const image = raster(size, size, (x, y) => {
    const r = Math.hypot(x - centre, y - centre);
    return r <= 42 && r >= 18 ? BLUE : WHITE;
  });
  const matrix = matrixFromRaster(image, 32);
  const mid = matrix[16][16];
  const ring = matrix[16][6];
  assert(mid === CELL_OUTSIDE, `donut hole should be outside, got ${mid}`);
  assert(ring === CELL_FLOOR, `donut ring should be floor, got ${ring}`);
});

check('white on a dark background is inverted', () => {
  const image = raster(80, 80, (x, y) => {
    const dx = x - 40;
    const dy = y - 40;
    const inside = dx * dx + dy * dy <= 22 * 22;
    return inside ? WHITE : BLUE;
  });
  const matrix = matrixFromRaster(image, 28);
  const centre = matrix[14][14];
  const corner = matrix[0][0];
  assert(centre === CELL_FLOOR, 'light silhouette should become floor');
  assert(corner === CELL_OUTSIDE, 'dark paper around the border should stay outside');
});

check('green or black ink on white is still a silhouette', () => {
  const green = raster(64, 64, (x, y) => (x >= 8 && x < 56 && y >= 8 && y < 56 ? GREEN : WHITE));
  const black = raster(64, 64, (x, y) => (x >= 8 && x < 56 && y >= 8 && y < 56 ? BLACK : WHITE));
  assert(matrixFromRaster(green, 28)[14][14] === CELL_FLOOR, 'green ink should be floor');
  assert(matrixFromRaster(black, 28)[14][14] === CELL_FLOOR, 'black ink should be floor');
});

check('huge drawings are pixelated down to fit', () => {
  const image = raster(400, 400, (x, y) => {
    const dx = x - 200;
    const dy = y - 200;
    return dx * dx + dy * dy <= 160 * 160 ? BLUE : WHITE;
  });
  const size = gridSizeFromRaster(image);
  assert(size <= 40, `opening grid should stay compact, got ${size}`);
  assert(size >= 24, `opening grid should not collapse, got ${size}`);
});

check('a small drawing on a large canvas fills the chosen grid', () => {
  const image = raster(200, 200, (x, y) => {
    if (x === 1 && y === 1) return BLACK;
    const inBottle = x >= 90 && x < 110 && y >= 70 && y < 140;
    return inBottle ? BLUE : WHITE;
  });
  const matrix = matrixFromRaster(image, 64);
  let minR = 64;
  let maxR = -1;
  for (let r = 0; r < 64; r++) {
    if (!matrix[r].includes(CELL_FLOOR)) continue;
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
  }
  const span = maxR - minR + 1;
  assert(matrix.length === 64, `expected 64 rows, got ${matrix.length}`);
  assert(span >= 54, `silhouette should fill the 64 grid, height span was ${span}`);
});

check('single-level images can rasterize onto a 150×150 grid', () => {
  const image = raster(80, 80, (x, y) => {
    const dx = x - 40;
    const dy = y - 40;
    return dx * dx + dy * dy <= 28 * 28 ? BLUE : WHITE;
  });
  const matrix = matrixFromRaster(image, MAX_SHAPE_GRID);
  assert(matrix.length === 150, `expected 150 rows, got ${matrix.length}`);
  const floor = matrix.flat().filter((cell) => cell === CELL_FLOOR).length;
  assert(floor > 200, `150×150 silhouette was too sparse (${floor} floor cells)`);
  let threw = false;
  try {
    matrixFromRaster(image, MAX_SHAPE_GRID + 1);
  } catch {
    threw = true;
  }
  assert(threw, 'grids larger than 150 should be rejected');
});

check('an empty white image is rejected', () => {
  const image = raster(40, 40, () => WHITE);
  let threw = false;
  try {
    matrixFromRaster(image, 24);
  } catch {
    threw = true;
  }
  assert(threw, 'blank paper should not produce a board');
});

if (failures > 0) {
  console.error(`\n${failures} shape-from-image test(s) failed`);
  process.exit(1);
}

console.log('\nAll shape-from-image checks passed.');
