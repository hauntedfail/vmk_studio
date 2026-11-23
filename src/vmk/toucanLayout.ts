export interface MinimalKeyRect {
  x: number;
  y: number;
  width: number;
  height: number;
  r?: number;
  rx?: number;
  ry?: number;
}

/**
 * Extra horizontal shift (in 1u key units) applied visually to the Toucan 2 right half
 * so the center split gap accommodates both the left-half inner Sharp Memory LCD cover
 * and the right-half inner controller cover + protruding -24 deg Azoteq TPS43 trackpad.
 */
export const TOUCAN_RIGHT_HALF_SHIFT_U = 3.35;
export const TOUCAN_CANVAS_PAD_X = 0.25;
export const TOUCAN_CANVAS_PAD_Y = 0.22;
export const TOUCAN_CANVAS_WIDTH = 14.0 + TOUCAN_RIGHT_HALF_SHIFT_U + TOUCAN_CANVAS_PAD_X * 2;
export const TOUCAN_CANVAS_HEIGHT = 4.95 + TOUCAN_CANVAS_PAD_Y;

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

/**
 * Maps a raw Toucan 2 key rect from `config/toucan.json` into the faithful hardware canvas space.
 * Preserves all key indices and rotations; shifts right-half keys right by TOUCAN_RIGHT_HALF_SHIFT_U.
 */
export function transformToucanKeyRect<T extends MinimalKeyRect>(p: T): T {
  const isRightHalf = p.x >= 7.0;
  const dx = TOUCAN_CANVAS_PAD_X + (isRightHalf ? TOUCAN_RIGHT_HALF_SHIFT_U : 0);
  const dy = TOUCAN_CANVAS_PAD_Y;
  return {
    ...p,
    x: p.x + dx,
    y: p.y + dy,
    rx: p.rx !== undefined ? p.rx + dx : undefined,
    ry: p.ry !== undefined ? p.ry + dy : undefined,
  };
}
