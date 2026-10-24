import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { projectRoot } from './env';
import { defaultShapeFolder, listImageFiles } from './shapeFolder';

export function shapesDir(): string {
  return join(projectRoot(), 'tools', 'px', 'data', 'shapes');
}

function destPath(levelNumber: number, fileName: string): string {
  mkdirSync(shapesDir(), { recursive: true });
  const ext = extname(fileName) || '.png';
  const dir = shapesDir();
  const keep = `${levelNumber}${ext.toLowerCase()}`;
  for (const name of readdirSync(dir)) {
    const base = name.slice(0, name.length - extname(name).length);
    if (base === String(levelNumber) && name !== keep) {
      unlinkSync(join(dir, name));
    }
  }
  return join(dir, keep);
}

export function saveShapeFromPath(levelNumber: number, imagePath: string): string {
  if (!existsSync(imagePath)) {
    throw new Error(`Shape image missing: ${imagePath}`);
  }
  const dest = destPath(levelNumber, imagePath);
  if (resolve(imagePath).toLowerCase() === resolve(dest).toLowerCase()) return dest;
  copyFileSync(imagePath, dest);
  return dest;
}

export function saveShapeBytes(levelNumber: number, fileName: string, bytes: Uint8Array): string {
  const dest = destPath(levelNumber, fileName);
  writeFileSync(dest, bytes);
  return dest;
}

/** Sidecar first, then Backgrounds using the stored filename. */
export function findShapeImage(levelNumber: number, shapeSource?: string): string | null {
  const dir = shapesDir();
  if (existsSync(dir)) {
    const prefix = `${levelNumber}.`;
    const hit = readdirSync(dir).find((name) => name.toLowerCase().startsWith(prefix));
    if (hit) return join(dir, hit);
  }

  if (!shapeSource) return null;
  const backgrounds = defaultShapeFolder();
  const direct = join(backgrounds, shapeSource);
  if (existsSync(direct)) return direct;
  const base = basename(shapeSource);
  return listImageFiles(backgrounds).find((file) => basename(file) === base) ?? null;
}

export function isShapeSidecar(file: string): boolean {
  return resolve(dirname(file)).toLowerCase() === resolve(shapesDir()).toLowerCase();
}
