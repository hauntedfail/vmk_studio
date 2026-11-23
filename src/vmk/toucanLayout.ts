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
 * Kailh Choc v1 key pitch is 18 mm wide x 17 mm tall (~0.92 vertical aspect in top-down view),
 * avoiding the vertically stretched look of naive 1:1 MX square scaling.
 */
export const TOUCAN_CHOC_Y_SCALE = 0.92;

/**
 * Extra horizontal shift (in 1u key units) applied visually to the Toucan 2 right half
 * so the center split gap matches the real beekeeb Toucan 2 hardware (left-half inner
 * Sharp Memory LCD cover + desk gap + protruding -24.5° Azoteq TPS43 trackpad).
 */
export const TOUCAN_RIGHT_HALF_SHIFT_U = 3.45;
export const TOUCAN_CANVAS_PAD_X = 0.25;
export const TOUCAN_CANVAS_PAD_Y = 0.18;
export const TOUCAN_CANVAS_WIDTH =
  14.0 + TOUCAN_RIGHT_HALF_SHIFT_U + TOUCAN_CANVAS_PAD_X * 2;
export const TOUCAN_CANVAS_HEIGHT =
  5.26 * TOUCAN_CHOC_Y_SCALE + TOUCAN_CANVAS_PAD_Y * 2;

/**
 * Real-hardware calibrated thumb cluster positions (in pre-scaled 1u units, rotated around key center)
 * measured from top-down beekeeb Toucan 2 hardware:
 * - Left thumbs (indices 36, 37, 38) fan cleanly below C/V/B and under the glossy LCD cover.
 * - Right thumbs (indices 39, 40, 41) are the exact horizontal mirror (14.0 - cx).
 */
const TOUCAN_CALIBRATED_THUMBS: Record<
  number,
  { cx: number; cy: number; r: number; rightHalf: boolean }
> = {
  36: { cx: 4.22, cy: 3.78, r: -4, rightHalf: false },
  37: { cx: 5.38, cy: 3.86, r: 12, rightHalf: false },
  38: { cx: 6.50, cy: 4.24, r: 27, rightHalf: false },
  39: { cx: 14.0 - 6.50, cy: 4.24, r: -27, rightHalf: true },
  40: { cx: 14.0 - 5.38, cy: 3.86, r: -12, rightHalf: true },
  41: { cx: 14.0 - 4.22, cy: 3.78, r: 4, rightHalf: true },
};

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
 * Maps a raw Toucan 2 key rect from `config/toucan.json` into the faithful Choc v1 hardware canvas space.
 * Applies TOUCAN_CHOC_Y_SCALE vertically so keycaps and case proportions match the real 3.5:1 Toucan 2.
 */
export function transformToucanKeyRect<T extends MinimalKeyRect>(
  p: T,
  index?: number
): T {
  const ys = TOUCAN_CHOC_Y_SCALE;
  const scaledH = p.height * ys;
  const thumb =
    index !== undefined ? TOUCAN_CALIBRATED_THUMBS[index] : undefined;
  if (thumb) {
    const dx =
      TOUCAN_CANVAS_PAD_X + (thumb.rightHalf ? TOUCAN_RIGHT_HALF_SHIFT_U : 0);
    const dy = TOUCAN_CANVAS_PAD_Y;
    const cx = thumb.cx + dx;
    const cy = thumb.cy * ys + dy;
    return {
      ...p,
      x: cx - p.width / 2,
      y: cy - scaledH / 2,
      height: scaledH,
      r: thumb.r,
      rx: cx,
      ry: cy,
    };
  }

  const isRightHalf = p.x >= 7.0;
  const dx = TOUCAN_CANVAS_PAD_X + (isRightHalf ? TOUCAN_RIGHT_HALF_SHIFT_U : 0);
  const dy = TOUCAN_CANVAS_PAD_Y;
  return {
    ...p,
    x: p.x + dx,
    y: p.y * ys + dy,
    height: scaledH,
    rx: p.rx !== undefined ? p.rx + dx : undefined,
    ry: p.ry !== undefined ? p.ry * ys + dy : undefined,
  };
}
