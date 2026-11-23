import type { FirmwareModel } from "../types";

export type ToucanHardwareModuleId = "lcd" | "trackpad";

export interface ToucanHardwareOverlayProps {
  firmwareModel?: FirmwareModel | null;
  activeLayerName?: string;
  selectedModule?: ToucanHardwareModuleId | null;
  onSelectModule?: (module: ToucanHardwareModuleId) => void;
}

/**
 * Reusable faithful monochrome 144x168 Sharp Memory-in-Pixel (MIP) LCD preview
 * matching `boards/shields/nice_view_gem/widgets/screen.c` (CONFIG_TOUCAN_STATUS_SCREEN 0/1/2).
 */
export function ToucanLcdScreenPreview({
  styleIndex,
  layerName = "BASE",
  cgSwapEnabled = true,
  compact = false,
}: {
  styleIndex: number;
  layerName?: string;
  cgSwapEnabled?: boolean;
  compact?: boolean;
}) {
  const safeLayer = (layerName || "BASE").toUpperCase().slice(0, 6);
  const wpmBars = [3, 6, 4, 8, 10, 7, 11, 9, 12, 8];

  return (
    <div
      className="relative w-full h-full rounded-[6px] overflow-hidden select-none flex flex-col justify-between font-mono border border-black/25 dark:border-white/15"
      style={{
        backgroundColor: "var(--vmk-lcd-bg, #d8ddd4)",
        color: "var(--vmk-lcd-fg, #141714)",
        backgroundImage:
          "radial-gradient(rgba(0,0,0,0.06) 1px, transparent 0)",
        backgroundSize: "3px 3px",
        padding: compact ? "5px 6px" : "10px 11px",
      }}
    >
      {/* Top Row: Output + Profile */}
      <div className="flex items-center justify-between leading-none">
        <span
          className={`font-bold tracking-wider ${
            compact ? "text-[8px]" : "text-[10px]"
          }`}
        >
          {styleIndex === 2 ? "BLE" : "USB/BLE"}
        </span>
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <span
              key={n}
              className={`inline-block rounded-full border border-current ${
                compact ? "w-1.5 h-1.5" : "w-2 h-2"
              } ${n === 1 ? "bg-current" : "opacity-35"}`}
            />
          ))}
        </div>
      </div>

      {/* Middle Area: Varies by CONFIG_TOUCAN_STATUS_SCREEN */}
      {styleIndex === 2 ? (
        <div className="flex flex-col items-center gap-1 my-auto">
          {/* WPM mini chart (chart.c) */}
          <div
            className={`w-full flex items-end justify-between gap-[2px] border-b border-current/40 pb-0.5 ${
              compact ? "h-5" : "h-8"
            }`}
          >
            {wpmBars.map((h, i) => (
              <span
                key={i}
                className="flex-1 bg-current opacity-80 rounded-t-[1px]"
                style={{ height: `${Math.round((h / 12) * 100)}%` }}
              />
            ))}
          </div>
          {/* Layer arc badge (layer_arc.c) */}
          <div className="flex items-center justify-between w-full leading-none pt-0.5">
            <span
              className={`font-bold tracking-widest ${
                compact ? "text-[10px]" : "text-xs"
              }`}
            >
              {safeLayer}
            </span>
            <span
              className={`px-1 py-[1px] rounded-[2px] border border-current/60 font-semibold ${
                compact ? "text-[7px]" : "text-[9px]"
              }`}
            >
              {cgSwapEnabled ? "CG" : "STD"}
            </span>
          </div>
        </div>
      ) : styleIndex === 1 ? (
        <div className="flex flex-col items-center justify-center gap-1 my-auto">
          {/* Geometric Toucan emblem (layer_logo.c) */}
          <div
            className={`border border-current/70 rounded-sm px-1.5 py-0.5 font-bold tracking-widest ${
              compact ? "text-[8px]" : "text-[10px]"
            }`}
          >
            TOUCAN
          </div>
          <span
            className={`font-bold tracking-widest leading-none ${
              compact ? "text-[11px]" : "text-sm"
            }`}
          >
            {safeLayer}
          </span>
        </div>
      ) : (
        <div className="flex flex-col justify-center gap-1 my-auto border-y border-current/30 py-1">
          <div
            className={`flex justify-between leading-none ${
              compact ? "text-[8px]" : "text-[10px]"
            }`}
          >
            <span className="opacity-70">LYR</span>
            <span className="font-bold">{safeLayer}</span>
          </div>
          <div
            className={`flex justify-between leading-none ${
              compact ? "text-[8px]" : "text-[10px]"
            }`}
          >
            <span className="opacity-70">MAP</span>
            <span className="font-bold">{cgSwapEnabled ? "CG-SWAP" : "DIRECT"}</span>
          </div>
        </div>
      )}

      {/* Bottom Row: L & R Battery (battery_arc.c / battery_arc_peripheral.c) */}
      <div className="flex items-center justify-between gap-1.5 leading-none pt-0.5 border-t border-current/30">
        <div className="flex items-center gap-1">
          <span className={compact ? "text-[7px] font-bold" : "text-[9px] font-bold"}>
            L
          </span>
          <div
            className={`border border-current/70 p-[1px] rounded-[2px] ${
              compact ? "w-5 h-2" : "w-7 h-2.5"
            }`}
          >
            <div className="h-full w-[88%] bg-current" />
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span className={compact ? "text-[7px] font-bold" : "text-[9px] font-bold"}>
            R
          </span>
          <div
            className={`border border-current/70 p-[1px] rounded-[2px] ${
              compact ? "w-5 h-2" : "w-7 h-2.5"
            }`}
          >
            <div className="h-full w-[82%] bg-current" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders the Toucan 2 Sharp Memory LCD (left half) and Azoteq TPS43 Trackpad (right half)
 * directly in the PhysicalLayout coordinate grid so they scale cleanly with the 42 keys.
 */
export function ToucanHardwareModules({
  oneU,
  firmwareModel,
  activeLayerName = "BASE",
  selectedModule,
  onSelectModule,
}: ToucanHardwareOverlayProps & { oneU: number }) {
  const statusStyle = firmwareModel?.conf.statusScreenStyle ?? 2;
  const cgSwapEnabled = firmwareModel?.conf.cgToggleEnabled ?? true;

  const tpEnabled = firmwareModel?.leftOverlayGates.trackpadListenerEnabled ?? true;
  const pinchEnabled =
    (firmwareModel?.leftOverlayGates.zipZoomMapperEnabled ?? true) &&
    (firmwareModel?.trackpadHardware.zoom ?? true);
  const dtEnabled = firmwareModel?.leftOverlayGates.twoFingerDoubleTapEnabled ?? true;
  const swipeEnabled = firmwareModel?.trackpadHardware.threeFingerSwipe ?? true;
  const relayEnabled = firmwareModel?.conf.splitInputRelayEnabled ?? true;
  const xyMul = firmwareModel?.trackpadProcessors.xyScaleMul ?? 100;
  const xyDiv = firmwareModel?.trackpadProcessors.xyScaleDiv ?? 100;
  const scrMul = firmwareModel?.trackpadProcessors.scrollScaleMul ?? 1;
  const scrDiv = firmwareModel?.trackpadProcessors.scrollScaleDiv ?? 20;

  // Coordinates in keycap units (1u): positioned in Toucan 2's lower-left and lower-right bays
  const lcdStyle = {
    left: 0.45 * oneU,
    top: 3.58 * oneU,
    width: 2.24 * oneU,
    height: 2.48 * oneU,
  };

  const tpStyle = {
    left: 11.15 * oneU,
    top: 3.58 * oneU,
    width: 2.62 * oneU,
    height: 2.44 * oneU,
  };

  const lcdSelected = selectedModule === "lcd";
  const tpSelected = selectedModule === "trackpad";

  return (
    <>
      {/* Left Half: Sharp Memory LCD (144x168 MIP) */}
      <button
        type="button"
        data-vmk-hardware="lcd"
        onClick={() => onSelectModule?.("lcd")}
        title={`Toucan 2 Sharp Memory LCD (144×168 MIP · Style ${statusStyle}) — click to inspect & customise`}
        style={lcdStyle}
        className={`absolute group text-left rounded-xl p-1.5 flex flex-col gap-1 transition-all bg-surface border shadow-sm cursor-pointer ${
          lcdSelected
            ? "border-[#FC4C01] ring-2 ring-[#FC4C01]/35 z-10"
            : "border-border hover:border-foreground/40 hover:z-10"
        }`}
      >
        <div className="flex items-center justify-between px-0.5 leading-none">
          <span className="text-[8px] font-mono uppercase tracking-wider text-muted-foreground">
            LCD · 144×168
          </span>
          <span
            className={`text-[8px] font-mono font-semibold ${
              lcdSelected ? "text-[#FC4C01]" : "text-muted-foreground"
            }`}
          >
            S{statusStyle}
          </span>
        </div>
        <div className="flex-1 min-h-0">
          <ToucanLcdScreenPreview
            styleIndex={statusStyle}
            layerName={activeLayerName}
            cgSwapEnabled={cgSwapEnabled}
            compact
          />
        </div>
      </button>

      {/* Right Half: Azoteq TPS43 Capacitive Trackpad (43x40mm) */}
      <button
        type="button"
        data-vmk-hardware="trackpad"
        onClick={() => onSelectModule?.("trackpad")}
        title={`Azoteq TPS43 Trackpad (43×40mm · XY ${xyMul}/${xyDiv} · Scroll ${scrMul}/${scrDiv}) — click to inspect & customise`}
        style={tpStyle}
        className={`absolute group text-left rounded-xl p-1.5 flex flex-col transition-all bg-surface border shadow-sm cursor-pointer ${
          tpSelected
            ? "border-[#FC4C01] ring-2 ring-[#FC4C01]/35 z-10"
            : "border-border hover:border-foreground/40 hover:z-10"
        }`}
      >
        <div className="flex items-center justify-between px-0.5 pb-1 leading-none">
          <span className="text-[8px] font-mono uppercase tracking-wider text-muted-foreground">
            TPS43 · 43×40
          </span>
          <span className="inline-flex items-center gap-1 text-[8px] font-mono text-muted-foreground">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                tpEnabled ? "bg-[#FC4C01]" : "bg-muted-foreground/40"
              }`}
            />
            {tpEnabled ? "ON" : "OFF"}
          </span>
        </div>

        {/* Matte capacitive pad surface */}
        <div
          className="relative flex-1 rounded-lg border border-border/80 bg-recess flex flex-col justify-between p-1.5 overflow-hidden"
          style={{
            backgroundImage:
              "radial-gradient(circle at 50% 42%, rgba(252,76,1,0.06), transparent 65%)",
          }}
        >
          {/* Corner registration ticks */}
          <span className="pointer-events-none absolute top-1 left-1 w-1.5 h-1.5 border-t border-l border-foreground/20" />
          <span className="pointer-events-none absolute top-1 right-1 w-1.5 h-1.5 border-t border-r border-foreground/20" />
          <span className="pointer-events-none absolute bottom-1 left-1 w-1.5 h-1.5 border-b border-l border-foreground/20" />
          <span className="pointer-events-none absolute bottom-1 right-1 w-1.5 h-1.5 border-b border-r border-foreground/20" />

          {/* Center gesture reticle */}
          <div className="my-auto flex flex-col items-center justify-center gap-1">
            <div className="w-6 h-6 rounded-full border border-dashed border-foreground/25 flex items-center justify-center">
              <div className="w-1.5 h-1.5 rounded-full bg-foreground/35 group-hover:bg-[#FC4C01] transition-colors" />
            </div>
            <div className="text-[8px] font-mono text-muted-foreground tabular-nums">
              XY {xyMul}/{xyDiv} · SCR {scrMul}/{scrDiv}
            </div>
          </div>

          {/* Active gesture feature chips */}
          <div className="flex flex-wrap justify-center gap-1 leading-none">
            {pinchEnabled && (
              <span className="px-1 py-0.5 rounded bg-surface/90 border border-border text-[7px] font-mono text-foreground">
                Pinch
              </span>
            )}
            {dtEnabled && (
              <span className="px-1 py-0.5 rounded bg-surface/90 border border-border text-[7px] font-mono text-foreground">
                2F-Zoom
              </span>
            )}
            {swipeEnabled && (
              <span className="px-1 py-0.5 rounded bg-surface/90 border border-border text-[7px] font-mono text-foreground">
                3F-Swipe
              </span>
            )}
            {relayEnabled && (
              <span className="px-1 py-0.5 rounded bg-surface/90 border border-border text-[7px] font-mono text-muted-foreground">
                Relay
              </span>
            )}
          </div>
        </div>
      </button>
    </>
  );
}
