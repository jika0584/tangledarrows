import { ArrowDefinition, Level } from '../../levels/types';
import { OccupancyIndex } from './Grid';
import { resolveSlide } from './Collision';

/**
 * One complete clear of the board: every successful tap removes one arrow, so
 * every solution has the same number of moves. Among those, pick the route
 * with the smallest total slide distance (the fastest visual clear). When
 * several arrows can leave at once, the shortest slide is taken first.
 */
export function shortestSolution(level: Level): string[] | null {
  let remaining: ArrowDefinition[] = level.arrows.map((arrow) => ({
    ...arrow,
    cells: arrow.cells.map((cell) => ({ ...cell })),
  }));
  const order: string[] = [];

  while (remaining.length > 0) {
    const occupancy = new OccupancyIndex(remaining);
    let best: ArrowDefinition | null = null;
    let bestDistance = Infinity;
    for (const arrow of remaining) {
      const result = resolveSlide(arrow, level.grid, occupancy);
      if (result.outcome !== 'escaped') continue;
      if (
        result.distance < bestDistance ||
        (result.distance === bestDistance && best !== null && arrow.id.localeCompare(best.id) < 0) ||
        (result.distance === bestDistance && best === null)
      ) {
        best = arrow;
        bestDistance = result.distance;
      }
    }
    if (!best) return null;
    order.push(best.id);
    remaining = remaining.filter((arrow) => arrow.id !== best.id);
  }

  return order;
}
