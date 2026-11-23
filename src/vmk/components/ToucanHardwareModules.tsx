import type { FirmwareModel } from "../types";
import {
  TOUCAN_CANVAS_PAD_X,
  TOUCAN_CANVAS_PAD_Y,
  TOUCAN_RIGHT_HALF_SHIFT_U,
} from "../toucanLayout";

export type ToucanHardwareModuleId = "lcd" | "trackpad";

export interface ToucanHardwareOverlayProps {
  firmwareModel?: FirmwareModel | null;
  activeLayerName?: string;
  selectedModule?: ToucanHardwareModuleId | null;
  onSelectModule?: (module: ToucanHardwareModuleId) => void;
}

// Exact coordinates from boards/shields/nice_view_gem/widgets/battery_arc.c & battery_arc_peripheral.c
const BAT_DOTS_LEFT: ReadonlyArray<[number, number]> = [
  [14, 53],
  [12, 43],
  [14, 32],
  [21, 24],
  [31, 20],
  [41, 20],
  [51, 24],
  [58, 32],
  [60, 43],
  [58, 53],
];

const BAT_DOTS_RIGHT: ReadonlyArray<[number, number]> = [
  [86, 53],
  [84, 43],
  [86, 32],
  [93, 24],
  [103, 20],
  [113, 20],
  [123, 24],
  [130, 32],
  [132, 43],
  [130, 53],
];

// 30-column sample WPM history for chart.c (CHART_COLS=30, CHART_ROWS=6, CHART_X=12, CHART_Y=78)
const SAMPLE_WPM_ROWS: ReadonlyArray<number> = [
  1, 2, 1, 3, 4, 3, 2, 4, 5, 4, 3, 5, 6, 5, 4,
  3, 4, 5, 4, 3, 2, 4, 5, 6, 5, 4, 3, 4, 5, 3,
];

/**
 * Pixel-faithful SVG replica (144x168) of Toucan 2's Sharp Memory-in-Pixel (MIP) LCD
 * derived directly from `boards/shields/nice_view_gem/widgets/*.c` (styles 0, 1, 2).
 */
export function ToucanLcdScreenPreview({
  styleIndex,
  layerName = "BASE",
  cgSwapEnabled = true,
  activeProfile = 0,
  leftBattery = 96,
  rightBattery = 88,
  transport = "BLE",
}: {
  styleIndex: number;
  layerName?: string;
  cgSwapEnabled?: boolean;
  activeProfile?: number;
  leftBattery?: number;
  rightBattery?: number;
  transport?: "BLE" | "USB";
  compact?: boolean;
}) {
  const safeLayer = (layerName || "BASE").toUpperCase().slice(0, 6);
  const leftFilled = Math.min(10, Math.ceil(leftBattery / 10));
  const rightFilled = Math.min(10, Math.ceil(rightBattery / 10));

  // Reflective Sharp Memory LCD appearance (dark ink on silver-grey MIP glass, matching real Toucan 2)
  const bg = "#c5cbc4";
  const fg = "#171a18";
  const subGrid = "rgba(23,26,24,0.06)";

  return (
    <svg
      viewBox="0 0 144 168"
      className="w-full h-full block rounded-[2px] select-none"
      shapeRendering="crispEdges"
      role="img"
      aria-label={`Toucan 2 Sharp Memory LCD Style ${styleIndex} (${safeLayer})`}
    >
      <defs>
        <pattern
          id="toucan-mip-grid"
          width="4"
          height="4"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 4 0 L 0 0 0 4"
            fill="none"
            stroke={subGrid}
            strokeWidth="0.6"
          />
        </pattern>
        <linearGradient id="toucan-mip-sheen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.16" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity="0.02" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.08" />
        </linearGradient>
      </defs>

      {/* Reflective MIP Panel Substrate */}
      <rect x="0" y="0" width="144" height="168" fill={bg} />
      <rect x="0" y="0" width="144" height="168" fill="url(#toucan-mip-grid)" />

      {styleIndex === 2 ? (
        <>
          {/* Left battery horseshoe arc (battery_arc.c) */}
          {BAT_DOTS_LEFT.map(([cx, cy], idx) => (
            <circle
              key={`bl-${idx}`}
              cx={cx}
              cy={cy}
              r={3}
              fill={idx < leftFilled ? fg : bg}
              stroke={fg}
              strokeWidth={idx < leftFilled ? 0 : 1.1}
            />
          ))}
          <text
            x="37"
            y="41"
            textAnchor="middle"
            fill={fg}
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            fontSize="13"
            fontWeight="800"
          >
            L
          </text>
          <text
            x="37"
            y="53"
            textAnchor="middle"
            fill={fg}
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            fontSize="9"
            fontWeight="700"
          >
            {leftBattery}
          </text>

          {/* Right peripheral battery horseshoe arc (battery_arc_peripheral.c) */}
          {BAT_DOTS_RIGHT.map(([cx, cy], idx) => (
            <circle
              key={`br-${idx}`}
              cx={cx}
              cy={cy}
              r={3}
              fill={idx < rightFilled ? fg : bg}
              stroke={fg}
              strokeWidth={idx < rightFilled ? 0 : 1.1}
            />
          ))}
          <text
            x="109"
            y="41"
            textAnchor="middle"
            fill={fg}
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            fontSize="13"
            fontWeight="800"
          >
            R
          </text>
          <text
            x="109"
            y="53"
            textAnchor="middle"
            fill={fg}
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            fontSize="9"
            fontWeight="700"
          >
            {rightBattery}
          </text>

          {/* WPM dotted pixel chart (chart.c: 30 cols x 6 rows at x=12, y=78) */}
          {SAMPLE_WPM_ROWS.map((filledRows, col) =>
            Array.from({ length: filledRows }, (_, row) => {
              const x = 12 + col * 4;
              const y = 78 + (5 - row) * 4;
              return (
                <rect
                  key={`c-${col}-${row}`}
                  x={x}
                  y={y}
                  width={2.4}
                  height={2.4}
                  rx={0.5}
                  fill={fg}
                />
              );
            })
          )}

          {/* Layer label right-aligned (layer_arc.c: x=-23, y=115, width=144 -> right edge 121) */}
          <text
            x="118"
            y="131"
            textAnchor="end"
            fill={fg}
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            fontSize="20"
            fontWeight="800"
            letterSpacing="0.5"
          >
            {safeLayer}
          </text>

          {/* Output transport right-aligned (output_arc.c: x=-18, y=143, width=136 -> right edge 118) */}
          <text
            x="118"
            y="153"
            textAnchor="end"
            fill={fg}
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            fontSize="10"
            fontWeight="700"
            letterSpacing="1"
          >
            {transport}
          </text>

          {/* Subtle CG indicator left of output when enabled */}
          {cgSwapEnabled && (
            <text
              x="12"
              y="153"
              textAnchor="start"
              fill={fg}
              opacity="0.55"
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fontSize="8.5"
              fontWeight="700"
            >
              CG
            </text>
          )}

          {/* 5 vertical BLE profile squares (profile_arc.c: x=126, y=105 + i*10, size=8) */}
          {[0, 1, 2, 3, 4].map((i) => {
            const active = i === activeProfile;
            return (
              <rect
                key={`pa-${i}`}
                x={126}
                y={105 + i * 10}
                width={8}
                height={8}
                rx={active ? 0 : 1.5}
                fill={active ? fg : bg}
                stroke={fg}
                strokeWidth={active ? 0 : 1.2}
              />
            );
          })}
        </>
      ) : (
        <>
          {/* Styles 0 & 1: Horizontal L & R battery bars (battery.c x=8 y=10, battery_peripheral.c x=80 y=10) */}
          <g transform="translate(8, 10)">
            <rect x="0" y="0" width="52" height="18" rx="2" fill="none" stroke={fg} strokeWidth="1.5" />
            <rect x="52" y="5" width="3" height="8" fill={fg} />
            <rect x="3" y="3" width={Math.round((46 * leftBattery) / 100)} height="12" fill={fg} />
            <text
              x="10"
              y="13"
              fill={bg}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fontSize="9"
              fontWeight="800"
            >
              L {leftBattery}
            </text>
          </g>
          <g transform="translate(80, 10)">
            <rect x="0" y="0" width="52" height="18" rx="2" fill="none" stroke={fg} strokeWidth="1.5" />
            <rect x="52" y="5" width="3" height="8" fill={fg} />
            <rect x="3" y="3" width={Math.round((46 * rightBattery) / 100)} height="12" fill={fg} />
            <text
              x="10"
              y="13"
              fill={bg}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fontSize="9"
              fontWeight="800"
            >
              R {rightBattery}
            </text>
          </g>

          {styleIndex === 1 ? (
            <>
              {/* Toucan geometric emblem (layer_logo.c: y=40) */}
              <g transform="translate(46, 40)">
                <path
                  d="M 10 38 C 10 18 22 6 38 6 C 48 6 54 12 56 20 C 46 21 40 24 34 26 C 31 35 24 44 10 44 Z"
                  fill={fg}
                />
                <circle cx="30" cy="17" r="2.8" fill={bg} />
                <path d="M 38 14 L 54 19" stroke={bg} strokeWidth="1.4" />
              </g>
              {/* Centered layer name (layer_logo.c: y=100) */}
              <text
                x="72"
                y="116"
                textAnchor="middle"
                fill={fg}
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                fontSize="20"
                fontWeight="800"
                letterSpacing="1"
              >
                {safeLayer}
              </text>
            </>
          ) : (
            /* Style 0: Large centered layer name (layer.c: y=70) */
            <text
              x="72"
              y="92"
              textAnchor="middle"
              fill={fg}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fontSize="26"
              fontWeight="800"
              letterSpacing="1.2"
            >
              {safeLayer}
            </text>
          )}

          {/* Bottom-left output (output.c: x=12, y=140) */}
          <text
            x="12"
            y="151"
            textAnchor="start"
            fill={fg}
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            fontSize="10"
            fontWeight="700"
            letterSpacing="1"
          >
            {transport}
          </text>

          {/* Bottom-right 5 horizontal profile squares (profile.c: x=85 + i*10, y=143, size=8) */}
          {[0, 1, 2, 3, 4].map((i) => {
            const active = i === activeProfile;
            return (
              <rect
                key={`ph-${i}`}
                x={85 + i * 10}
                y={143}
                width={8}
                height={8}
                rx={active ? 0 : 1.5}
                fill={active ? fg : bg}
                stroke={fg}
                strokeWidth={active ? 0 : 1.2}
              />
            );
          })}
        </>
      )}

      {/* Subtle glass reflection sheen */}
      <rect x="0" y="0" width="144" height="168" fill="url(#toucan-mip-sheen)" />
    </svg>
  );
}

/**
 * Renders the authentic beekeeb Toucan 2 split case silhouette (black 3D-printed outer shell,
 * brushed anodized silver aluminum switch plate, top-outer matte-black acrylic blocker strips
 * with M2 screws, and right-half inner matte-black controller cover) behind the 42 keys.
 */
export function ToucanCaseBackdrop({ oneU }: { oneU: number }) {
  const px = TOUCAN_CANVAS_PAD_X;
  const py = TOUCAN_CANVAS_PAD_Y;
  const rs = TOUCAN_RIGHT_HALF_SHIFT_U;

  const W = (14.0 + rs + px * 2) * oneU;
  const H = (4.95 + py) * oneU;
  const u = (val: number) => val * oneU;

  // Left half outer shell (in keycap units, offset by px, py)
  const leftOuterPath = [
    `M ${u(px - 0.14)} ${u(py + 0.24)}`,
    `Q ${u(px - 0.14)} ${u(py + 0.06)} ${u(px + 0.04)} ${u(py + 0.06)}`,
    `L ${u(px + 2.86)} ${u(py + 0.06)}`,
    `L ${u(px + 2.94)} ${u(py - 0.12)}`,
    `L ${u(px + 4.06)} ${u(py - 0.12)}`,
    `L ${u(px + 4.14)} ${u(py + 0.08)}`,
    `L ${u(px + 7.38)} ${u(py + 0.08)}`,
    `Q ${u(px + 7.56)} ${u(py + 0.08)} ${u(px + 7.56)} ${u(py + 0.26)}`,
    `L ${u(px + 7.56)} ${u(py + 3.68)}`,
    `Q ${u(px + 7.56)} ${u(py + 3.86)} ${u(px + 7.42)} ${u(py + 4.00)}`,
    `L ${u(px + 6.62)} ${u(py + 4.80)}`,
    `Q ${u(px + 6.46)} ${u(py + 4.94)} ${u(px + 6.24)} ${u(py + 4.86)}`,
    `L ${u(px + 5.34)} ${u(py + 4.46)}`,
    `L ${u(px + 4.46)} ${u(py + 4.26)}`,
    `L ${u(px + 3.52)} ${u(py + 4.26)}`,
    `Q ${u(px + 3.16)} ${u(py + 4.26)} ${u(px + 2.84)} ${u(py + 3.96)}`,
    `Q ${u(px + 2.52)} ${u(py + 3.66)} ${u(px + 2.10)} ${u(py + 3.66)}`,
    `L ${u(px + 0.04)} ${u(py + 3.66)}`,
    `Q ${u(px - 0.14)} ${u(py + 3.66)} ${u(px - 0.14)} ${u(py + 3.48)}`,
    `Z`,
  ].join(" ");

  // Left half anodized silver aluminum switch plate inset
  const leftPlatePath = [
    `M ${u(px - 0.04)} ${u(py + 0.34)}`,
    `L ${u(px + 2.02)} ${u(py + 0.34)}`,
    `L ${u(px + 2.02)} ${u(py + 0.14)}`,
    `L ${u(px + 2.98)} ${u(py + 0.14)}`,
    `L ${u(px + 2.98)} ${u(py - 0.04)}`,
    `L ${u(px + 4.02)} ${u(py - 0.04)}`,
    `L ${u(px + 4.02)} ${u(py + 0.14)}`,
    `L ${u(px + 6.08)} ${u(py + 0.14)}`,
    `L ${u(px + 6.08)} ${u(py + 3.24)}`,
    `L ${u(px + 7.22)} ${u(py + 3.74)}`,
    `L ${u(px + 6.46)} ${u(py + 4.74)}`,
    `L ${u(px + 5.38)} ${u(py + 4.36)}`,
    `L ${u(px + 4.46)} ${u(py + 4.16)}`,
    `L ${u(px + 3.48)} ${u(py + 4.16)}`,
    `Q ${u(px + 3.14)} ${u(py + 4.16)} ${u(px + 2.86)} ${u(py + 3.88)}`,
    `Q ${u(px + 2.58)} ${u(py + 3.56)} ${u(px + 2.12)} ${u(py + 3.56)}`,
    `L ${u(px + 0.02)} ${u(py + 3.56)}`,
    `Q ${u(px - 0.04)} ${u(py + 3.56)} ${u(px - 0.04)} ${u(py + 3.46)}`,
    `Z`,
  ].join(" ");

  // Right half mirrored coordinates (mirror axis across center of full width)
  const totalU = 14.0 + rs + px * 2;
  const rxOrigin = px + rs; // right-half raw x=0 maps to rxOrigin

  const rightOuterPath = [
    `M ${u(rxOrigin + 14.14)} ${u(py + 0.24)}`,
    `Q ${u(rxOrigin + 14.14)} ${u(py + 0.06)} ${u(rxOrigin + 13.96)} ${u(py + 0.06)}`,
    `L ${u(rxOrigin + 11.14)} ${u(py + 0.06)}`,
    `L ${u(rxOrigin + 11.06)} ${u(py - 0.12)}`,
    `L ${u(rxOrigin + 9.94)} ${u(py - 0.12)}`,
    `L ${u(rxOrigin + 9.86)} ${u(py + 0.08)}`,
    `L ${u(rxOrigin + 6.62)} ${u(py + 0.08)}`,
    `Q ${u(rxOrigin + 6.44)} ${u(py + 0.08)} ${u(rxOrigin + 6.44)} ${u(py + 0.26)}`,
    `L ${u(rxOrigin + 6.44)} ${u(py + 3.68)}`,
    `Q ${u(rxOrigin + 6.44)} ${u(py + 3.86)} ${u(rxOrigin + 6.58)} ${u(py + 4.00)}`,
    `L ${u(rxOrigin + 7.38)} ${u(py + 4.80)}`,
    `Q ${u(rxOrigin + 7.54)} ${u(py + 4.94)} ${u(rxOrigin + 7.76)} ${u(py + 4.86)}`,
    `L ${u(rxOrigin + 8.66)} ${u(py + 4.46)}`,
    `L ${u(rxOrigin + 9.54)} ${u(py + 4.26)}`,
    `L ${u(rxOrigin + 10.48)} ${u(py + 4.26)}`,
    `Q ${u(rxOrigin + 10.84)} ${u(py + 4.26)} ${u(rxOrigin + 11.16)} ${u(py + 3.96)}`,
    `Q ${u(rxOrigin + 11.48)} ${u(py + 3.66)} ${u(rxOrigin + 11.90)} ${u(py + 3.66)}`,
    `L ${u(rxOrigin + 13.96)} ${u(py + 3.66)}`,
    `Q ${u(rxOrigin + 14.14)} ${u(py + 3.66)} ${u(rxOrigin + 14.14)} ${u(py + 3.48)}`,
    `Z`,
  ].join(" ");

  const rightPlatePath = [
    `M ${u(rxOrigin + 14.04)} ${u(py + 0.34)}`,
    `L ${u(rxOrigin + 11.98)} ${u(py + 0.34)}`,
    `L ${u(rxOrigin + 11.98)} ${u(py + 0.14)}`,
    `L ${u(rxOrigin + 11.02)} ${u(py + 0.14)}`,
    `L ${u(rxOrigin + 11.02)} ${u(py - 0.04)}`,
    `L ${u(rxOrigin + 9.98)} ${u(py - 0.04)}`,
    `L ${u(rxOrigin + 9.98)} ${u(py + 0.14)}`,
    `L ${u(rxOrigin + 7.92)} ${u(py + 0.14)}`,
    `L ${u(rxOrigin + 7.92)} ${u(py + 3.24)}`,
    `L ${u(rxOrigin + 6.78)} ${u(py + 3.74)}`,
    `L ${u(rxOrigin + 7.54)} ${u(py + 4.74)}`,
    `L ${u(rxOrigin + 8.62)} ${u(py + 4.36)}`,
    `L ${u(rxOrigin + 9.54)} ${u(py + 4.16)}`,
    `L ${u(rxOrigin + 10.52)} ${u(py + 4.16)}`,
    `Q ${u(rxOrigin + 10.86)} ${u(py + 4.16)} ${u(rxOrigin + 11.14)} ${u(py + 3.88)}`,
    `Q ${u(rxOrigin + 11.42)} ${u(py + 3.56)} ${u(rxOrigin + 11.88)} ${u(py + 3.56)}`,
    `L ${u(rxOrigin + 13.98)} ${u(py + 3.56)}`,
    `Q ${u(rxOrigin + 14.04)} ${u(py + 3.56)} ${u(rxOrigin + 14.04)} ${u(py + 3.46)}`,
    `Z`,
  ].join(" ");

  // Right-half vertical matte-black acrylic controller cover (behind protruding trackpad)
  const rightAcrylicCover = [
    `M ${u(rxOrigin + 6.56)} ${u(py + 0.24)}`,
    `Q ${u(rxOrigin + 6.56)} ${u(py + 0.16)} ${u(rxOrigin + 6.64)} ${u(py + 0.16)}`,
    `L ${u(rxOrigin + 7.82)} ${u(py + 0.16)}`,
    `Q ${u(rxOrigin + 7.90)} ${u(py + 0.16)} ${u(rxOrigin + 7.90)} ${u(py + 0.24)}`,
    `L ${u(rxOrigin + 7.90)} ${u(py + 3.12)}`,
    `L ${u(rxOrigin + 6.64)} ${u(py + 3.68)}`,
    `Q ${u(rxOrigin + 6.56)} ${u(py + 3.71)} ${u(rxOrigin + 6.56)} ${u(py + 3.62)}`,
    `Z`,
  ].join(" ");

  // Trackpad 3D-printed ear cradle beneath the angled TPS43 pad
  const tpCx = u(rxOrigin + 6.32);
  const tpCy = u(py + 2.60);
  const tpEarW = u(2.30);
  const tpEarH = u(2.24);

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="pointer-events-none absolute top-0 left-0 z-0 overflow-visible"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="toucan-alu-plate" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#dce0e4" />
          <stop offset="48%" stopColor="#c7ccd1" />
          <stop offset="100%" stopColor="#aeb4bb" />
        </linearGradient>
        <linearGradient id="toucan-shell" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#26272b" />
          <stop offset="100%" stopColor="#141518" />
        </linearGradient>
        <linearGradient id="toucan-acrylic-matte" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#232529" />
          <stop offset="100%" stopColor="#15171a" />
        </linearGradient>
        <filter id="toucan-case-shadow" x="-8%" y="-10%" width="116%" height="128%">
          <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#000000" floodOpacity="0.32" />
        </filter>
      </defs>

      {/* Left Half Case + Anodized Silver Switch Plate */}
      <g filter="url(#toucan-case-shadow)">
        <path
          d={leftOuterPath}
          fill="url(#toucan-shell)"
          stroke="rgba(255,255,255,0.09)"
          strokeWidth="1.2"
        />
        <path
          d={leftPlatePath}
          fill="url(#toucan-alu-plate)"
          stroke="rgba(0,0,0,0.35)"
          strokeWidth="0.9"
        />
        {/* Left Top-Outer Pinky Blocker Strip (2 M2 screws) */}
        <rect
          x={u(px - 0.04)}
          y={u(py + 0.12)}
          width={u(1.98)}
          height={u(0.24)}
          rx={u(0.05)}
          fill="url(#toucan-acrylic-matte)"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="0.8"
        />
        <circle cx={u(px + 0.14)} cy={u(py + 0.24)} r={u(0.045)} fill="#52555d" />
        <circle cx={u(px + 1.78)} cy={u(py + 0.24)} r={u(0.045)} fill="#52555d" />
      </g>

      {/* Right Half Case + Trackpad Ear Cradle + Anodized Silver Switch Plate */}
      <g filter="url(#toucan-case-shadow)">
        {/* Integrated 3D-printed angled ear for TPS43 trackpad */}
        <g transform={`rotate(-25 ${tpCx} ${tpCy})`}>
          <rect
            x={tpCx - tpEarW / 2}
            y={tpCy - tpEarH / 2}
            width={tpEarW}
            height={tpEarH}
            rx={u(0.18)}
            fill="url(#toucan-shell)"
            stroke="rgba(255,255,255,0.09)"
            strokeWidth="1.2"
          />
        </g>
        <path
          d={rightOuterPath}
          fill="url(#toucan-shell)"
          stroke="rgba(255,255,255,0.09)"
          strokeWidth="1.2"
        />
        <path
          d={rightPlatePath}
          fill="url(#toucan-alu-plate)"
          stroke="rgba(0,0,0,0.35)"
          strokeWidth="0.9"
        />
        {/* Right Inner Matte-Black Acrylic Controller Cover (beside Y/H/N, behind trackpad) */}
        <path
          d={rightAcrylicCover}
          fill="url(#toucan-acrylic-matte)"
          stroke="rgba(255,255,255,0.09)"
          strokeWidth="0.9"
        />
        {/* M2 screw heads on right inner cover */}
        <circle cx={u(rxOrigin + 7.72)} cy={u(py + 0.30)} r={u(0.045)} fill="#5c6068" />
        <circle cx={u(rxOrigin + 7.72)} cy={u(py + 3.00)} r={u(0.045)} fill="#5c6068" />

        {/* Right Top-Outer Pinky Blocker Strip (2 M2 screws) */}
        <rect
          x={u(rxOrigin + 12.06)}
          y={u(py + 0.12)}
          width={u(1.98)}
          height={u(0.24)}
          rx={u(0.05)}
          fill="url(#toucan-acrylic-matte)"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="0.8"
        />
        <circle cx={u(rxOrigin + 12.24)} cy={u(py + 0.24)} r={u(0.045)} fill="#52555d" />
        <circle cx={u(rxOrigin + 13.86)} cy={u(py + 0.24)} r={u(0.045)} fill="#52555d" />
      </g>

      {/* Keep totalU referenced cleanly */}
      <rect x="0" y="0" width={u(totalU)} height="0" fill="none" />
    </svg>
  );
}

/**
 * Interactive Toucan 2 hardware overlays positioned faithfully to the real keyboard:
 * - Left half: Inner glossy-black acrylic cover & 144x168 Sharp Memory LCD beside T/G/B
 * - Right half: Inner protruding Azoteq TPS43 matte-glass trackpad tilted -25° above-left of thumb 0
 */
export function ToucanHardwareModules({
  oneU,
  firmwareModel,
  activeLayerName = "BASE",
  selectedModule,
  onSelectModule,
}: ToucanHardwareOverlayProps & { oneU: number }) {
  const px = TOUCAN_CANVAS_PAD_X;
  const py = TOUCAN_CANVAS_PAD_Y;
  const rs = TOUCAN_RIGHT_HALF_SHIFT_U;
  const rxOrigin = px + rs;

  const statusStyle = firmwareModel?.conf.statusScreenStyle ?? 2;
  const cgSwapEnabled = firmwareModel?.conf.cgToggleEnabled ?? true;

  const tpEnabled = firmwareModel?.leftOverlayGates.trackpadListenerEnabled ?? true;
  const xyMul = firmwareModel?.trackpadProcessors.xyScaleMul ?? 100;
  const xyDiv = firmwareModel?.trackpadProcessors.xyScaleDiv ?? 100;
  const scrMul = firmwareModel?.trackpadProcessors.scrollScaleMul ?? 1;
  const scrDiv = firmwareModel?.trackpadProcessors.scrollScaleDiv ?? 20;

  const lcdSelected = selectedModule === "lcd";
  const tpSelected = selectedModule === "trackpad";

  // Left inner glossy-black acrylic display cover: x = 6.10..7.44, y = 0.16..3.70 (1.34u x 3.54u)
  const lcdCoverStyle = {
    left: (px + 6.10) * oneU,
    top: (py + 0.16) * oneU,
    width: 1.34 * oneU,
    height: 3.54 * oneU,
    clipPath: "polygon(0% 0%, 100% 0%, 100% 100%, 0% 84%)",
  };

  // Active Sharp Memory LCD window inside cover: 1.14u x 1.33u (exact 144:168 ratio), beside T/G
  const lcdWindowStyle = {
    left: 0.10 * oneU,
    top: 0.66 * oneU,
    width: 1.14 * oneU,
    height: 1.33 * oneU,
  };

  // Right protruding Azoteq TPS43 matte-glass trackpad: centered at (rxOrigin + 6.32, py + 2.60), -25°
  const tpW = 2.10 * oneU;
  const tpH = 2.02 * oneU;
  const tpStyle = {
    left: (rxOrigin + 6.32) * oneU - tpW / 2,
    top: (py + 2.60) * oneU - tpH / 2,
    width: tpW,
    height: tpH,
    transform: "rotate(-25deg)",
  };

  return (
    <>
      {/* Left Half: Glossy-Black Acrylic Display Cover + Sharp Memory LCD (144x168 MIP) */}
      <button
        type="button"
        data-vmk-hardware="lcd"
        onClick={() => onSelectModule?.("lcd")}
        title={`Toucan 2 Sharp Memory LCD (144×168 MIP · Style ${statusStyle}) — click to inspect & customise`}
        style={lcdCoverStyle}
        className={`absolute group text-left rounded-t-[6px] transition-all cursor-pointer overflow-hidden ${
          lcdSelected
            ? "z-20 ring-2 ring-[#FC4C01] shadow-[0_0_0_2px_rgba(252,76,1,0.45)]"
            : "z-20 hover:brightness-110"
        }`}
      >
        {/* Glossy black acrylic substrate */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(155deg, #25272c 0%, #0d0e10 42%, #181a1f 68%, #090a0c 100%)",
            border: lcdSelected
              ? "1.5px solid #FC4C01"
              : "1px solid rgba(255,255,255,0.14)",
            borderRadius: "6px 6px 2px 2px",
          }}
        />
        {/* Subtle acrylic diagonal specular highlight */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(125deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.02) 28%, transparent 52%, rgba(255,255,255,0.05) 100%)",
          }}
        />
        {/* M2 screw dots matching Toucan 2 glossy cover */}
        <span
          className="pointer-events-none absolute rounded-full bg-zinc-500/80 border border-black/60"
          style={{
            width: 0.09 * oneU,
            height: 0.09 * oneU,
            left: 0.14 * oneU,
            top: 0.12 * oneU,
          }}
        />
        <span
          className="pointer-events-none absolute rounded-full bg-zinc-500/80 border border-black/60"
          style={{
            width: 0.09 * oneU,
            height: 0.09 * oneU,
            right: 0.14 * oneU,
            bottom: 0.30 * oneU,
          }}
        />

        {/* Active Sharp Memory LCD window (144x168 portrait) */}
        <div
          style={lcdWindowStyle}
          className={`absolute rounded-[3px] overflow-hidden shadow-inner transition-all ${
            lcdSelected
              ? "ring-2 ring-[#FC4C01]"
              : "ring-1 ring-black/70 group-hover:ring-[#FC4C01]/70"
          }`}
        >
          <ToucanLcdScreenPreview
            styleIndex={statusStyle}
            layerName={activeLayerName}
            cgSwapEnabled={cgSwapEnabled}
          />
        </div>

        {/* Subtle hover/selected hint at bottom of acrylic bezel */}
        <div
          className={`pointer-events-none absolute inset-x-0 text-center font-mono transition-opacity ${
            lcdSelected ? "opacity-100 text-[#FC4C01]" : "opacity-0 group-hover:opacity-90 text-zinc-300"
          }`}
          style={{
            top: 2.16 * oneU,
            fontSize: Math.max(7, Math.round(0.14 * oneU)),
          }}
        >
          LCD · S{statusStyle}
        </div>
      </button>

      {/* Right Half: Azoteq TPS43 Matte-Glass Trackpad (43x40mm, tilted -25°) */}
      <button
        type="button"
        data-vmk-hardware="trackpad"
        onClick={() => onSelectModule?.("trackpad")}
        title={`Azoteq TPS43 Trackpad (43×40mm · XY ${xyMul}/${xyDiv} · Scroll ${scrMul}/${scrDiv}) — click to inspect & customise`}
        style={tpStyle}
        className={`absolute group rounded-[10px] transition-all cursor-pointer overflow-hidden ${
          tpSelected
            ? "z-30 ring-2 ring-[#FC4C01] shadow-[0_6px_18px_rgba(252,76,1,0.3)]"
            : "z-20 shadow-[0_4px_12px_rgba(0,0,0,0.45)] hover:ring-1 hover:ring-[#FC4C01]/70"
        }`}
      >
        {/* Custom matte-black glass overlay matching real Toucan 2 TPS43 */}
        <div
          className="absolute inset-0 rounded-[10px]"
          style={{
            background:
              "linear-gradient(145deg, #2d2f34 0%, #23252a 52%, #1a1c20 100%)",
            border: tpSelected
              ? "1.5px solid #FC4C01"
              : "1px solid rgba(255,255,255,0.12)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.10), inset 0 -1px 2px rgba(0,0,0,0.45)",
          }}
        />

        {/* Subtle matte glass micro-texture sheen */}
        <div
          className="pointer-events-none absolute inset-[3px] rounded-[7px]"
          style={{
            background:
              "radial-gradient(circle at 38% 30%, rgba(255,255,255,0.06), transparent 68%)",
            border: "1px solid rgba(0,0,0,0.35)",
          }}
        />

        {/* Status indicator dot shown only on hover or selection to keep resting matte glass authentic */}
        <span
          className={`pointer-events-none absolute top-2 right-2 w-1.5 h-1.5 rounded-full transition-opacity ${
            tpEnabled ? "bg-[#FC4C01]" : "bg-zinc-600"
          } ${tpSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
        />

        {/* Clean hover / selected micro-readout so resting state stays faithfully minimal like real matte glass */}
        <div
          className={`pointer-events-none relative z-10 h-full w-full flex flex-col items-center justify-center gap-0.5 font-mono transition-opacity ${
            tpSelected
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-95"
          }`}
        >
          <span className="text-[9px] font-semibold tracking-wider text-zinc-200">
            TPS43
          </span>
          <span className="text-[7.5px] text-zinc-400 tabular-nums">
            {xyMul}/{xyDiv} · {scrMul}/{scrDiv}
          </span>
        </div>
      </button>
    </>
  );
}
