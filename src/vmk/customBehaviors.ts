import type { GetBehaviorDetailsResponse } from "@zmkfirmware/zmk-studio-ts-client/behaviors";
import type { BehaviorBinding, Keymap } from "@zmkfirmware/zmk-studio-ts-client/keymap";
import { hid_usage_get_labels } from "../hid-usages";
import type {
  CustomBehaviorDef,
  KeymapDiffEntry,
  StudioSnapshot,
} from "./types";

const SAFETY_BEHAVIOR_NAMES = new Set([
  "Studio Unlock",
  "Bootloader",
  "Reset",
]);

const STOCK_BEHAVIOR_NAMES = new Set([
  "Key Press",
  "Key Toggle",
  "Mod-Tap",
  "Layer-Tap",
  "Momentary Layer",
  "To Layer",
  "Toggle Layer",
  "Sticky Key",
  "Sticky Layer",
  "Transparent",
  "None",
  "Caps Word",
  "Key Repeat",
  "Bluetooth",
  "Output Selection",
  "Mouse Key Press",
  "Mouse Move",
  "Mouse Scroll",
  "External Power",
  "RGB Underglow",
  "Backlight",
  "Soft Off",
  "Grave Escape",
  "Behavior None",
  "Behavior Transparent",
  ...SAFETY_BEHAVIOR_NAMES,
]);

export type BehaviorKind = "custom" | "safety" | "stock" | "unknown";

export interface BehaviorClassification {
  kind: BehaviorKind;
  customDef?: CustomBehaviorDef;
  label: string;
  description?: string;
}

export function classifyBehavior(
  behavior: GetBehaviorDetailsResponse | undefined,
  customDefs: CustomBehaviorDef[]
): BehaviorClassification {
  if (!behavior) {
    return {
      kind: "unknown",
      label: "Unknown Behavior",
      description: "Firmware behavior ID is not present in the loaded behavior table.",
    };
  }

  const name = behavior.displayName?.trim() || `Behavior #${behavior.id}`;
  const customMatch = customDefs.find(
    (d) =>
      d.displayName.toLowerCase() === name.toLowerCase() ||
      d.label.toLowerCase() === name.toLowerCase()
  );
  if (customMatch) {
    return {
      kind: "custom",
      customDef: customMatch,
      label: customMatch.displayName,
      description: `Custom firmware behavior (&${customMatch.label}) from ${customMatch.sourceFile}`,
    };
  }

  if (SAFETY_BEHAVIOR_NAMES.has(name)) {
    return {
      kind: "safety",
      label: name,
      description:
        name === "Studio Unlock"
          ? "Required to unlock ZMK/VMK Studio live editing."
          : "Controller boot/reset action. Removing or misplacing can lock you out of flashing.",
    };
  }

  if (STOCK_BEHAVIOR_NAMES.has(name)) {
    return {
      kind: "stock",
      label: name,
    };
  }

  return {
    kind: "custom",
    label: name,
    description:
      "Non-stock behavior exposed by firmware. Protected against accidental overwrite.",
  };
}

export function isProtectedBinding(
  binding: BehaviorBinding,
  behaviors: Record<number, GetBehaviorDetailsResponse>,
  customDefs: CustomBehaviorDef[]
): { protected: boolean; kind: BehaviorKind; reason?: string; customDef?: CustomBehaviorDef } {
  const behavior = behaviors[binding.behaviorId];
  const cls = classifyBehavior(behavior, customDefs);

  if (cls.kind === "custom") {
    return {
      protected: true,
      kind: "custom",
      customDef: cls.customDef,
      reason:
        cls.description ||
        `Custom behavior "${cls.label}" is protected from accidental overwrite.`,
    };
  }
  if (cls.kind === "safety") {
    return {
      protected: true,
      kind: "safety",
      reason: cls.description || `Safety key "${cls.label}" is protected.`,
    };
  }
  if (cls.kind === "unknown") {
    return {
      protected: true,
      kind: "unknown",
      reason: `Unrecognized behaviorId=${binding.behaviorId} (param1=${binding.param1}, param2=${binding.param2}).`,
    };
  }

  return { protected: false, kind: "stock" };
}

export interface DecodedHidUsage {
  page: number;
  id: number;
  modMask: number;
  modLabels: string[];
  baseUsage: number;
}

const MOD_BIT_LABELS: Array<[number, string]> = [
  [0x01, "L⌃"],
  [0x02, "L⇧"],
  [0x04, "L⌥"],
  [0x08, "L⌘"],
  [0x10, "R⌃"],
  [0x20, "R⇧"],
  [0x40, "R⌥"],
  [0x80, "R⌘"],
];

export function decodeHidUsageWithMods(usage: number): DecodedHidUsage {
  const unsigned = usage >>> 0;
  const modMask = (unsigned >>> 24) & 0xff;
  const page = (unsigned >>> 16) & 0xff;
  const id = unsigned & 0xffff;
  const baseUsage = ((page << 16) | id) >>> 0;
  const modLabels = MOD_BIT_LABELS.filter(([bit]) => (modMask & bit) !== 0).map(
    ([, label]) => label
  );

  return { page, id, modMask, modLabels, baseUsage };
}

export function encodeHidUsageWithMods(baseUsage: number, modMask: number): number {
  const cleanBase = (baseUsage >>> 0) & 0x00ffffff;
  const cleanMods = (modMask & 0xff) >>> 0;
  return (cleanBase | (cleanMods << 24)) >>> 0;
}

function cleanKeyLabel(raw?: string): string {
  if (!raw) return "";
  return raw.replace(/^Keyboard /, "");
}

export function formatHidUsageShort(usage: number): string {
  if (!usage) return "";
  const decoded = decodeHidUsageWithMods(usage);
  const labels = hid_usage_get_labels(decoded.page, decoded.id);
  const key = cleanKeyLabel(labels.short || labels.med || labels.long);
  if (!key) {
    return decoded.page === 0 ? `${decoded.id}` : `0x${(usage >>> 0).toString(16)}`;
  }
  if (decoded.modLabels.length > 0) {
    return `${decoded.modLabels.join("")}+${key}`;
  }
  return key;
}

export function formatShortBindingSummary(
  binding: BehaviorBinding,
  behaviors: Record<number, GetBehaviorDetailsResponse>,
  layers: Array<{ id: number; name?: string }>
): { primary: string; secondary?: string; header: string } {
  const behavior = behaviors[binding.behaviorId];
  const displayName = behavior?.displayName || `ID #${binding.behaviorId}`;

  if (displayName === "Transparent") {
    return { header: "", primary: "▽" };
  }
  if (displayName === "None") {
    return { header: "", primary: "✕" };
  }
  if (displayName === "Mod-Tap") {
    const hold = formatHidUsageShort(binding.param1);
    const tap = formatHidUsageShort(binding.param2);
    return {
      header: "MT",
      primary: tap || "?",
      secondary: hold ? `Hold ${hold}` : undefined,
    };
  }
  if (displayName === "Layer-Tap") {
    const layer = layers.find((l) => l.id === binding.param1);
    const layerLabel = layer?.name || `L${binding.param1}`;
    const tap = formatHidUsageShort(binding.param2);
    return {
      header: `LT ${layerLabel}`,
      primary: tap || "?",
      secondary: `Hold ${layerLabel}`,
    };
  }
  if (
    displayName === "Momentary Layer" ||
    displayName === "To Layer" ||
    displayName === "Toggle Layer" ||
    displayName === "Sticky Layer"
  ) {
    const layer = layers.find((l) => l.id === binding.param1);
    return {
      header: displayName,
      primary: layer?.name || `L${binding.param1}`,
    };
  }
  if (displayName === "Bluetooth") {
    const btCmds: Record<number, string> = {
      0: "CLR",
      1: "NXT",
      2: "PRV",
      3: `SEL ${binding.param2}`,
      4: "CLR ALL",
      5: `DISC ${binding.param2}`,
    };
    return {
      header: "BT",
      primary: btCmds[binding.param1] ?? `${binding.param1}:${binding.param2}`,
    };
  }
  if (displayName === "Output Selection") {
    const outCmds: Record<number, string> = { 0: "USB", 1: "BLE", 2: "TOG" };
    return {
      header: "OUT",
      primary: outCmds[binding.param1] ?? `${binding.param1}`,
    };
  }
  if (displayName === "Mouse Key Press") {
    const mkp: Record<number, string> = {
      1: "LCLK",
      2: "RCLK",
      4: "MCLK",
      8: "MB4",
      16: "MB5",
    };
    return {
      header: "MKP",
      primary: mkp[binding.param1] ?? `BTN ${binding.param1}`,
    };
  }

  // Zero-argument custom/safety behaviors
  if (binding.param1 === 0 && binding.param2 === 0) {
    return {
      header: "",
      primary: displayName,
    };
  }

  // Standard Key Press / Sticky Key / etc.
  const p1 = formatHidUsageShort(binding.param1);
  const p2 = binding.param2 ? formatHidUsageShort(binding.param2) : undefined;
  return {
    header: displayName,
    primary: p1 || displayName,
    secondary: p2,
  };
}

export function diffKeymapAgainstSnapshot(
  current: Keymap,
  snapshot: StudioSnapshot
): KeymapDiffEntry[] {
  const diffs: KeymapDiffEntry[] = [];

  current.layers.forEach((layer, layerIndex) => {
    const snapLayer =
      snapshot.layers.find((sl) => sl.id === layer.id) ?? snapshot.layers[layerIndex];

    layer.bindings.forEach((binding, keyPosition) => {
      const base = snapLayer?.bindings[keyPosition];
      if (
        !base ||
        base.behavior_id !== binding.behaviorId ||
        base.param1 !== binding.param1 ||
        base.param2 !== binding.param2
      ) {
        diffs.push({
          layerIndex,
          layerId: layer.id,
          layerName: layer.name || `Layer ${layerIndex}`,
          keyPosition,
          current: binding,
          baseline: base
            ? {
                behaviorId: base.behavior_id,
                param1: base.param1,
                param2: base.param2,
              }
            : undefined,
        });
      }
    });
  });

  return diffs;
}

export function formatHex(value?: number): string {
  if (value === undefined) return "0x0";
  return `0x${(value >>> 0).toString(16).toUpperCase()}`;
}
