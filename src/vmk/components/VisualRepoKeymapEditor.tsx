import { useEffect, useMemo, useState } from "react";
import { PhysicalLayout, KeyPosition } from "../../keyboard/PhysicalLayout";
import { formatHex } from "../customBehaviors";
import {
  formatDtsBindingExpr,
  parseDtsBindingExpr,
} from "../keymapCodec";
import {
  ALL_ZMK_KEYCODES,
  ZMK_KEYCODE_GROUPS,
  ZMK_MOD_WRAPPERS,
  unwrapZmkMods,
  wrapZmkMods,
} from "../zmkKeycodes";
import {
  resolveDtsBindingLegend,
  resolveStudioBindingLegend,
} from "../keycapLegendModel";
import { KeycapLegend } from "./KeycapLegend";
import type {
  ComboDef,
  ConditionalLayerRule,
  FirmwareModel,
  RepoKeymapLayer,
  SnapshotSummary,
  StudioSnapshot,
} from "../types";
import { applyFirmwarePatch, getGitDiff, readSnapshot, saveRepoKeymap } from "../api";
import {
  ToucanLcdScreenPreview,
  type ToucanHardwareModuleId,
} from "./ToucanHardwareModules";
import type { TunerSection } from "./FirmwareTunerView";
import { CodeBlock } from "@/components/ui/code-block";
import { toast } from "@/components/ui/toast";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  FileCode2,
  GitCompare,
  Lock,
  Monitor,
  MousePointer2,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Shield,
  ShieldOff,
  Sliders,
  Trash2,
  Undo2,
  Unlock,
} from "lucide-react";

interface VisualRepoKeymapEditorProps {
  firmwareModel: FirmwareModel | null;
  loading?: boolean;
  snapshots: SnapshotSummary[];
  backupsDir?: string;
  isConnected?: boolean;
  onModelUpdated: (model: FirmwareModel) => void;
  onOpenConnect: () => void;
  onEditKeymapFile: () => void;
  onEditRepoFile?: (relPath: string) => void;
  onOpenTunerSection?: (section: TunerSection) => void;
  onSwitchToLive?: () => void;
}

const STANDARD_BEHAVIORS: Array<{
  ref: string;
  label: string;
  category: "stock" | "safety";
  argsKind:
    | "none"
    | "keycode"
    | "mod_tap"
    | "layer_tap"
    | "layer"
    | "bt"
    | "out"
    | "mkp";
}> = [
  { ref: "&kp", label: "Key Press (&kp)", category: "stock", argsKind: "keycode" },
  { ref: "&mt", label: "Mod-Tap (&mt)", category: "stock", argsKind: "mod_tap" },
  { ref: "&lt", label: "Layer-Tap (&lt)", category: "stock", argsKind: "layer_tap" },
  { ref: "&mo", label: "Momentary Layer (&mo)", category: "stock", argsKind: "layer" },
  { ref: "&to", label: "To Layer (&to)", category: "stock", argsKind: "layer" },
  { ref: "&tog", label: "Toggle Layer (&tog)", category: "stock", argsKind: "layer" },
  { ref: "&sl", label: "Sticky Layer (&sl)", category: "stock", argsKind: "layer" },
  { ref: "&sk", label: "Sticky Key (&sk)", category: "stock", argsKind: "keycode" },
  { ref: "&kt", label: "Key Toggle (&kt)", category: "stock", argsKind: "keycode" },
  { ref: "&mkp", label: "Mouse Key Press (&mkp)", category: "stock", argsKind: "mkp" },
  { ref: "&bt", label: "Bluetooth (&bt)", category: "stock", argsKind: "bt" },
  { ref: "&out", label: "Output Selection (&out)", category: "stock", argsKind: "out" },
  { ref: "&trans", label: "Transparent (&trans)", category: "stock", argsKind: "none" },
  { ref: "&none", label: "None (&none)", category: "stock", argsKind: "none" },
  { ref: "&caps_word", label: "Caps Word (&caps_word)", category: "stock", argsKind: "none" },
  { ref: "&key_repeat", label: "Key Repeat (&key_repeat)", category: "stock", argsKind: "none" },
  { ref: "&studio_unlock", label: "Studio Unlock (&studio_unlock)", category: "safety", argsKind: "none" },
  { ref: "&bootloader", label: "Bootloader (&bootloader)", category: "safety", argsKind: "none" },
  { ref: "&sys_reset", label: "System Reset (&sys_reset)", category: "safety", argsKind: "none" },
];

const INPUT_CLS =
  "h-8 px-2.5 rounded-lg bg-recess border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-accent disabled:opacity-45";

function KeycodeSelect({
  label,
  value,
  disabled,
  allowMods = true,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  allowMods?: boolean;
  onChange: (next: string) => void;
}) {
  const { mods, base } = useMemo(() => unwrapZmkMods(value || "A"), [value]);
  const [filter, setFilter] = useState("");

  const filteredGroups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return ZMK_KEYCODE_GROUPS;
    return ZMK_KEYCODE_GROUPS.map((g) => ({
      ...g,
      codes: g.codes.filter(
        (c) => c.code.toLowerCase().includes(q) || c.label.toLowerCase().includes(q)
      ),
    })).filter((g) => g.codes.length > 0);
  }, [filter]);

  const isKnown = ALL_ZMK_KEYCODES.some((c) => c.code === base);

  const toggleMod = (modId: string) => {
    if (disabled) return;
    const nextMods = mods.includes(modId)
      ? mods.filter((m) => m !== modId)
      : [...mods, modId];
    onChange(wrapZmkMods(base || "A", nextMods));
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-[11px] font-medium text-muted-foreground w-16 shrink-0">
        {label}
      </span>
      <input
        type="text"
        disabled={disabled}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter..."
        className={`${INPUT_CLS} w-28`}
      />
      <select
        disabled={disabled}
        value={base}
        onChange={(e) => onChange(wrapZmkMods(e.target.value, allowMods ? mods : []))}
        className={`${INPUT_CLS} font-mono max-w-[210px]`}
      >
        {!isKnown && <option value={base}>{base} (custom)</option>}
        {filteredGroups.map((g) => (
          <optgroup key={g.group} label={g.group}>
            {g.codes.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {allowMods && (
        <div className="flex flex-wrap items-center gap-1">
          {ZMK_MOD_WRAPPERS.map((m) => {
            const active = mods.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                disabled={disabled}
                onClick={() => toggleMod(m.id)}
                className={`h-7 px-2 rounded-md text-[11px] font-mono border transition-colors disabled:opacity-40 ${
                  active
                    ? "bg-[#FC4C01] text-white border-[#FC4C01]"
                    : "bg-recess border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {m.id}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const VisualRepoKeymapEditor = ({
  firmwareModel,
  loading = false,
  snapshots,
  backupsDir,
  isConnected = false,
  onModelUpdated,
  onEditKeymapFile,
  onEditRepoFile,
  onOpenTunerSection,
  onSwitchToLive,
}: VisualRepoKeymapEditorProps) => {
  const [viewMode, setViewMode] = useState<"repo" | "snapshot">("repo");
  const [selectedModule, setSelectedModule] =
    useState<ToucanHardwareModuleId | null>(null);
  const [savingHardware, setSavingHardware] = useState(false);
  const [selectedSnapshotRel, setSelectedSnapshotRel] = useState<string>(
    snapshots[0]?.relPath || ""
  );
  const [loadedSnapshot, setLoadedSnapshot] = useState<StudioSnapshot | null>(null);

  const [layers, setLayers] = useState<RepoKeymapLayer[]>([]);
  const [conditionalLayers, setConditionalLayers] = useState<ConditionalLayerRule[]>([]);
  const [combos, setCombos] = useState<ComboDef[]>([]);
  const [history, setHistory] = useState<
    Array<{ layers: RepoKeymapLayer[]; conditionalLayers: ConditionalLayerRule[]; combos: ComboDef[] }>
  >([]);
  const [future, setFuture] = useState<
    Array<{ layers: RepoKeymapLayer[]; conditionalLayers: ConditionalLayerRule[]; combos: ComboDef[] }>
  >([]);

  const [selectedLayerIdx, setSelectedLayerIdx] = useState(0);
  const [selectedKeyIdx, setSelectedKeyIdx] = useState<number | undefined>(undefined);
  const [guardEnabled, setGuardEnabled] = useState(true);
  const [unlockedKey, setUnlockedKey] = useState(false);

  const [subPanel, setSubPanel] = useState<"binding" | "combos" | "conditional">("binding");
  const [pickingComboIdx, setPickingComboIdx] = useState<number | null>(null);

  const [saving, setSaving] = useState(false);
  const [diffText, setDiffText] = useState<string | null>(null);

  useEffect(() => {
    if (!firmwareModel) return;
    setLayers(firmwareModel.repoKeymapLayers.map((l) => ({ ...l, bindings: [...l.bindings] })));
    setConditionalLayers(
      firmwareModel.conditionalLayers.map((r) => ({ ...r, ifLayers: [...r.ifLayers] }))
    );
    setCombos(
      firmwareModel.combos.map((c) => ({
        ...c,
        keyPositions: [...c.keyPositions],
        layers: c.layers ? [...c.layers] : undefined,
      }))
    );
    setHistory([]);
    setFuture([]);
  }, [firmwareModel]);

  useEffect(() => {
    setUnlockedKey(false);
  }, [selectedLayerIdx, selectedKeyIdx]);

  useEffect(() => {
    if (!selectedSnapshotRel && snapshots.length > 0) {
      setSelectedSnapshotRel(snapshots[0].relPath);
    }
  }, [snapshots, selectedSnapshotRel]);

  useEffect(() => {
    if (viewMode !== "snapshot" || !selectedSnapshotRel) {
      setLoadedSnapshot(null);
      return;
    }
    let cancelled = false;
    readSnapshot(selectedSnapshotRel, backupsDir)
      .then((snap) => {
        if (!cancelled) {
          setLoadedSnapshot(snap);
          setSelectedLayerIdx(0);
          setSelectedKeyIdx(undefined);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadedSnapshot(null);
      });
    return () => {
      cancelled = true;
    };
  }, [viewMode, selectedSnapshotRel, backupsDir]);

  const commitDraft = (
    nextLayers: RepoKeymapLayer[],
    nextConds = conditionalLayers,
    nextCombos = combos
  ) => {
    setHistory((h) => [...h.slice(-30), { layers, conditionalLayers, combos }]);
    setFuture([]);
    setLayers(nextLayers);
    setConditionalLayers(nextConds);
    setCombos(nextCombos);
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setFuture((f) => [{ layers, conditionalLayers, combos }, ...f]);
    setHistory((h) => h.slice(0, -1));
    setLayers(prev.layers);
    setConditionalLayers(prev.conditionalLayers);
    setCombos(prev.combos);
  };

  const handleRedo = () => {
    if (future.length === 0) return;
    const next = future[0];
    setHistory((h) => [...h, { layers, conditionalLayers, combos }]);
    setFuture((f) => f.slice(1));
    setLayers(next.layers);
    setConditionalLayers(next.conditionalLayers);
    setCombos(next.combos);
  };

  const isDirty = useMemo(() => {
    if (!firmwareModel) return false;
    return (
      JSON.stringify(layers) !== JSON.stringify(firmwareModel.repoKeymapLayers) ||
      JSON.stringify(conditionalLayers) !== JSON.stringify(firmwareModel.conditionalLayers) ||
      JSON.stringify(combos) !== JSON.stringify(firmwareModel.combos)
    );
  }, [layers, conditionalLayers, combos, firmwareModel]);

  const layoutKeys = useMemo(
    () => firmwareModel?.physicalLayout ?? [],
    [firmwareModel?.physicalLayout]
  );
  const customBehaviorDefs = useMemo(
    () => firmwareModel?.customBehaviors ?? [],
    [firmwareModel?.customBehaviors]
  );
  const customLabelSet = useMemo(
    () => new Set(customBehaviorDefs.map((b) => `&${b.label}`)),
    [customBehaviorDefs]
  );

  const activeLayer = layers[selectedLayerIdx];

  const handleKeyClick = (pos: number) => {
    setSelectedModule(null);
    if (viewMode === "repo" && subPanel === "combos" && pickingComboIdx !== null) {
      const target = combos[pickingComboIdx];
      if (!target) return;
      const nextPositions = target.keyPositions.includes(pos)
        ? target.keyPositions.filter((p) => p !== pos)
        : [...target.keyPositions, pos].sort((a, b) => a - b);
      const nextCombos = combos.map((c, i) =>
        i === pickingComboIdx ? { ...c, keyPositions: nextPositions } : c
      );
      commitDraft(layers, conditionalLayers, nextCombos);
      return;
    }
    setSelectedKeyIdx(pos);
  };

  const handleSelectHardwareModule = (mod: ToucanHardwareModuleId) => {
    setSelectedKeyIdx(undefined);
    setSelectedModule((prev) => (prev === mod ? null : mod));
  };

  const handleQuickPatchHardware = async (
    patch: Parameters<typeof applyFirmwarePatch>[1],
    label: string
  ) => {
    if (!firmwareModel) return;
    setSavingHardware(true);
    try {
      const res = await applyFirmwarePatch(firmwareModel.repoPath, patch);
      onModelUpdated(res.model);
      toast.success(`Updated ${label}`, {
        description: res.changedFiles.join(", ") || "Already up to date",
      });
    } catch (e) {
      toast.error(`Failed to update ${label}`, {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSavingHardware(false);
    }
  };

  const updateSelectedKeyBinding = (newExpr: string) => {
    if (selectedKeyIdx === undefined || !activeLayer || activeLayer.reserved) return;
    const nextLayers = layers.map((l, li) => {
      if (li !== selectedLayerIdx) return l;
      const nextBindings = [...l.bindings];
      while (nextBindings.length <= selectedKeyIdx) nextBindings.push("&trans");
      nextBindings[selectedKeyIdx] = newExpr.trim() || "&trans";
      return { ...l, bindings: nextBindings };
    });
    commitDraft(nextLayers);
  };

  const handleActivateOrAddLayer = () => {
    const keyCount = layoutKeys.length || 42;
    const firstReserved = layers.findIndex((l) => l.reserved);
    if (firstReserved >= 0) {
      const next = layers.map((l, i) =>
        i === firstReserved
          ? {
              ...l,
              reserved: undefined,
              displayName: `L${firstReserved}`,
              bindings: Array(keyCount).fill("&trans"),
            }
          : l
      );
      commitDraft(next);
      setSelectedLayerIdx(firstReserved);
    } else {
      const idx = layers.length;
      const next = [
        ...layers,
        {
          id: `layer_${idx}`,
          displayName: `L${idx}`,
          bindings: Array(keyCount).fill("&trans"),
        },
      ];
      commitDraft(next);
      setSelectedLayerIdx(idx);
    }
  };

  const handleDuplicateLayer = () => {
    if (!activeLayer || activeLayer.reserved) return;
    const idx = layers.length;
    const next = [
      ...layers,
      {
        id: `${activeLayer.id}_copy_${idx}`,
        displayName: `${activeLayer.displayName}_2`,
        bindings: [...activeLayer.bindings],
      },
    ];
    commitDraft(next);
    setSelectedLayerIdx(idx);
  };

  const handleMoveLayer = (dir: -1 | 1) => {
    const target = selectedLayerIdx + dir;
    if (target < 0 || target >= layers.length) return;
    const next = [...layers];
    const [moved] = next.splice(selectedLayerIdx, 1);
    next.splice(target, 0, moved);
    commitDraft(next);
    setSelectedLayerIdx(target);
  };

  const handleSave = async () => {
    if (!firmwareModel) return;
    setSaving(true);
    try {
      const updated = await saveRepoKeymap(firmwareModel.repoPath, {
        layers,
        conditionalLayers,
        combos,
      });
      onModelUpdated(updated);
      toast.success("Saved config/toucan.keymap");
      if (diffText !== null) {
        setDiffText(await getGitDiff(firmwareModel.repoPath, "config/toucan.keymap"));
      }
    } catch (e) {
      toast.error("Failed to save keymap", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const highlightedComboPositions = useMemo(() => {
    if (viewMode !== "repo" || subPanel !== "combos" || pickingComboIdx === null) {
      return new Set<number>();
    }
    return new Set(combos[pickingComboIdx]?.keyPositions || []);
  }, [viewMode, subPanel, pickingComboIdx, combos]);

  const positions: KeyPosition[] = useMemo(() => {
    if (layoutKeys.length === 0) return [];

    if (viewMode === "snapshot" && loadedSnapshot) {
      const layer = loadedSnapshot.layers[selectedLayerIdx];
      const snapLayerSummaries = loadedSnapshot.layers.map((l, i) => ({
        id: l.id,
        name: l.name || `L${i}`,
      }));
      return layoutKeys.map((k, idx) => {
        const b = layer?.bindings[idx];
        const bMeta = b ? loadedSnapshot.behaviors?.[b.behavior_id] : undefined;
        const displayName = bMeta?.displayName;
        const spec = b
          ? resolveStudioBindingLegend(
              displayName,
              b.param1 ?? 0,
              b.param2 ?? 0,
              snapLayerSummaries
            )
          : { kind: "muted" as const, text: "—" };
        const isCustom =
          bMeta &&
          customBehaviorDefs.some(
            (c) => c.displayName.toLowerCase() === bMeta.displayName.toLowerCase()
          );

        return {
          id: `snap-${selectedLayerIdx}-${idx}`,
          x: k.x,
          y: k.y,
          width: k.w ?? 1,
          height: k.h ?? 1,
          r: k.r ?? 0,
          rx: k.rx ?? k.x,
          ry: k.ry ?? k.y,
          header: spec.header,
          secondaryLabel: spec.secondaryLabel,
          badgeKind: isCustom ? "custom" : "stock",
          tooltip: b
            ? `Pos #${idx}\n${displayName || `B#${b.behavior_id}`} (id=${b.behavior_id})\np1=${formatHex(b.param1)} p2=${formatHex(b.param2)}`
            : `Pos #${idx}`,
          children: <KeycapLegend spec={spec} />,
        };
      });
    }

    return layoutKeys.map((k, idx) => {
      const bindingStr = activeLayer?.reserved
        ? "(reserved)"
        : activeLayer?.bindings[idx] || "&trans";
      const parsed = parseDtsBindingExpr(bindingStr);
      const isCustom = customLabelSet.has(parsed.behavior);
      const isSafety =
        parsed.behavior === "&studio_unlock" ||
        parsed.behavior === "&bootloader" ||
        parsed.behavior === "&sys_reset";

      const spec = resolveDtsBindingLegend(
        bindingStr,
        layers,
        customBehaviorDefs,
        Boolean(activeLayer?.reserved)
      );

      return {
        id: `repo-${selectedLayerIdx}-${idx}`,
        x: k.x,
        y: k.y,
        width: k.w ?? 1,
        height: k.h ?? 1,
        r: k.r ?? 0,
        rx: k.rx ?? k.x,
        ry: k.ry ?? k.y,
        header: spec.header,
        secondaryLabel: spec.secondaryLabel,
        badgeKind: isCustom ? "custom" : isSafety ? "safety" : "stock",
        isDiff: highlightedComboPositions.has(idx),
        tooltip: `Pos #${idx}: ${bindingStr}`,
        children: <KeycapLegend spec={spec} />,
      };
    });
  }, [
    layoutKeys,
    viewMode,
    loadedSnapshot,
    selectedLayerIdx,
    activeLayer,
    customLabelSet,
    customBehaviorDefs,
    layers,
    highlightedComboPositions,
  ]);

  const selectedBindingStr =
    viewMode === "repo" && selectedKeyIdx !== undefined && activeLayer && !activeLayer.reserved
      ? activeLayer.bindings[selectedKeyIdx] || "&trans"
      : null;
  const parsedSelected = useMemo(
    () => (selectedBindingStr ? parseDtsBindingExpr(selectedBindingStr) : null),
    [selectedBindingStr]
  );

  const selectedIsCustom = parsedSelected
    ? customLabelSet.has(parsedSelected.behavior)
    : false;
  const selectedIsSafety = parsedSelected
    ? ["&studio_unlock", "&bootloader", "&sys_reset"].includes(parsedSelected.behavior)
    : false;
  const selectedProtected = selectedIsCustom || selectedIsSafety;
  const selectedLocked = guardEnabled && selectedProtected && !unlockedKey;

  const selectedBehaviorSpec = STANDARD_BEHAVIORS.find(
    (b) => b.ref === parsedSelected?.behavior
  );

  const sidebarLayerList =
    viewMode === "snapshot" && loadedSnapshot
      ? loadedSnapshot.layers.map((l, i) => ({
          id: String(l.id),
          displayName: l.name || `Layer ${i}`,
          reserved: false,
        }))
      : layers;

  return (
    <div className="h-full grid grid-cols-[240px_1fr] grid-rows-[auto_1fr_auto] bg-background overflow-hidden">
      {/* Sub-header Toolbar */}
      <div className="col-span-2 flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-surface border-b border-border text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg bg-recess p-0.5 border border-border">
            {isConnected && onSwitchToLive && (
              <button
                type="button"
                onClick={onSwitchToLive}
                className="px-2.5 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Live RPC
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setViewMode("repo");
                setSelectedLayerIdx(0);
              }}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                viewMode === "repo"
                  ? "bg-surface text-foreground shadow-sm border border-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Repo Keymap
            </button>
            <button
              type="button"
              onClick={() => {
                setViewMode("snapshot");
                setSelectedLayerIdx(0);
              }}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                viewMode === "snapshot"
                  ? "bg-surface text-foreground shadow-sm border border-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Snapshots ({snapshots.length})
            </button>
          </div>

          {viewMode === "repo" && (
            <button
              type="button"
              onClick={() => setGuardEnabled((v) => !v)}
              className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border text-xs font-medium transition-colors ${
                guardEnabled
                  ? "bg-surface border-border text-foreground"
                  : "bg-recess border-transparent text-muted-foreground"
              }`}
            >
              {guardEnabled ? (
                <Shield className="w-3.5 h-3.5 text-[#FC4C01]" />
              ) : (
                <ShieldOff className="w-3.5 h-3.5" />
              )}
              Guard {guardEnabled ? "On" : "Off"}
            </button>
          )}

          {viewMode === "snapshot" && snapshots.length > 0 && (
            <select
              value={selectedSnapshotRel}
              onChange={(e) => setSelectedSnapshotRel(e.target.value)}
              className={`${INPUT_CLS} h-7 max-w-xs font-mono`}
            >
              {snapshots.map((s) => (
                <option key={s.relPath} value={s.relPath}>
                  {s.relPath}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {viewMode === "repo" && (
            <>
              <button
                type="button"
                disabled={history.length === 0}
                onClick={handleUndo}
                className="grid h-7 w-7 place-items-center rounded-lg bg-recess border border-border text-foreground hover:bg-muted disabled:opacity-35"
                title="Undo"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={future.length === 0}
                onClick={handleRedo}
                className="grid h-7 w-7 place-items-center rounded-lg bg-recess border border-border text-foreground hover:bg-muted disabled:opacity-35"
                title="Redo"
              >
                <Redo2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (diffText !== null) {
                    setDiffText(null);
                    return;
                  }
                  if (!firmwareModel) return;
                  const d = await getGitDiff(firmwareModel.repoPath, "config/toucan.keymap");
                  setDiffText(d || "# Working tree clean on config/toucan.keymap");
                }}
                className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border text-xs font-medium transition-colors ${
                  diffText !== null
                    ? "bg-foreground text-background border-foreground"
                    : "bg-recess border-border text-foreground hover:bg-muted"
                }`}
              >
                <GitCompare className="w-3.5 h-3.5" />
                Diff
              </button>
              <button
                type="button"
                disabled={!isDirty || saving}
                onClick={handleSave}
                className="inline-flex items-center gap-1.5 h-7 px-3 rounded-lg bg-[#FC4C01] text-white text-xs font-medium hover:opacity-90 disabled:opacity-35 transition-opacity"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? "Saving..." : "Save Keymap"}
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onEditKeymapFile}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-recess border border-border text-muted-foreground hover:text-foreground text-xs font-medium"
          >
            <FileCode2 className="w-3.5 h-3.5" />
            Source
          </button>
        </div>
      </div>

      {/* Left Rail: Layers */}
      <aside className="p-3 bg-surface border-r border-border flex flex-col gap-3 overflow-y-auto row-span-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Layers
          </span>
          {viewMode === "repo" && (
            <button
              type="button"
              onClick={handleActivateOrAddLayer}
              className="grid h-6 w-6 place-items-center rounded-md bg-recess border border-border text-muted-foreground hover:text-foreground transition-colors"
              title="Activate reserved slot or add layer"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="space-y-1">
          {sidebarLayerList.map((layer, i) => {
            const isSel = selectedLayerIdx === i;
            return (
              <button
                key={`${layer.id}-${i}`}
                type="button"
                onClick={() => {
                  setSelectedLayerIdx(i);
                  setSelectedKeyIdx(undefined);
                }}
                className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-xs transition-colors ${
                  isSel
                    ? "bg-muted text-foreground font-medium border border-border"
                    : "text-muted-foreground hover:text-foreground hover:bg-recess/60 border border-transparent"
                }`}
              >
                <span className="flex items-center gap-2 truncate">
                  <span
                    className={`font-mono text-[10px] w-4 text-center ${
                      isSel ? "text-[#FC4C01] font-semibold" : "opacity-55"
                    }`}
                  >
                    {i}
                  </span>
                  <span className="truncate">{layer.displayName}</span>
                </span>
                {layer.reserved && (
                  <span className="text-[10px] font-mono text-muted-foreground">
                    rsv
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {viewMode === "repo" && activeLayer && (
          <div className="pt-3 border-t border-border space-y-2.5 text-xs">
            {activeLayer.reserved ? (
              <button
                type="button"
                onClick={() => {
                  const next = layers.map((l, i) =>
                    i === selectedLayerIdx
                      ? {
                          ...l,
                          reserved: undefined,
                          displayName: `L${selectedLayerIdx}`,
                          bindings: Array(layoutKeys.length || 42).fill("&trans"),
                        }
                      : l
                  );
                  commitDraft(next);
                }}
                className="w-full h-8 rounded-lg bg-[#FC4C01] text-white font-medium text-xs hover:opacity-90"
              >
                Activate Layer Slot
              </button>
            ) : (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-muted-foreground">Display Name</span>
                  <input
                    type="text"
                    value={activeLayer.displayName}
                    onChange={(e) => {
                      const val = e.target.value;
                      commitDraft(
                        layers.map((l, i) =>
                          i === selectedLayerIdx ? { ...l, displayName: val } : l
                        )
                      );
                    }}
                    className={`${INPUT_CLS} font-mono`}
                  />
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    disabled={selectedLayerIdx === 0}
                    onClick={() => handleMoveLayer(-1)}
                    className="grid h-7 place-items-center rounded-lg bg-recess border border-border text-muted-foreground hover:text-foreground disabled:opacity-35"
                    title="Move Up"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={selectedLayerIdx >= layers.length - 1}
                    onClick={() => handleMoveLayer(1)}
                    className="grid h-7 place-items-center rounded-lg bg-recess border border-border text-muted-foreground hover:text-foreground disabled:opacity-35"
                    title="Move Down"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleDuplicateLayer}
                    className="grid h-7 place-items-center rounded-lg bg-recess border border-border text-muted-foreground hover:text-foreground"
                    title="Duplicate Layer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <div className="mt-auto pt-3 border-t border-border text-[11px] space-y-1.5 text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#FC4C01]" />
            Custom firmware behavior
          </div>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Protected safety key
          </div>
        </div>
      </aside>

      {/* Main Tactile Keyboard Stage */}
      <div className="vmk-stage-mat relative flex flex-col items-center justify-center p-6 overflow-hidden min-w-0 min-h-0">
        {diffText !== null && (
          <div className="w-full max-w-4xl mb-4 max-h-48 overflow-hidden">
            <CodeBlock
              code={diffText}
              language="diff"
              filename="config/toucan.keymap (git diff)"
              accent="#FC4C01"
              className="max-h-48"
            />
          </div>
        )}

        {loading && positions.length === 0 ? (
          <div className="text-xs font-mono text-muted-foreground">
            Loading Toucan 2 layout…
          </div>
        ) : positions.length > 0 ? (
          <PhysicalLayout
            positions={positions}
            oneU={54}
            zoom="auto"
            selectedPosition={selectedKeyIdx}
            onPositionClicked={handleKeyClick}
            toucanHardware={{
              firmwareModel,
              activeLayerName:
                viewMode === "snapshot" && loadedSnapshot
                  ? loadedSnapshot.layers[selectedLayerIdx]?.name ||
                    `L${selectedLayerIdx}`
                  : activeLayer?.displayName || activeLayer?.id || "BASE",
              selectedModule,
              onSelectModule: handleSelectHardwareModule,
            }}
          />
        ) : (
          <div className="text-xs text-muted-foreground">
            No physical layout found. Configure repository path in Build &amp; Flash.
          </div>
        )}
      </div>

      {/* Bottom Inspector Drawer */}
      <div className="col-start-2 bg-surface border-t border-border px-5 py-3.5 min-h-[12rem] max-h-[38vh] overflow-y-auto text-xs space-y-3">
        {selectedModule === "lcd" && firmwareModel ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-[84px] h-[98px] shrink-0 rounded-lg p-1 bg-recess border border-border">
                <ToucanLcdScreenPreview
                  styleIndex={firmwareModel.conf.statusScreenStyle}
                  layerName={activeLayer?.displayName || "BASE"}
                  cgSwapEnabled={firmwareModel.conf.cgToggleEnabled}
                  compact
                />
              </div>
              <div className="space-y-2 min-w-0">
                <div className="flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-[#FC4C01]" />
                  <span className="font-semibold text-foreground">
                    Toucan 2 Sharp Memory LCD (144×168 MIP)
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-recess border border-border text-muted-foreground">
                    Left Half · SPI0
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { id: 0, label: "0 · Classic" },
                    { id: 1, label: "1 · Logo & Layer" },
                    { id: 2, label: "2 · Arc + WPM" },
                  ].map((opt) => {
                    const active = firmwareModel.conf.statusScreenStyle === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={savingHardware}
                        onClick={() =>
                          handleQuickPatchHardware(
                            {
                              conf: {
                                ...firmwareModel.conf,
                                statusScreenStyle: opt.id,
                              },
                            },
                            `LCD Style ${opt.id}`
                          )
                        }
                        className={`h-7 px-2.5 rounded-lg border font-mono text-[11px] transition-colors disabled:opacity-50 ${
                          active
                            ? "bg-[#FC4C01] border-[#FC4C01] text-white"
                            : "bg-recess border-border text-foreground hover:bg-muted"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Writes <code className="font-mono">CONFIG_TOUCAN_STATUS_SCREEN</code> in{" "}
                  <code className="font-mono">boards/shields/toucan/toucan_left.conf</code>. Ready for custom LVGL widgets in <code className="font-mono">nice_view_gem/</code>.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {onEditRepoFile && (
                <button
                  type="button"
                  onClick={() => onEditRepoFile("boards/shields/toucan/toucan_left.conf")}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-recess border border-border text-foreground hover:bg-muted"
                >
                  <FileCode2 className="w-3.5 h-3.5" />
                  toucan_left.conf
                </button>
              )}
              {onOpenTunerSection && (
                <button
                  type="button"
                  onClick={() => onOpenTunerSection("display")}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#FC4C01] text-white font-medium hover:opacity-90"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  Open LCD Tuner
                </button>
              )}
            </div>
          </div>
        ) : selectedModule === "trackpad" && firmwareModel ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-2 min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <MousePointer2 className="w-4 h-4 text-[#FC4C01]" />
                <span className="font-semibold text-foreground">
                  Azoteq TPS43 Capacitive Trackpad (43×40mm)
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-recess border border-border text-muted-foreground">
                  Right Half · I2C0 · XY {firmwareModel.trackpadProcessors.xyScaleMul}/
                  {firmwareModel.trackpadProcessors.xyScaleDiv} · Scroll{" "}
                  {firmwareModel.trackpadProcessors.scrollScaleMul}/
                  {firmwareModel.trackpadProcessors.scrollScaleDiv}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  {
                    label: "Listener",
                    active: firmwareModel.leftOverlayGates.trackpadListenerEnabled,
                    onClick: () =>
                      handleQuickPatchHardware(
                        {
                          leftOverlayGates: {
                            ...firmwareModel.leftOverlayGates,
                            trackpadListenerEnabled:
                              !firmwareModel.leftOverlayGates.trackpadListenerEnabled,
                          },
                        },
                        "Trackpad Listener"
                      ),
                  },
                  {
                    label: "Pinch Zoom",
                    active: firmwareModel.leftOverlayGates.zipZoomMapperEnabled,
                    onClick: () =>
                      handleQuickPatchHardware(
                        {
                          leftOverlayGates: {
                            ...firmwareModel.leftOverlayGates,
                            zipZoomMapperEnabled:
                              !firmwareModel.leftOverlayGates.zipZoomMapperEnabled,
                          },
                        },
                        "Pinch Zoom Mapper"
                      ),
                  },
                  {
                    label: "2F Smart Zoom",
                    active: firmwareModel.leftOverlayGates.twoFingerDoubleTapEnabled,
                    onClick: () =>
                      handleQuickPatchHardware(
                        {
                          leftOverlayGates: {
                            ...firmwareModel.leftOverlayGates,
                            twoFingerDoubleTapEnabled:
                              !firmwareModel.leftOverlayGates.twoFingerDoubleTapEnabled,
                          },
                        },
                        "Two-Finger Double Tap"
                      ),
                  },
                  {
                    label: "3F Swipe",
                    active: firmwareModel.trackpadHardware.threeFingerSwipe,
                    onClick: () =>
                      handleQuickPatchHardware(
                        {
                          trackpadHardware: {
                            ...firmwareModel.trackpadHardware,
                            threeFingerSwipe:
                              !firmwareModel.trackpadHardware.threeFingerSwipe,
                          },
                        },
                        "Three-Finger Swipe"
                      ),
                  },
                  {
                    label: "Invert Scroll Y",
                    active: firmwareModel.trackpadHardware.invertScrollY,
                    onClick: () =>
                      handleQuickPatchHardware(
                        {
                          trackpadHardware: {
                            ...firmwareModel.trackpadHardware,
                            invertScrollY: !firmwareModel.trackpadHardware.invertScrollY,
                          },
                        },
                        "Invert Scroll Y"
                      ),
                  },
                  {
                    label: `Split Relay (Q=${firmwareModel.conf.splitInputRelayQueueSize})`,
                    active: firmwareModel.conf.splitInputRelayEnabled,
                    onClick: () =>
                      handleQuickPatchHardware(
                        {
                          conf: {
                            ...firmwareModel.conf,
                            splitInputRelayEnabled:
                              !firmwareModel.conf.splitInputRelayEnabled,
                          },
                        },
                        "Split Input Relay"
                      ),
                  },
                ].map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    disabled={savingHardware}
                    onClick={chip.onClick}
                    className={`h-7 px-2.5 rounded-lg border text-[11px] font-medium transition-colors disabled:opacity-50 ${
                      chip.active
                        ? "bg-[#FC4C01]/15 border-[#FC4C01] text-foreground"
                        : "bg-recess border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {chip.active ? "● " : "○ "}
                    {chip.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Quick-toggles write directly to <code className="font-mono">toucan_left.overlay</code>, <code className="font-mono">toucan_right.overlay</code>, and <code className="font-mono">toucan_right.conf</code>.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {onOpenTunerSection && (
                <button
                  type="button"
                  onClick={() => onOpenTunerSection("trackpad")}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#FC4C01] text-white font-medium hover:opacity-90"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  Open Trackpad Tuner
                </button>
              )}
            </div>
          </div>
        ) : viewMode === "snapshot" ? (
          <div>
            {selectedKeyIdx !== undefined && loadedSnapshot ? (
              (() => {
                const b = loadedSnapshot.layers[selectedLayerIdx]?.bindings[selectedKeyIdx];
                return b ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-medium text-foreground">
                      Pos #{selectedKeyIdx}
                    </span>
                    <code className="font-mono px-2.5 py-1 rounded-lg bg-recess border border-border text-foreground">
                      behavior_id={b.behavior_id} · p1={formatHex(b.param1)} · p2={formatHex(b.param2)}
                    </code>
                  </div>
                ) : null;
              })()
            ) : (
              <span className="text-muted-foreground">
                Select any key on the snapshot layout to inspect its saved Studio binding.
              </span>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-border">
              <div className="inline-flex rounded-lg bg-recess p-0.5 border border-border">
                {(
                  [
                    ["binding", "Key Binding"],
                    ["combos", `Combos (${combos.length})`],
                    ["conditional", `Conditional Layers (${conditionalLayers.length})`],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setSubPanel(id);
                      if (id !== "combos") setPickingComboIdx(null);
                    }}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      subPanel === id
                        ? "bg-surface text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {isDirty && (
                <button
                  type="button"
                  onClick={() => {
                    if (!firmwareModel) return;
                    setLayers(
                      firmwareModel.repoKeymapLayers.map((l) => ({
                        ...l,
                        bindings: [...l.bindings],
                      }))
                    );
                    setConditionalLayers(firmwareModel.conditionalLayers);
                    setCombos(firmwareModel.combos);
                    toast.info("Discarded unsaved keymap draft");
                  }}
                  className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-recess border border-border text-muted-foreground hover:text-foreground text-xs"
                >
                  <RotateCcw className="w-3 h-3" />
                  Discard Draft
                </button>
              )}
            </div>

            {subPanel === "binding" && (
              <>
                {!parsedSelected || selectedKeyIdx === undefined ? (
                  <p className="text-muted-foreground py-2">
                    Click any key on the Toucan 2 layout to edit its behavior, keycode, modifiers, or assign a custom firmware behavior.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {selectedProtected && (
                      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-recess border border-border">
                        <div className="flex items-center gap-2 text-xs">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              selectedIsCustom ? "bg-[#FC4C01]" : "bg-amber-500"
                            }`}
                          />
                          <span className="font-medium text-foreground">
                            {selectedIsCustom
                              ? "Custom Firmware Binding"
                              : "Protected Safety Binding"}
                          </span>
                          <code className="font-mono text-muted-foreground">
                            {selectedBindingStr}
                          </code>
                        </div>
                        {guardEnabled && (
                          <button
                            type="button"
                            onClick={() => setUnlockedKey((v) => !v)}
                            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-surface border border-border text-xs font-medium text-foreground hover:bg-muted"
                          >
                            {selectedLocked ? (
                              <>
                                <Lock className="w-3 h-3 text-[#FC4C01]" />
                                Unlock Key
                              </>
                            ) : (
                              <>
                                <Unlock className="w-3 h-3 text-muted-foreground" />
                                Unlocked
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-mono text-[11px] px-2 py-1 rounded-md bg-recess border border-border text-muted-foreground">
                        L{selectedLayerIdx} · #{selectedKeyIdx}
                      </span>
                      <select
                        disabled={selectedLocked}
                        value={parsedSelected.behavior}
                        onChange={(e) => {
                          const nextBeh = e.target.value;
                          const spec = STANDARD_BEHAVIORS.find((b) => b.ref === nextBeh);
                          if (!spec || spec.argsKind === "none") {
                            updateSelectedKeyBinding(nextBeh);
                          } else if (spec.argsKind === "keycode") {
                            updateSelectedKeyBinding(`${nextBeh} A`);
                          } else if (spec.argsKind === "mod_tap") {
                            updateSelectedKeyBinding(`${nextBeh} LGUI SPACE`);
                          } else if (spec.argsKind === "layer_tap") {
                            updateSelectedKeyBinding(`${nextBeh} 1 SPACE`);
                          } else if (spec.argsKind === "layer") {
                            updateSelectedKeyBinding(`${nextBeh} 1`);
                          } else if (spec.argsKind === "bt") {
                            updateSelectedKeyBinding(`${nextBeh} BT_SEL 0`);
                          } else if (spec.argsKind === "out") {
                            updateSelectedKeyBinding(`${nextBeh} OUT_TOG`);
                          } else if (spec.argsKind === "mkp") {
                            updateSelectedKeyBinding(`${nextBeh} LCLK`);
                          }
                        }}
                        className={INPUT_CLS}
                      >
                        {!STANDARD_BEHAVIORS.some((b) => b.ref === parsedSelected.behavior) &&
                          !customBehaviorDefs.some(
                            (c) => `&${c.label}` === parsedSelected.behavior
                          ) && (
                            <option value={parsedSelected.behavior}>
                              {parsedSelected.behavior}
                            </option>
                          )}
                        {customBehaviorDefs.length > 0 && (
                          <optgroup label="Custom Firmware Behaviors">
                            {customBehaviorDefs.map((c) => (
                              <option key={c.label} value={`&${c.label}`}>
                                {c.displayName} (&amp;{c.label})
                              </option>
                            ))}
                          </optgroup>
                        )}
                        <optgroup label="Standard ZMK">
                          {STANDARD_BEHAVIORS.filter((b) => b.category === "stock").map((b) => (
                            <option key={b.ref} value={b.ref}>
                              {b.label}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Safety & Bootloader">
                          {STANDARD_BEHAVIORS.filter((b) => b.category === "safety").map((b) => (
                            <option key={b.ref} value={b.ref}>
                              {b.label}
                            </option>
                          ))}
                        </optgroup>
                      </select>

                      <input
                        type="text"
                        disabled={selectedLocked}
                        value={selectedBindingStr || ""}
                        onChange={(e) => updateSelectedKeyBinding(e.target.value)}
                        className={`${INPUT_CLS} font-mono flex-1 min-w-[180px]`}
                        placeholder="&kp A"
                      />
                    </div>

                    {selectedBehaviorSpec?.argsKind === "keycode" && (
                      <KeycodeSelect
                        label="Keycode"
                        disabled={selectedLocked}
                        value={parsedSelected.params[0] || "A"}
                        onChange={(k) =>
                          updateSelectedKeyBinding(
                            formatDtsBindingExpr(parsedSelected.behavior, [k])
                          )
                        }
                      />
                    )}

                    {selectedBehaviorSpec?.argsKind === "mod_tap" && (
                      <div className="space-y-2">
                        <KeycodeSelect
                          label="Hold Mod"
                          disabled={selectedLocked}
                          allowMods={false}
                          value={parsedSelected.params[0] || "LGUI"}
                          onChange={(hold) =>
                            updateSelectedKeyBinding(
                              formatDtsBindingExpr("&mt", [
                                hold,
                                parsedSelected.params[1] || "SPACE",
                              ])
                            )
                          }
                        />
                        <KeycodeSelect
                          label="Tap Key"
                          disabled={selectedLocked}
                          value={parsedSelected.params[1] || "SPACE"}
                          onChange={(tap) =>
                            updateSelectedKeyBinding(
                              formatDtsBindingExpr("&mt", [
                                parsedSelected.params[0] || "LGUI",
                                tap,
                              ])
                            )
                          }
                        />
                      </div>
                    )}

                    {selectedBehaviorSpec?.argsKind === "layer_tap" && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-medium text-muted-foreground w-16">
                            Hold Layer
                          </span>
                          <select
                            disabled={selectedLocked}
                            value={parsedSelected.params[0] || "1"}
                            onChange={(e) =>
                              updateSelectedKeyBinding(
                                formatDtsBindingExpr("&lt", [
                                  e.target.value,
                                  parsedSelected.params[1] || "SPACE",
                                ])
                              )
                            }
                            className={INPUT_CLS}
                          >
                            {layers.map((l, idx) => (
                              <option key={l.id} value={String(idx)}>
                                {idx}: {l.displayName}
                              </option>
                            ))}
                          </select>
                        </div>
                        <KeycodeSelect
                          label="Tap Key"
                          disabled={selectedLocked}
                          value={parsedSelected.params[1] || "SPACE"}
                          onChange={(tap) =>
                            updateSelectedKeyBinding(
                              formatDtsBindingExpr("&lt", [
                                parsedSelected.params[0] || "1",
                                tap,
                              ])
                            )
                          }
                        />
                      </div>
                    )}

                    {selectedBehaviorSpec?.argsKind === "layer" && (
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium text-muted-foreground w-16">
                          Layer
                        </span>
                        <select
                          disabled={selectedLocked}
                          value={parsedSelected.params[0] || "1"}
                          onChange={(e) =>
                            updateSelectedKeyBinding(
                              formatDtsBindingExpr(parsedSelected.behavior, [e.target.value])
                            )
                          }
                          className={INPUT_CLS}
                        >
                          {layers.map((l, idx) => (
                            <option key={l.id} value={String(idx)}>
                              {idx}: {l.displayName}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {selectedBehaviorSpec?.argsKind === "bt" && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-medium text-muted-foreground w-16">
                          Bluetooth
                        </span>
                        <select
                          disabled={selectedLocked}
                          value={parsedSelected.params[0] || "BT_SEL"}
                          onChange={(e) => {
                            const cmd = e.target.value;
                            const needsProf = cmd === "BT_SEL" || cmd === "BT_DISC";
                            updateSelectedKeyBinding(
                              formatDtsBindingExpr("&bt", needsProf ? [cmd, "0"] : [cmd])
                            );
                          }}
                          className={INPUT_CLS}
                        >
                          <option value="BT_SEL">BT_SEL (Select Profile)</option>
                          <option value="BT_CLR">BT_CLR (Clear Current)</option>
                          <option value="BT_CLR_ALL">BT_CLR_ALL</option>
                          <option value="BT_NXT">BT_NXT</option>
                          <option value="BT_PRV">BT_PRV</option>
                          <option value="BT_DISC">BT_DISC</option>
                        </select>
                        {(parsedSelected.params[0] === "BT_SEL" ||
                          parsedSelected.params[0] === "BT_DISC") && (
                          <select
                            disabled={selectedLocked}
                            value={parsedSelected.params[1] || "0"}
                            onChange={(e) =>
                              updateSelectedKeyBinding(
                                formatDtsBindingExpr("&bt", [
                                  parsedSelected.params[0],
                                  e.target.value,
                                ])
                              )
                            }
                            className={INPUT_CLS}
                          >
                            {[0, 1, 2, 3, 4].map((p) => (
                              <option key={p} value={String(p)}>
                                Profile {p}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}

                    {selectedBehaviorSpec?.argsKind === "out" && (
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium text-muted-foreground w-16">
                          Output
                        </span>
                        <select
                          disabled={selectedLocked}
                          value={parsedSelected.params[0] || "OUT_TOG"}
                          onChange={(e) =>
                            updateSelectedKeyBinding(formatDtsBindingExpr("&out", [e.target.value]))
                          }
                          className={INPUT_CLS}
                        >
                          <option value="OUT_USB">OUT_USB</option>
                          <option value="OUT_BLE">OUT_BLE</option>
                          <option value="OUT_TOG">OUT_TOG</option>
                        </select>
                      </div>
                    )}

                    {selectedBehaviorSpec?.argsKind === "mkp" && (
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium text-muted-foreground w-16">
                          Button
                        </span>
                        <select
                          disabled={selectedLocked}
                          value={parsedSelected.params[0] || "LCLK"}
                          onChange={(e) =>
                            updateSelectedKeyBinding(formatDtsBindingExpr("&mkp", [e.target.value]))
                          }
                          className={INPUT_CLS}
                        >
                          <option value="LCLK">LCLK</option>
                          <option value="RCLK">RCLK</option>
                          <option value="MCLK">MCLK</option>
                          <option value="MB4">MB4</option>
                          <option value="MB5">MB5</option>
                        </select>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {subPanel === "combos" && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    Click &quot;Pick Keys&quot; then click keys directly on the layout above.
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const next: ComboDef = {
                        name: `combo_${combos.length + 1}`,
                        timeoutMs: 50,
                        keyPositions: [1, 2],
                        bindings: "&kp ESC",
                      };
                      commitDraft(layers, conditionalLayers, [...combos, next]);
                      setPickingComboIdx(combos.length);
                    }}
                    className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-[#FC4C01] text-white font-medium"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Combo
                  </button>
                </div>

                {combos.length === 0 ? (
                  <p className="text-muted-foreground">No combos defined.</p>
                ) : (
                  <div className="space-y-1.5">
                    {combos.map((combo, idx) => (
                      <div
                        key={idx}
                        className={`flex flex-wrap items-center gap-2 p-2 rounded-xl bg-recess border ${
                          pickingComboIdx === idx ? "border-[#FC4C01]" : "border-border"
                        }`}
                      >
                        <input
                          type="text"
                          value={combo.name}
                          onChange={(e) =>
                            commitDraft(
                              layers,
                              conditionalLayers,
                              combos.map((c, i) =>
                                i === idx ? { ...c, name: e.target.value } : c
                              )
                            )
                          }
                          className={`${INPUT_CLS} w-28 font-mono`}
                        />
                        <input
                          type="number"
                          value={combo.timeoutMs}
                          min={10}
                          max={300}
                          onChange={(e) =>
                            commitDraft(
                              layers,
                              conditionalLayers,
                              combos.map((c, i) =>
                                i === idx
                                  ? { ...c, timeoutMs: parseInt(e.target.value, 10) || 50 }
                                  : c
                              )
                            )
                          }
                          className={`${INPUT_CLS} w-16 font-mono`}
                        />
                        <span className="text-muted-foreground">ms</span>
                        <input
                          type="text"
                          value={combo.bindings}
                          onChange={(e) =>
                            commitDraft(
                              layers,
                              conditionalLayers,
                              combos.map((c, i) =>
                                i === idx ? { ...c, bindings: e.target.value } : c
                              )
                            )
                          }
                          className={`${INPUT_CLS} w-40 font-mono`}
                        />
                        <span className="font-mono text-[11px] px-2 py-1 rounded-md bg-surface border border-border text-muted-foreground">
                          [{combo.keyPositions.join(", ")}]
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setPickingComboIdx(pickingComboIdx === idx ? null : idx)
                          }
                          className={`h-7 px-2.5 rounded-lg text-xs font-medium ${
                            pickingComboIdx === idx
                              ? "bg-[#FC4C01] text-white"
                              : "bg-surface border border-border text-foreground"
                          }`}
                        >
                          {pickingComboIdx === idx ? "Done" : "Pick Keys"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (pickingComboIdx === idx) setPickingComboIdx(null);
                            commitDraft(
                              layers,
                              conditionalLayers,
                              combos.filter((_, i) => i !== idx)
                            );
                          }}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500 ml-auto"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {subPanel === "conditional" && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    Activate a layer automatically when multiple layers are held together.
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      commitDraft(
                        layers,
                        [
                          ...conditionalLayers,
                          {
                            name: `cond_${conditionalLayers.length + 1}`,
                            ifLayers: [1, 2],
                            thenLayer: 3,
                          },
                        ],
                        combos
                      )
                    }
                    className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-[#FC4C01] text-white font-medium"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Rule
                  </button>
                </div>

                {conditionalLayers.map((rule, idx) => (
                  <div
                    key={idx}
                    className="flex flex-wrap items-center gap-2 p-2 rounded-xl bg-recess border border-border"
                  >
                    <input
                      type="text"
                      value={rule.name}
                      onChange={(e) =>
                        commitDraft(
                          layers,
                          conditionalLayers.map((r, i) =>
                            i === idx ? { ...r, name: e.target.value } : r
                          ),
                          combos
                        )
                      }
                      className={`${INPUT_CLS} w-28 font-mono`}
                    />
                    <span className="text-muted-foreground">if-layers</span>
                    <input
                      type="text"
                      value={rule.ifLayers.join(" ")}
                      onChange={(e) => {
                        const nums = e.target.value
                          .trim()
                          .split(/\s+/)
                          .map((n) => parseInt(n, 10))
                          .filter((n) => !Number.isNaN(n));
                        commitDraft(
                          layers,
                          conditionalLayers.map((r, i) =>
                            i === idx ? { ...r, ifLayers: nums } : r
                          ),
                          combos
                        );
                      }}
                      className={`${INPUT_CLS} w-24 font-mono`}
                    />
                    <span className="text-muted-foreground">→ then</span>
                    <select
                      value={rule.thenLayer}
                      onChange={(e) =>
                        commitDraft(
                          layers,
                          conditionalLayers.map((r, i) =>
                            i === idx
                              ? { ...r, thenLayer: parseInt(e.target.value, 10) }
                              : r
                          ),
                          combos
                        )
                      }
                      className={INPUT_CLS}
                    >
                      {layers.map((l, li) => (
                        <option key={l.id} value={li}>
                          {li}: {l.displayName}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() =>
                        commitDraft(
                          layers,
                          conditionalLayers.filter((_, i) => i !== idx),
                          combos
                        )
                      }
                      className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500 ml-auto"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
