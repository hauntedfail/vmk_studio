export interface MinimalKeyRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const TOUCAN_HARDWARE_CANVAS_BOTTOM = 6.18;

/**
 * Detects whether a physical layout matches the beekeeb Toucan 2 42-key split footprint
 * (3x6+3 left half at x < 6.5, 3x6+3 right half at x >= 7.5).
 */
export function isToucanSplitLayout(positions: MinimalKeyRect[]): boolean {
  if (positions.length !== 42) return false;
  let leftCount = 0;
  let rightCount = 0;
  let maxX = 0;
  for (const p of positions) {
    if (p.x < 6.5) leftCount += 1;
    if (p.x >= 7.5) rightCount += 1;
    maxX = Math.max(maxX, p.x + p.width);
  }
  return leftCount === 21 && rightCount === 21 && maxX >= 13.5 && maxX <= 15.0;
}
