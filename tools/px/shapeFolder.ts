import { existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { projectRoot } from './env';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);

export function defaultShapeFolder(): string {
  return join(projectRoot(), 'Backgrounds');
}

export function listImageFiles(folder: string): string[] {
  if (!folder || !existsSync(folder)) return [];
  const names = readdirSync(folder);
  const files: string[] = [];
  for (const name of names) {
    const full = join(folder, name);
    try {
      if (!statSync(full).isFile()) continue;
    } catch {
      continue;
    }
    if (IMAGE_EXT.has(extname(name).toLowerCase())) files.push(full);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

export function pickImageOrSquare(images: string[], alsoUseSquares: boolean): string | null {
  if (images.length === 0) return null;
  if (alsoUseSquares) {
    const slot = Math.floor(Math.random() * (images.length + 1));
    return slot === images.length ? null : images[slot];
  }
  return images[Math.floor(Math.random() * images.length)];
}
