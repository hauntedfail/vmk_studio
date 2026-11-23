import { useEffect, useMemo, useState } from "react";
import type {
  CustomCFeaturesTuning,
  FirmwareConfTuning,
  FirmwareModel,
  HelperSmootherTuning,
  HoldTapFlavor,
  HoldTapTuning,
  LeftOverlayGates,
  TrackpadHardwareTuning,
  TrackpadProcessorTuning,
} from "../types";
import { applyFirmwarePatch, getGitDiff } from "../api";
import { auditEndpointSwapBindings } from "../endpointAudit";
import { ToucanLcdScreenPreview } from "./ToucanHardwareModules";
import { CodeBlock } from "@/components/ui/code-block";
import { toast } from "@/components/ui/toast";
import {
  Bluetooth,
  Cpu,
  GitCompare,
  Hammer,
  Monitor,
  MousePointer2,
  RotateCcw,
  Save,
  Sparkles,
  Usb,
  Zap,
} from "lucide-react";

export type TunerSection = "cg" | "holdtap" | "trackpad" | "display" | "system";

interface FirmwareTunerViewProps {
  firmwareModel: FirmwareModel | null;
  initialSection?: TunerSection;
  onModelUpdated: (model: FirmwareModel) => void;
  onGoToBuild: () => void;
  onEditFile?: (relPath: string) => void;
}

const MOD_OPTIONS = [
  "MOD_LCTL",
  "MOD_LSFT",
  "MOD_LALT",
  "MOD_LGUI",
  "MOD_RCTL",
  "MOD_RSFT",
  "MOD_RALT",
  "MOD_RGUI",
];

const INPUT_CLS =
  "h-8 px-2.5 rounded-lg bg-recess border border-border text-xs font-mono text-foreground focus:outline-none focus:border-[#FC4C01]";

function NumberRow({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  unit = "",
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2 py-2.5 border-b border-border last:border-b-0">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs font-medium text-foreground">{label}</div>
          {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <input
            type="number"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              if (!Number.isNaN(n)) onChange(n);
            }}
            className={`${INPUT_CLS} w-20 text-right tabular-nums`}
          />
          {unit && (
            <span className="text-[11px] font-mono text-muted-foreground w-7">
              {unit}
            </span>
          )}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(max, Math.max(min, value))}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 cursor-pointer"
      />
    </div>
  );
}

function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-border last:border-b-0">
      <div className="min-w-0">
        <div className="text-xs font-medium text-foreground">{label}</div>
        {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ${
          checked ? "bg-[#FC4C01]" : "bg-recess border border-border"
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200 ${
            checked ? "translate-x-[18px]" : "translate-x-[3px]"
          }`}
        />
      </button>
    </div>
  );
}

export const FirmwareTunerView = ({
  firmwareModel,
  initialSection,
  onModelUpdated,
  onGoToBuild,
  onEditFile,
}: FirmwareTunerViewProps) => {
  const [section, setSection] = useState<TunerSection>(initialSection ?? "cg");
  const [holdTap, setHoldTap] = useState<HoldTapTuning | null>(null);
  const [tpHw, setTpHw] = useState<TrackpadHardwareTuning | null>(null);
  const [tpProc, setTpProc] = useState<TrackpadProcessorTuning | null>(null);
  const [gates, setGates] = useState<LeftOverlayGates | null>(null);
  const [cFeats, setCFeats] = useState<CustomCFeaturesTuning | null>(null);
  const [smoother, setSmoother] = useState<HelperSmootherTuning | null>(null);
  const [conf, setConf] = useState<FirmwareConfTuning | null>(null);
  const [lcdPreviewLayer, setLcdPreviewLayer] = useState("BASE");

  const [saving, setSaving] = useState(false);
  const [diffText, setDiffText] = useState<string | null>(null);

  useEffect(() => {
    if (initialSection) {
      setSection(initialSection);
    }
  }, [initialSection]);

  const endpointAudit = useMemo(
    () => auditEndpointSwapBindings(firmwareModel?.repoKeymapLayers ?? []),
    [firmwareModel?.repoKeymapLayers]
  );

  useEffect(() => {
    if (!firmwareModel) return;
    setHoldTap(firmwareModel.holdTap);
    setTpHw(firmwareModel.trackpadHardware);
    setTpProc(firmwareModel.trackpadProcessors);
    setGates(firmwareModel.leftOverlayGates);
    setCFeats(firmwareModel.customCFeatures);
    setSmoother(firmwareModel.helperSmoother);
    setConf(firmwareModel.conf);
  }, [firmwareModel]);

  if (!firmwareModel || !holdTap || !tpHw || !tpProc || !gates || !cFeats || !conf) {
    return (
      <div className="h-full flex items-center justify-center p-8 text-xs font-mono text-muted-foreground">
        Loading firmware configuration…
      </div>
    );
  }

  const isDirty =
    JSON.stringify(holdTap) !== JSON.stringify(firmwareModel.holdTap) ||
    JSON.stringify(tpHw) !== JSON.stringify(firmwareModel.trackpadHardware) ||
    JSON.stringify(tpProc) !== JSON.stringify(firmwareModel.trackpadProcessors) ||
    JSON.stringify(gates) !== JSON.stringify(firmwareModel.leftOverlayGates) ||
    JSON.stringify(cFeats) !== JSON.stringify(firmwareModel.customCFeatures) ||
    JSON.stringify(smoother) !== JSON.stringify(firmwareModel.helperSmoother) ||
    JSON.stringify(conf) !== JSON.stringify(firmwareModel.conf);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await applyFirmwarePatch(firmwareModel.repoPath, {
        holdTap,
        trackpadHardware: tpHw,
        trackpadProcessors: tpProc,
        leftOverlayGates: gates,
        customCFeatures: cFeats,
        helperSmoother: smoother ?? undefined,
        conf,
      });
      onModelUpdated(res.model);
      toast.success(
        res.changedFiles.length > 0
          ? `Updated ${res.changedFiles.length} file(s)`
          : "No changes required",
        { description: res.changedFiles.join(", ") }
      );
      if (diffText !== null) {
        setDiffText(await getGitDiff(firmwareModel.repoPath));
      }
    } catch (e) {
      toast.error("Failed to write firmware changes", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleResetDraft = () => {
    setHoldTap(firmwareModel.holdTap);
    setTpHw(firmwareModel.trackpadHardware);
    setTpProc(firmwareModel.trackpadProcessors);
    setGates(firmwareModel.leftOverlayGates);
    setCFeats(firmwareModel.customCFeatures);
    setSmoother(firmwareModel.helperSmoother);
    setConf(firmwareModel.conf);
    toast.info("Reset unsaved firmware parameters");
  };

  const toggleScrollerLayer = (layerIdx: number) => {
    const exists = tpProc.scrollerLayers.includes(layerIdx);
    const next = exists
      ? tpProc.scrollerLayers.filter((l) => l !== layerIdx)
      : [...tpProc.scrollerLayers, layerIdx].sort((a, b) => a - b);
    if (next.length > 0) {
      setTpProc({ ...tpProc, scrollerLayers: next });
    }
  };

  const categories: Array<{
    id: TunerSection;
    title: string;
    subtitle: string;
    icon: JSX.Element;
  }> = [
    {
      id: "cg",
      title: "CG Swap, Zoom & Nav",
      subtitle: "per-endpoint · cg_toggle · zoom",
      icon: <Sparkles className="w-3.5 h-3.5" />,
    },
    {
      id: "holdtap",
      title: "Hold-Tap & Quick-Tap",
      subtitle: "toucan.keymap · &mt · &lt",
      icon: <Zap className="w-3.5 h-3.5" />,
    },
    {
      id: "trackpad",
      title: "Trackpad & Gestures",
      subtitle: "TPS43 · toucan.dtsi · swipes",
      icon: <MousePointer2 className="w-3.5 h-3.5" />,
    },
    {
      id: "display",
      title: "LCD Monitor",
      subtitle: "144×168 MIP · nice_view_gem",
      icon: <Monitor className="w-3.5 h-3.5" />,
    },
    {
      id: "system",
      title: "Relay, Power & Helper",
      subtitle: "Kconfig · .conf · ZoomSmoother",
      icon: <Cpu className="w-3.5 h-3.5" />,
    },
  ];

  return (
    <div className="h-full grid grid-cols-[240px_1fr] grid-rows-[1fr_auto] bg-background overflow-hidden">
      {/* Left Category Rail */}
      <aside className="p-3 bg-surface border-r border-border flex flex-col gap-1.5 row-span-2 overflow-y-auto">
        <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Firmware Modules
        </div>
        {categories.map((cat) => {
          const active = section === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSection(cat.id)}
              className={`w-full text-left px-3 py-2.5 rounded-xl border transition-colors ${
                active
                  ? "bg-muted border-border text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-recess/60"
              }`}
            >
              <div className="flex items-center gap-2 text-xs font-medium">
                <span className={active ? "text-[#FC4C01]" : "opacity-65"}>
                  {cat.icon}
                </span>
                <span>{cat.title}</span>
              </div>
              <div className="text-[10px] font-mono text-muted-foreground mt-0.5 pl-5 truncate">
                {cat.subtitle}
              </div>
            </button>
          );
        })}

        <div className="mt-auto pt-3 border-t border-border">
          <button
            type="button"
            onClick={async () => {
              if (diffText !== null) {
                setDiffText(null);
                return;
              }
              const d = await getGitDiff(firmwareModel.repoPath);
              setDiffText(d || "# Working tree clean — no git diff");
            }}
            className="w-full flex items-center justify-center gap-1.5 h-8 rounded-lg bg-recess border border-border text-xs font-medium text-foreground hover:bg-muted"
          >
            <GitCompare className="w-3.5 h-3.5" />
            {diffText !== null ? "Hide Git Diff" : "Inspect Git Diff"}
          </button>
        </div>
      </aside>

      {/* Focused Right Content Workspace */}
      <div className="overflow-y-auto p-6 space-y-6 bg-background">
        <div className="max-w-3xl mx-auto space-y-6">
          {diffText !== null && (
            <CodeBlock
              code={diffText}
              language="diff"
              filename="git diff (firmware repository)"
              accent="#FC4C01"
              className="max-h-72"
            />
          )}

          {section === "cg" && (
            <>
              <div>
                <h2 className="text-base font-semibold tracking-tight text-foreground">
                  Per-Endpoint Ctrl/GUI Swap, Pinch Zoom &amp; Browser Navigation
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  QMK <code className="font-mono">CG_TOGG</code> parity on ZMK with automatic per-device state switching (<code className="font-mono">cg_toggle/endpoints</code>), plus overlay gates and OS-aware C behaviours.
                </p>
              </div>

              <div className="vmk-card rounded-2xl p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                      Per-Endpoint Device-Switch Swap — src/cg_toggle.c · cg_toggle/endpoints
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Each endpoint (USB and BLE profiles 0–4) stores its own persistent Ctrl↔GUI bit in a 32-bit Zephyr settings field. Switching devices via <code className="font-mono">&amp;bt BT_SEL</code> or <code className="font-mono">&amp;out</code> applies that host&apos;s swap state immediately on the next HID report (after ZMK clears the previous endpoint&apos;s report), and OS-aware Zoom, Smart Zoom, and Back/Forward follow automatically.
                    </p>
                  </div>
                  {onEditFile && (
                    <button
                      type="button"
                      onClick={() => onEditFile("src/cg_toggle.c")}
                      className="h-7 px-2.5 rounded-lg bg-recess border border-border text-[11px] font-mono text-foreground hover:bg-muted shrink-0"
                    >
                      Open src/cg_toggle.c
                    </button>
                  )}
                </div>

                <div className="border-t border-border pt-1">
                  <SwitchRow
                    label="Enable Per-Endpoint Ctrl↔GUI Swap (CONFIG_ZMK_CG_TOGGLE)"
                    hint="Report-stage modifier exchange matching QMK CG_TOGG, scoped per USB / BLE endpoint."
                    checked={conf.cgToggleEnabled}
                    onChange={(v) => setConf({ ...conf, cgToggleEnabled: v })}
                  />
                  <NumberRow
                    label="Flash Persistence Debounce (CONFIG_ZMK_CG_TOGGLE_SAVE_DELAY_MS)"
                    hint="Writes cg_toggle/endpoints to flash after this delay and flushes synchronously before deep sleep."
                    value={conf.cgToggleSaveDelayMs}
                    min={0}
                    max={60000}
                    step={250}
                    unit="ms"
                    onChange={(v) => setConf({ ...conf, cgToggleSaveDelayMs: v })}
                  />
                  <SwitchRow
                    label="Modifier Translation Debug Log (CONFIG_ZMK_CG_TOGGLE_DEBUG)"
                    hint="Log every HID modifier swap event via ZMK logging."
                    checked={conf.cgToggleDebug}
                    onChange={(v) => setConf({ ...conf, cgToggleDebug: v })}
                  />
                </div>

                <div className="space-y-2 pt-1">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                    Endpoint Slots &amp; Device-Switch Bindings (config/toucan.keymap)
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                    {endpointAudit.endpoints.map((ep) => (
                      <div
                        key={ep.id}
                        className="p-2.5 rounded-xl bg-recess border border-border flex flex-col gap-1"
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                            {ep.transport === "usb" ? (
                              <Usb className="w-3.5 h-3.5 text-[#FC4C01]" />
                            ) : (
                              <Bluetooth className="w-3.5 h-3.5 text-[#FC4C01]" />
                            )}
                            {ep.label}
                          </span>
                          <span className="text-[10px] font-mono text-muted-foreground">
                            bit {ep.index}
                          </span>
                        </div>
                        <div className="text-[10px] font-mono text-muted-foreground truncate">
                          {ep.switchBindings.length > 0
                            ? ep.switchBindings
                                .map((b) => `${b.layerName} #${b.keyPosition} (${b.binding})`)
                                .join(", ")
                            : ep.transport === "usb"
                              ? "Auto when USB preferred"
                              : "Unbound in repo keymap"}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-recess/70 border border-border text-[11px]">
                    <span className="text-muted-foreground">
                      Swap toggle keys in <code className="font-mono">toucan.keymap</code>:{" "}
                      {endpointAudit.cgToggleBindings.length > 0 ? (
                        <span className="font-mono text-foreground">
                          {endpointAudit.cgToggleBindings
                            .map((b) => `${b.layerName} #${b.keyPosition} (${b.binding})`)
                            .join(", ")}
                        </span>
                      ) : (
                        <span className="text-amber-500 font-medium">
                          None in repo keymap (bound via Studio runtime or ready to assign in Keymap tab)
                        </span>
                      )}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground">
                      State: persistent per slot on central half
                    </span>
                  </div>
                </div>
              </div>

              <div className="vmk-card rounded-2xl px-5 py-2">
                <div className="py-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  Feature Gates — boards/shields/toucan/toucan_left.overlay
                </div>
                <SwitchRow
                  label="Trackpad Listener (&trackpad_listener)"
                  hint="Master enable for right-half trackpad events on the central half."
                  checked={gates.trackpadListenerEnabled}
                  onChange={(v) => setGates({ ...gates, trackpadListenerEnabled: v })}
                />
                <SwitchRow
                  label="Pinch Zoom Mapper (&zip_zoom_mapper)"
                  hint="Maps trackpad pinch deltas to &cg_zoom_in / &cg_zoom_out."
                  checked={gates.zipZoomMapperEnabled}
                  onChange={(v) => setGates({ ...gates, zipZoomMapperEnabled: v })}
                />
                <SwitchRow
                  label="Two-Finger Double Tap (&two_finger_double_tap)"
                  hint="Separates single right-click from double-tap Smart Zoom."
                  checked={gates.twoFingerDoubleTapEnabled}
                  onChange={(v) => setGates({ ...gates, twoFingerDoubleTapEnabled: v })}
                />
              </div>

              <div className="vmk-card rounded-2xl p-5 space-y-4">
                <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  Zoom &amp; Smart Zoom Markers — src/cg_zoom.c
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <label className="flex flex-col gap-1.5">
                    <span className="font-medium text-foreground">Pinch Marker Key</span>
                    <input
                      type="text"
                      value={cFeats.zoomMarkerKey}
                      onChange={(e) => setCFeats({ ...cFeats, zoomMarkerKey: e.target.value })}
                      className={INPUT_CLS}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="font-medium text-foreground">Smart Zoom Marker Key</span>
                    <input
                      type="text"
                      value={cFeats.smartZoomMarkerKey}
                      onChange={(e) =>
                        setCFeats({ ...cFeats, smartZoomMarkerKey: e.target.value })
                      }
                      className={INPUT_CLS}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="font-medium text-foreground">Fallback Zoom In Chord</span>
                    <input
                      type="text"
                      value={cFeats.zoomInChord}
                      onChange={(e) => setCFeats({ ...cFeats, zoomInChord: e.target.value })}
                      className={INPUT_CLS}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="font-medium text-foreground">Fallback Zoom Out Chord</span>
                    <input
                      type="text"
                      value={cFeats.zoomOutChord}
                      onChange={(e) => setCFeats({ ...cFeats, zoomOutChord: e.target.value })}
                      className={INPUT_CLS}
                    />
                  </label>
                </div>
              </div>

              <div className="vmk-card rounded-2xl p-5 space-y-4">
                <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  OS-Aware Browser Back / Forward — src/cg_nav.c
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div className="p-3.5 rounded-xl bg-recess border border-border space-y-2.5">
                    <div className="font-medium text-foreground">macOS Mode (CG Swap On)</div>
                    <div className="flex items-center gap-2">
                      <span className="w-10 text-muted-foreground">Back</span>
                      <select
                        value={cFeats.navMacBackMod}
                        onChange={(e) => setCFeats({ ...cFeats, navMacBackMod: e.target.value })}
                        className={`${INPUT_CLS} h-7`}
                      >
                        {MOD_OPTIONS.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={cFeats.navMacBackKey}
                        onChange={(e) => setCFeats({ ...cFeats, navMacBackKey: e.target.value })}
                        className={`${INPUT_CLS} h-7 flex-1 min-w-0`}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-10 text-muted-foreground">Fwd</span>
                      <select
                        value={cFeats.navMacForwardMod}
                        onChange={(e) =>
                          setCFeats({ ...cFeats, navMacForwardMod: e.target.value })
                        }
                        className={`${INPUT_CLS} h-7`}
                      >
                        {MOD_OPTIONS.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={cFeats.navMacForwardKey}
                        onChange={(e) =>
                          setCFeats({ ...cFeats, navMacForwardKey: e.target.value })
                        }
                        className={`${INPUT_CLS} h-7 flex-1 min-w-0`}
                      />
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-recess border border-border space-y-2.5">
                    <div className="font-medium text-foreground">Windows Mode (CG Swap Off)</div>
                    <div className="flex items-center gap-2">
                      <span className="w-10 text-muted-foreground">Back</span>
                      <select
                        value={cFeats.navWinBackMod}
                        onChange={(e) => setCFeats({ ...cFeats, navWinBackMod: e.target.value })}
                        className={`${INPUT_CLS} h-7`}
                      >
                        {MOD_OPTIONS.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={cFeats.navWinBackKey}
                        onChange={(e) => setCFeats({ ...cFeats, navWinBackKey: e.target.value })}
                        className={`${INPUT_CLS} h-7 flex-1 min-w-0`}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-10 text-muted-foreground">Fwd</span>
                      <select
                        value={cFeats.navWinForwardMod}
                        onChange={(e) =>
                          setCFeats({ ...cFeats, navWinForwardMod: e.target.value })
                        }
                        className={`${INPUT_CLS} h-7`}
                      >
                        {MOD_OPTIONS.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={cFeats.navWinForwardKey}
                        onChange={(e) =>
                          setCFeats({ ...cFeats, navWinForwardKey: e.target.value })
                        }
                        className={`${INPUT_CLS} h-7 flex-1 min-w-0`}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {section === "holdtap" && (
            <>
              <div>
                <h2 className="text-base font-semibold tracking-tight text-foreground">
                  Hold-Tap &amp; QMK Release-Based Quick-Tap
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Tuned in <code>config/toucan.keymap</code> and backed by <code>src/behavior_hold_tap_qmk.c</code>.
                </p>
              </div>

              <div className="vmk-card rounded-2xl p-5 space-y-3">
                <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  Mod-Tap (&amp;mt)
                </div>
                <NumberRow
                  label="quick-tap-ms (release-based)"
                  hint="Tap, release, re-press within this window and hold to auto-repeat the tap key (0 disables)."
                  value={holdTap.mtQuickTapMs ?? 0}
                  min={0}
                  max={400}
                  step={10}
                  unit="ms"
                  onChange={(v) =>
                    setHoldTap({ ...holdTap, mtQuickTapMs: v === 0 ? null : v })
                  }
                />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 text-xs">
                  <label className="flex flex-col gap-1">
                    <span className="text-muted-foreground">tapping-term-ms</span>
                    <input
                      type="number"
                      min={100}
                      max={500}
                      step={10}
                      placeholder="200 (default)"
                      value={holdTap.mtTappingTermMs ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        setHoldTap({
                          ...holdTap,
                          mtTappingTermMs: raw ? parseInt(raw, 10) : null,
                        });
                      }}
                      className={INPUT_CLS}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-muted-foreground">require-prior-idle-ms</span>
                    <input
                      type="number"
                      min={0}
                      max={400}
                      step={10}
                      placeholder="disabled"
                      value={holdTap.mtRequirePriorIdleMs ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        setHoldTap({
                          ...holdTap,
                          mtRequirePriorIdleMs: raw ? parseInt(raw, 10) : null,
                        });
                      }}
                      className={INPUT_CLS}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-muted-foreground">flavor</span>
                    <select
                      value={holdTap.mtFlavor ?? "default"}
                      onChange={(e) =>
                        setHoldTap({
                          ...holdTap,
                          mtFlavor:
                            e.target.value === "default"
                              ? null
                              : (e.target.value as HoldTapFlavor),
                        })
                      }
                      className={INPUT_CLS}
                    >
                      <option value="default">default (hold-preferred)</option>
                      <option value="hold-preferred">hold-preferred</option>
                      <option value="balanced">balanced</option>
                      <option value="tap-preferred">tap-preferred</option>
                    </select>
                  </label>
                </div>
                <SwitchRow
                  label="Mod-Tap retro-tap"
                  hint="Emit the tap key if held and released without another key pressed."
                  checked={Boolean(holdTap.mtRetroTap)}
                  onChange={(v) => setHoldTap({ ...holdTap, mtRetroTap: v })}
                />
              </div>

              <div className="vmk-card rounded-2xl p-5 space-y-3">
                <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  Layer-Tap (&amp;lt)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <label className="flex flex-col gap-1">
                    <span className="text-muted-foreground">quick-tap-ms</span>
                    <input
                      type="number"
                      min={0}
                      max={400}
                      step={10}
                      placeholder="disabled"
                      value={holdTap.ltQuickTapMs ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        setHoldTap({
                          ...holdTap,
                          ltQuickTapMs: raw && raw !== "0" ? parseInt(raw, 10) : null,
                        });
                      }}
                      className={INPUT_CLS}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-muted-foreground">tapping-term-ms</span>
                    <input
                      type="number"
                      min={100}
                      max={500}
                      step={10}
                      placeholder="200 (default)"
                      value={holdTap.ltTappingTermMs ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        setHoldTap({
                          ...holdTap,
                          ltTappingTermMs: raw ? parseInt(raw, 10) : null,
                        });
                      }}
                      className={INPUT_CLS}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-muted-foreground">flavor</span>
                    <select
                      value={holdTap.ltFlavor ?? "default"}
                      onChange={(e) =>
                        setHoldTap({
                          ...holdTap,
                          ltFlavor:
                            e.target.value === "default"
                              ? null
                              : (e.target.value as HoldTapFlavor),
                        })
                      }
                      className={INPUT_CLS}
                    >
                      <option value="default">default (tap-preferred)</option>
                      <option value="hold-preferred">hold-preferred</option>
                      <option value="balanced">balanced</option>
                      <option value="tap-preferred">tap-preferred</option>
                    </select>
                  </label>
                </div>
                <SwitchRow
                  label="Layer-Tap retro-tap"
                  checked={Boolean(holdTap.ltRetroTap)}
                  onChange={(v) => setHoldTap({ ...holdTap, ltRetroTap: v })}
                />
              </div>
            </>
          )}

          {section === "trackpad" && (
            <>
              <div>
                <h2 className="text-base font-semibold tracking-tight text-foreground">
                  Trackpad Hardware &amp; Input Processor Chain
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Azoteq TPS43 peripheral parameters and central-side input processors.
                </p>
              </div>

              <div className="vmk-card rounded-2xl p-5 space-y-3">
                <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  Input Processors — boards/shields/toucan/toucan.dtsi
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <label className="flex flex-col gap-1">
                    <span className="text-muted-foreground">XY Scale (mul / div)</span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        value={tpProc.xyScaleMul}
                        onChange={(e) =>
                          setTpProc({ ...tpProc, xyScaleMul: parseInt(e.target.value, 10) || 100 })
                        }
                        className={`${INPUT_CLS} w-16`}
                      />
                      <span className="text-muted-foreground">/</span>
                      <input
                        type="number"
                        value={tpProc.xyScaleDiv}
                        onChange={(e) =>
                          setTpProc({ ...tpProc, xyScaleDiv: parseInt(e.target.value, 10) || 100 })
                        }
                        className={`${INPUT_CLS} w-16`}
                      />
                    </div>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-muted-foreground">Scroll Scale (mul / div)</span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        value={tpProc.scrollScaleMul}
                        onChange={(e) =>
                          setTpProc({
                            ...tpProc,
                            scrollScaleMul: parseInt(e.target.value, 10) || 1,
                          })
                        }
                        className={`${INPUT_CLS} w-16`}
                      />
                      <span className="text-muted-foreground">/</span>
                      <input
                        type="number"
                        value={tpProc.scrollScaleDiv}
                        onChange={(e) =>
                          setTpProc({
                            ...tpProc,
                            scrollScaleDiv: parseInt(e.target.value, 10) || 20,
                          })
                        }
                        className={`${INPUT_CLS} w-16`}
                      />
                    </div>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-muted-foreground">Touch Layer (&amp;mo)</span>
                    <input
                      type="number"
                      min={0}
                      max={7}
                      value={tpProc.touchLayer}
                      onChange={(e) =>
                        setTpProc({ ...tpProc, touchLayer: parseInt(e.target.value, 10) || 4 })
                      }
                      className={INPUT_CLS}
                    />
                  </label>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 py-2 border-y border-border text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground mr-1">Scroller Layers</span>
                    {[0, 1, 2, 3, 4, 5].map((lIdx) => {
                      const active = tpProc.scrollerLayers.includes(lIdx);
                      return (
                        <button
                          key={lIdx}
                          type="button"
                          onClick={() => toggleScrollerLayer(lIdx)}
                          className={`w-7 h-7 rounded-lg text-xs font-mono border transition-colors ${
                            active
                              ? "bg-[#FC4C01] text-white border-[#FC4C01]"
                              : "bg-recess border-border text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {lIdx}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={tpProc.scrollerInvertX}
                        onChange={(e) =>
                          setTpProc({ ...tpProc, scrollerInvertX: e.target.checked })
                        }
                      />
                      <span>Invert X</span>
                    </label>
                    <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={tpProc.scrollerInvertY}
                        onChange={(e) =>
                          setTpProc({ ...tpProc, scrollerInvertY: e.target.checked })
                        }
                      />
                      <span>Invert Y</span>
                    </label>
                  </div>
                </div>

                <NumberRow
                  label="Pinch Zoom Sensitivity"
                  value={tpProc.zoomSensitivity}
                  min={1}
                  max={40}
                  onChange={(v) => setTpProc({ ...tpProc, zoomSensitivity: v })}
                />
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <label className="flex flex-col gap-1">
                    <span className="text-muted-foreground">Zoom Out Binding</span>
                    <input
                      type="text"
                      value={tpProc.zoomOutBinding}
                      onChange={(e) => setTpProc({ ...tpProc, zoomOutBinding: e.target.value })}
                      className={INPUT_CLS}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-muted-foreground">Zoom In Binding</span>
                    <input
                      type="text"
                      value={tpProc.zoomInBinding}
                      onChange={(e) => setTpProc({ ...tpProc, zoomInBinding: e.target.value })}
                      className={INPUT_CLS}
                    />
                  </label>
                </div>
                <SwitchRow
                  label="Track Pinch Remainders"
                  checked={tpProc.zoomTrackRemainders}
                  onChange={(v) => setTpProc({ ...tpProc, zoomTrackRemainders: v })}
                />

                <NumberRow
                  label="Two-Finger Double-Tap Window"
                  hint="Delay before single tap emits right-click (250ms matches macOS trackpads)."
                  value={tpProc.doubleTapWindowMs}
                  min={100}
                  max={500}
                  step={10}
                  unit="ms"
                  onChange={(v) => setTpProc({ ...tpProc, doubleTapWindowMs: v })}
                />
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <label className="flex flex-col gap-1">
                    <span className="text-muted-foreground">Single-Tap Binding</span>
                    <input
                      type="text"
                      value={tpProc.doubleTapSingleBinding}
                      onChange={(e) =>
                        setTpProc({ ...tpProc, doubleTapSingleBinding: e.target.value })
                      }
                      className={INPUT_CLS}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-muted-foreground">Double-Tap Binding</span>
                    <input
                      type="text"
                      value={tpProc.doubleTapDoubleBinding}
                      onChange={(e) =>
                        setTpProc({ ...tpProc, doubleTapDoubleBinding: e.target.value })
                      }
                      className={INPUT_CLS}
                    />
                  </label>
                </div>
                <SwitchRow
                  label="Require CG Swap Active for Smart Zoom"
                  checked={tpProc.doubleTapRequireCgSwap}
                  onChange={(v) => setTpProc({ ...tpProc, doubleTapRequireCgSwap: v })}
                />

                <div className="pt-2 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                      3-Finger Swipes
                    </span>
                    <label className="inline-flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={tpProc.winModeDefault}
                        onChange={(e) =>
                          setTpProc({ ...tpProc, winModeDefault: e.target.checked })
                        }
                      />
                      <span>TOUCAN_WIN_MODE</span>
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {(["Up", "Right", "Down", "Left"] as const).map((dir, idx) => (
                      <label key={`mac-${dir}`} className="flex flex-col gap-1">
                        <span className="text-[11px] text-muted-foreground">macOS {dir}</span>
                        <input
                          type="text"
                          value={tpProc.swipeBindings[idx] || ""}
                          onChange={(e) => {
                            const next = [...tpProc.swipeBindings];
                            next[idx] = e.target.value;
                            setTpProc({ ...tpProc, swipeBindings: next });
                          }}
                          className={INPUT_CLS}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {(["Up", "Right", "Down", "Left"] as const).map((dir, idx) => (
                      <label key={`win-${dir}`} className="flex flex-col gap-1">
                        <span className="text-[11px] text-muted-foreground">Windows {dir}</span>
                        <input
                          type="text"
                          value={tpProc.swipeWinBindings[idx] || ""}
                          onChange={(e) => {
                            const next = [...tpProc.swipeWinBindings];
                            next[idx] = e.target.value;
                            setTpProc({ ...tpProc, swipeWinBindings: next });
                          }}
                          className={INPUT_CLS}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="vmk-card rounded-2xl p-5 space-y-2">
                <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  Azoteq TPS43 Hardware — boards/shields/toucan/toucan_right.overlay
                </div>
                <NumberRow
                  label="Sensitivity"
                  value={tpHw.sensitivity}
                  min={20}
                  max={250}
                  step={5}
                  onChange={(v) => setTpHw({ ...tpHw, sensitivity: v })}
                />
                <NumberRow
                  label="Scroll Sensitivity"
                  value={tpHw.scrollSensitivity}
                  min={20}
                  max={250}
                  step={5}
                  onChange={(v) => setTpHw({ ...tpHw, scrollSensitivity: v })}
                />
                <NumberRow
                  label="Scroll Angle"
                  value={tpHw.scrollAngle}
                  min={5}
                  max={60}
                  unit="deg"
                  onChange={(v) => setTpHw({ ...tpHw, scrollAngle: v })}
                />
                <NumberRow
                  label="Hold Time"
                  value={tpHw.holdTime}
                  min={100}
                  max={1200}
                  step={25}
                  unit="ms"
                  onChange={(v) => setTpHw({ ...tpHw, holdTime: v })}
                />
                <NumberRow
                  label="3-Finger Swipe Throttle"
                  value={tpHw.threeFingerSwipeThrottleMs}
                  min={200}
                  max={2500}
                  step={50}
                  unit="ms"
                  onChange={(v) => setTpHw({ ...tpHw, threeFingerSwipeThrottleMs: v })}
                />
                <NumberRow
                  label="LP2 Report Rate"
                  value={tpHw.reportRateLp2}
                  min={160}
                  max={1000}
                  step={40}
                  unit="ms"
                  onChange={(v) => setTpHw({ ...tpHw, reportRateLp2: v })}
                />
                <div className="flex items-center justify-between py-2.5 border-b border-border text-xs">
                  <span className="font-medium text-foreground">filter-settings (hex)</span>
                  <input
                    type="text"
                    value={tpHw.filterSettings}
                    onChange={(e) => setTpHw({ ...tpHw, filterSettings: e.target.value })}
                    className={`${INPUT_CLS} w-24 text-right`}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 pt-1">
                  <SwitchRow label="Pinch Zoom" checked={tpHw.zoom} onChange={(v) => setTpHw({ ...tpHw, zoom: v })} />
                  <SwitchRow label="2-Finger Scroll" checked={tpHw.scroll} onChange={(v) => setTpHw({ ...tpHw, scroll: v })} />
                  <SwitchRow label="2-Finger Tap" checked={tpHw.twoFingerTap} onChange={(v) => setTpHw({ ...tpHw, twoFingerTap: v })} />
                  <SwitchRow label="Single Tap" checked={tpHw.singleTap} onChange={(v) => setTpHw({ ...tpHw, singleTap: v })} />
                  <SwitchRow label="Press & Hold" checked={tpHw.pressAndHold} onChange={(v) => setTpHw({ ...tpHw, pressAndHold: v })} />
                  <SwitchRow label="3-Finger Swipe" checked={tpHw.threeFingerSwipe} onChange={(v) => setTpHw({ ...tpHw, threeFingerSwipe: v })} />
                  <SwitchRow label="Switch X / Y" checked={tpHw.switchXy} onChange={(v) => setTpHw({ ...tpHw, switchXy: v })} />
                  <SwitchRow label="Invert Scroll Y" checked={tpHw.invertScrollY} onChange={(v) => setTpHw({ ...tpHw, invertScrollY: v })} />
                  <SwitchRow label="Power Management" checked={tpHw.enablePowerManagement} onChange={(v) => setTpHw({ ...tpHw, enablePowerManagement: v })} />
                </div>
              </div>
            </>
          )}

          {section === "display" && (
            <>
              <div>
                <h2 className="text-base font-semibold tracking-tight text-foreground">
                  Toucan 2 Sharp Memory LCD (144×168 MIP)
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Configure the left-half monochrome Memory-in-Pixel status screen (<code className="font-mono">CONFIG_TOUCAN_STATUS_SCREEN</code>) and inspect LVGL widget modules in <code className="font-mono">boards/shields/nice_view_gem/</code>.
                </p>
              </div>

              <div className="vmk-card rounded-2xl p-5 grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-5 items-center">
                <div className="mx-auto w-[144px] h-[168px] rounded-xl p-2 bg-recess border border-border shadow-inner">
                  <ToucanLcdScreenPreview
                    styleIndex={conf.statusScreenStyle}
                    layerName={lcdPreviewLayer}
                    cgSwapEnabled={conf.cgToggleEnabled}
                  />
                </div>
                <div className="space-y-3 text-xs">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                    Live 144×168 Monochrome Preview
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(firmwareModel.repoKeymapLayers.filter((l) => !l.reserved).length > 0
                      ? firmwareModel.repoKeymapLayers
                          .filter((l) => !l.reserved)
                          .map((l) => l.displayName || l.id)
                      : ["BASE", "NAV", "SYM", "ADJ", "MOU"]
                    ).map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => setLcdPreviewLayer(name)}
                        className={`px-2 py-1 rounded-md border text-[11px] font-mono transition-colors ${
                          lcdPreviewLayer === name
                            ? "bg-[#FC4C01] border-[#FC4C01] text-white"
                            : "bg-recess border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Displayed on the left (central) half via SPI0 (<code className="font-mono">nice_view_spi</code> in <code className="font-mono">toucan_left.overlay</code>). Transitions to sleep artwork automatically when ZMK enters idle sleep ({Math.round(conf.idleSleepTimeoutMs / 60000)} min).
                  </p>
                  {onEditFile && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => onEditFile("boards/shields/toucan/toucan_left.conf")}
                        className="h-7 px-2.5 rounded-lg bg-recess border border-border text-[11px] font-mono text-foreground hover:bg-muted"
                      >
                        Edit toucan_left.conf
                      </button>
                      <button
                        type="button"
                        onClick={() => onEditFile("boards/shields/toucan/toucan_left.overlay")}
                        className="h-7 px-2.5 rounded-lg bg-recess border border-border text-[11px] font-mono text-foreground hover:bg-muted"
                      >
                        Edit toucan_left.overlay
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="vmk-card rounded-2xl p-5 space-y-3">
                <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  Status Screen Style — CONFIG_TOUCAN_STATUS_SCREEN
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  {[
                    {
                      id: 0,
                      title: "Style 0 — Classic",
                      desc: "Compact monochrome readout with output, BLE profile, layer, and dual L/R battery bars.",
                      files: "layer.c · profile.c · battery.c",
                    },
                    {
                      id: 1,
                      title: "Style 1 — Logo & Layer",
                      desc: "Adds the Toucan emblem above the active layer name alongside profile and battery gauges.",
                      files: "layer_logo.c · profile.c · battery.c",
                    },
                    {
                      id: 2,
                      title: "Style 2 — Arc + WPM Chart",
                      desc: "Toucan 2 default: arc gauges for output, profile, layer, and L/R battery plus live WPM chart.",
                      files: "layer_arc.c · profile_arc.c · chart.c",
                    },
                  ].map((opt) => {
                    const active = conf.statusScreenStyle === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setConf({ ...conf, statusScreenStyle: opt.id })}
                        className={`text-left p-3.5 rounded-xl border transition-all space-y-1.5 ${
                          active
                            ? "border-[#FC4C01] bg-[#FC4C01]/5 ring-1 ring-[#FC4C01]/30"
                            : "border-border bg-recess/50 hover:bg-muted/60"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-foreground">{opt.title}</span>
                          {active && (
                            <span className="text-[10px] font-mono text-[#FC4C01] font-semibold">
                              ACTIVE
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          {opt.desc}
                        </p>
                        <div className="text-[10px] font-mono text-muted-foreground pt-1">
                          {opt.files}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {section === "system" && (
            <>
              <div>
                <h2 className="text-base font-semibold tracking-tight text-foreground">
                  Split Input Relay, Power &amp; macOS Helper
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Kconfig defaults, shield <code>.conf</code> files, and Toucan 2 Helper smoothing curve.
                </p>
              </div>

              <div className="vmk-card rounded-2xl p-5 space-y-2">
                <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  Firmware Config — toucan_left.conf / toucan_right.conf
                </div>
                <SwitchRow
                  label="ZMK_CG_TOGGLE"
                  hint="Per-endpoint Ctrl/GUI modifier swap."
                  checked={conf.cgToggleEnabled}
                  onChange={(v) => setConf({ ...conf, cgToggleEnabled: v })}
                />
                <SwitchRow
                  label="ZMK_CG_TOGGLE_DEBUG"
                  checked={conf.cgToggleDebug}
                  onChange={(v) => setConf({ ...conf, cgToggleDebug: v })}
                />
                <NumberRow
                  label="CG Toggle Save Delay"
                  value={conf.cgToggleSaveDelayMs}
                  min={200}
                  max={60000}
                  step={200}
                  unit="ms"
                  onChange={(v) => setConf({ ...conf, cgToggleSaveDelayMs: v })}
                />
                <SwitchRow
                  label="TOUCAN_SPLIT_INPUT_RELAY"
                  hint="Dedicated non-blocking thread prevents right-half hangs during BLE stalls."
                  checked={conf.splitInputRelayEnabled}
                  onChange={(v) => setConf({ ...conf, splitInputRelayEnabled: v })}
                />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-xs">
                  <label className="flex flex-col gap-1">
                    <span className="text-muted-foreground">Relay Queue Size</span>
                    <input
                      type="number"
                      min={8}
                      max={255}
                      value={conf.splitInputRelayQueueSize}
                      onChange={(e) =>
                        setConf({
                          ...conf,
                          splitInputRelayQueueSize: parseInt(e.target.value, 10) || 32,
                        })
                      }
                      className={INPUT_CLS}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-muted-foreground">Relay Stack Size</span>
                    <input
                      type="number"
                      min={1024}
                      max={4096}
                      step={128}
                      value={conf.splitInputRelayStackSize}
                      onChange={(e) =>
                        setConf({
                          ...conf,
                          splitInputRelayStackSize: parseInt(e.target.value, 10) || 1536,
                        })
                      }
                      className={INPUT_CLS}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-muted-foreground">Status Screen Style</span>
                    <select
                      value={conf.statusScreenStyle}
                      onChange={(e) =>
                        setConf({ ...conf, statusScreenStyle: parseInt(e.target.value, 10) })
                      }
                      className={INPUT_CLS}
                    >
                      <option value={0}>0 — Minimal</option>
                      <option value={1}>1 — Classic</option>
                      <option value={2}>2 — Toucan Default</option>
                    </select>
                  </label>
                </div>
              </div>

              {smoother && (
                <div className="vmk-card rounded-2xl p-5 space-y-4">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                    Toucan 2 Helper — host/macos/Sources/Core/ZoomSmoother.swift
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    <label className="flex flex-col gap-1">
                      <span className="text-muted-foreground">Low Step</span>
                      <input
                        type="number"
                        step={0.01}
                        value={smoother.lowStep}
                        onChange={(e) =>
                          setSmoother({ ...smoother, lowStep: parseFloat(e.target.value) || 0.05 })
                        }
                        className={INPUT_CLS}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-muted-foreground">Medium Step</span>
                      <input
                        type="number"
                        step={0.01}
                        value={smoother.mediumStep}
                        onChange={(e) =>
                          setSmoother({
                            ...smoother,
                            mediumStep: parseFloat(e.target.value) || 0.08,
                          })
                        }
                        className={INPUT_CLS}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-muted-foreground">High Step</span>
                      <input
                        type="number"
                        step={0.01}
                        value={smoother.highStep}
                        onChange={(e) =>
                          setSmoother({ ...smoother, highStep: parseFloat(e.target.value) || 0.12 })
                        }
                        className={INPUT_CLS}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-muted-foreground">Easing</span>
                      <input
                        type="number"
                        step={0.05}
                        value={smoother.easing}
                        onChange={(e) =>
                          setSmoother({ ...smoother, easing: parseFloat(e.target.value) || 0.35 })
                        }
                        className={INPUT_CLS}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-muted-foreground">End Delay (s)</span>
                      <input
                        type="number"
                        step={0.05}
                        value={smoother.endDelay}
                        onChange={(e) =>
                          setSmoother({ ...smoother, endDelay: parseFloat(e.target.value) || 0.25 })
                        }
                        className={INPUT_CLS}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-muted-foreground">Smallest Frame</span>
                      <input
                        type="number"
                        step={0.001}
                        value={smoother.smallestFrame}
                        onChange={(e) =>
                          setSmoother({
                            ...smoother,
                            smallestFrame: parseFloat(e.target.value) || 0.002,
                          })
                        }
                        className={INPUT_CLS}
                      />
                    </label>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Sticky Bottom Action Bar */}
      <div className="col-start-2 px-6 py-3 bg-surface border-t border-border flex items-center justify-between gap-4 text-xs">
        <span className="text-muted-foreground">
          {isDirty
            ? "Unsaved parameter edits ready to write to repository."
            : "All parameters match repository."}
        </span>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={!isDirty || saving}
            onClick={handleResetDraft}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-recess border border-border text-foreground hover:bg-muted disabled:opacity-35 whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
          <button
            type="button"
            disabled={!isDirty || saving}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-[#FC4C01] text-white font-medium hover:opacity-90 disabled:opacity-35 whitespace-nowrap"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? "Writing..." : "Apply to Repo"}
          </button>
          <button
            type="button"
            onClick={onGoToBuild}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-recess border border-border text-foreground hover:bg-muted font-medium whitespace-nowrap"
          >
            <Hammer className="w-3.5 h-3.5 text-[#FC4C01]" />
            Build &amp; Flash
          </button>
        </div>
      </div>
    </div>
  );
};
