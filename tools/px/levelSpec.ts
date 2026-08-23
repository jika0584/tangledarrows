const MAX_RANGE = 200;

/**
 * Parse a studio range such as `2-5`, `2 to 5`, or `1, 4, 8-10`.
 */
export function parseLevelSpec(text: string): number[] {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/\bto\b/g, '-')
    .replace(/\s+/g, '');
  if (!normalized) throw new Error('Enter a level range, for example 2-5.');

  const numbers = new Set<number>();
  for (const part of normalized.split(/[,;]+/)) {
    if (!part) continue;
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from < 1 || to < 1) throw new Error('Level numbers start at 1.');
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);
      if (hi - lo + 1 > MAX_RANGE) {
        throw new Error(`That range is too large (max ${MAX_RANGE} levels).`);
      }
      for (let n = lo; n <= hi; n++) numbers.add(n);
      continue;
    }
    if (!/^\d+$/.test(part)) {
      throw new Error(`Could not read "${part}". Try 2-5 or 2 to 5.`);
    }
    const n = Number(part);
    if (n < 1) throw new Error('Level numbers start at 1.');
    numbers.add(n);
  }

  if (numbers.size === 0) throw new Error('Enter a level range, for example 2-5.');
  if (numbers.size > MAX_RANGE) {
    throw new Error(`That range is too large (max ${MAX_RANGE} levels).`);
  }
  return [...numbers].sort((a, b) => a - b);
}
