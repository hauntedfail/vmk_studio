// Firmware repository operations shared by both backends.
//
// The browser build reaches the repository through the dev server's local API
// (scripts/vmk-dev-plugin.ts, Node file system); the desktop build reaches it
// through Tauri commands (src-tauri/src/vmk.rs). Each backend only supplies raw
// file access. What is read, how it is parsed, and which files a change touches
// is decided here, once, so the two builds cannot drift apart.

import {
  parseConfTuning,
  parseCustomBehaviors,
  parseHoldTapTuning,
  parseKeymapLayers,
  parseTrackpadHardware,
  parseTrackpadProcessors,
  updateConfTuning,
  updateHoldTapTuning,
  updateTrackpadHardware,
  updateTrackpadProcessors,
} from "./dtsParser";
import {
  deleteCustomBehaviorNode,
  parseCombos,
  parseConditionalLayers,
  updateRepoKeymapSource,
  upsertCustomBehaviorNode,
} from "./keymapCodec";
import {
  parseCustomCFeatures,
  parseHelperSmoother,
  parseLeftOverlayGates,
  updateCustomCFeatures,
  updateHelperSmoother,
  updateLeftOverlayGates,
} from "./customFirmwareCodec";
import type {
  CustomBehaviorDef,
  EditableRepoFile,
  FirmwareModel,
  FirmwareTuningPatch,
  PhysicalKeyDef,
  RepoKeymapSavePayload,
} from "./types";

/** Files the Source editor offers, in display order. `EDITABLE_FILES` in vmk.rs must list the same paths. */
export const EDITABLE_FILE_DEFS: ReadonlyArray<Pick<EditableRepoFile, "relPath" | "label" | "category">> = [
  { relPath: "config/toucan.keymap", label: "toucan.keymap", category: "keymap" },
  { relPath: "dts/cg_toggle.dtsi", label: "cg_toggle.dtsi", category: "behavior" },
  { relPath: "config/toucan_left.overlay", label: "config/toucan_left.overlay", category: "behavior" },
  { relPath: "config/toucan_right.overlay", label: "config/toucan_right.overlay", category: "behavior" },
  { relPath: "boards/shields/toucan/toucan.dtsi", label: "shields/toucan.dtsi", category: "shield" },
  { relPath: "boards/shields/toucan/toucan_left.overlay", label: "shields/toucan_left.overlay", category: "shield" },
  { relPath: "boards/shields/toucan/toucan_right.overlay", label: "shields/toucan_right.overlay", category: "shield" },
  { relPath: "boards/shields/toucan/toucan_left.conf", label: "toucan_left.conf", category: "config" },
  { relPath: "boards/shields/toucan/toucan_right.conf", label: "toucan_right.conf", category: "config" },
  { relPath: "Kconfig", label: "Kconfig", category: "config" },
  { relPath: "src/cg_toggle.c", label: "src/cg_toggle.c", category: "source" },
  { relPath: "src/cg_zoom.c", label: "src/cg_zoom.c", category: "source" },
  { relPath: "src/cg_nav.c", label: "src/cg_nav.c", category: "source" },
  { relPath: "src/input_processor_double_tap.c", label: "src/input_processor_double_tap.c", category: "source" },
  { relPath: "src/split_input_relay.c", label: "src/split_input_relay.c", category: "source" },
  { relPath: "host/macos/Sources/Core/ZoomSmoother.swift", label: "ZoomSmoother.swift", category: "helper" },
];

/** Repository files whose text makes up a firmware bundle, keyed by bundle field. */
export const BUNDLE_FILES = {
  keymap: "config/toucan.keymap",
  leftOverlay: "boards/shields/toucan/toucan_left.overlay",
  rightOverlay: "boards/shields/toucan/toucan_right.overlay",
  toucanDtsi: "boards/shields/toucan/toucan.dtsi",
  leftConf: "boards/shields/toucan/toucan_left.conf",
  rightConf: "boards/shields/toucan/toucan_right.conf",
  kconfig: "Kconfig",
  cgZoomC: "src/cg_zoom.c",
  cgNavC: "src/cg_nav.c",
  helperSmootherSwift: "host/macos/Sources/Core/ZoomSmoother.swift",
  toucanJson: "config/toucan.json",
} as const;

/** Raw repository contents a backend hands over. A missing file is an empty string. */
export type FirmwareBundle = Record<keyof typeof BUNDLE_FILES, string> & {
  repoPath: string;
  /** `dts/*.dtsi`, sorted by name. */
  dtsFiles: Array<{ relPath: string; content: string }>;
  /** Paths `git status --porcelain` reports. */
  dirtyFiles: string[];
  existingEditable: Array<{ relPath: string; exists: boolean }>;
};

/** File access relative to the firmware repository. `read` rejects when the file is missing. */
export interface RepoFileIo {
  read(relPath: string): Promise<string>;
  write(relPath: string, content: string): Promise<void>;
}

const DEFAULT_BEHAVIOR_FILE = "dts/cg_toggle.dtsi";

export function buildFirmwareModel(bundle: FirmwareBundle): FirmwareModel {
  let physicalLayout: PhysicalKeyDef[] = [];
  if (bundle.toucanJson) {
    try {
      const parsed = JSON.parse(bundle.toucanJson);
      const first = Object.values(parsed.layouts || {})[0] as { layout?: PhysicalKeyDef[] } | undefined;
      if (first?.layout) physicalLayout = first.layout;
    } catch {
      // An unreadable layout file leaves the layout empty.
    }
  }

  const dirty = new Set(bundle.dirtyFiles);
  const existing = new Map(bundle.existingEditable.map((e) => [e.relPath, e.exists]));

  return {
    repoPath: bundle.repoPath,
    customBehaviors: bundle.dtsFiles.flatMap((f) => parseCustomBehaviors(f.content, f.relPath)),
    holdTap: parseHoldTapTuning(bundle.keymap),
    trackpadHardware: parseTrackpadHardware(bundle.rightOverlay),
    trackpadProcessors: parseTrackpadProcessors(bundle.toucanDtsi),
    leftOverlayGates: parseLeftOverlayGates(bundle.leftOverlay),
    customCFeatures: parseCustomCFeatures(bundle.cgZoomC, bundle.cgNavC),
    helperSmoother: parseHelperSmoother(bundle.helperSmootherSwift),
    conf: parseConfTuning(bundle.leftConf, bundle.rightConf, bundle.kconfig),
    physicalLayout,
    repoKeymapLayers: parseKeymapLayers(bundle.keymap),
    conditionalLayers: parseConditionalLayers(bundle.keymap),
    combos: parseCombos(bundle.keymap),
    editableFiles: EDITABLE_FILE_DEFS.map((def) => ({
      ...def,
      exists: existing.get(def.relPath) ?? false,
      modified: dirty.has(def.relPath),
    })),
  };
}

/** Applies a tuning patch and returns the files whose content changed, in the order they were written. */
export async function applyFirmwarePatchFiles(io: RepoFileIo, patch: FirmwareTuningPatch): Promise<string[]> {
  const changedFiles: string[] = [];
  const rewrite = async (relPath: string, update: (prev: string) => string) => {
    const prev = await io.read(relPath);
    const next = update(prev);
    if (next !== prev) {
      await io.write(relPath, next);
      changedFiles.push(relPath);
    }
  };

  if (patch.holdTap) {
    const holdTap = patch.holdTap;
    await rewrite(BUNDLE_FILES.keymap, (prev) => updateHoldTapTuning(prev, holdTap));
  }
  if (patch.trackpadHardware) {
    const hardware = patch.trackpadHardware;
    await rewrite(BUNDLE_FILES.rightOverlay, (prev) => updateTrackpadHardware(prev, hardware));
  }
  if (patch.trackpadProcessors) {
    const processors = patch.trackpadProcessors;
    await rewrite(BUNDLE_FILES.toucanDtsi, (prev) => updateTrackpadProcessors(prev, processors));
  }
  if (patch.leftOverlayGates) {
    const gates = patch.leftOverlayGates;
    await rewrite(BUNDLE_FILES.leftOverlay, (prev) => updateLeftOverlayGates(prev, gates));
  }
  if (patch.customCFeatures) {
    const prevZoom = await io.read(BUNDLE_FILES.cgZoomC);
    const prevNav = await io.read(BUNDLE_FILES.cgNavC);
    const { cgZoomC, cgNavC } = updateCustomCFeatures(prevZoom, prevNav, patch.customCFeatures);
    if (cgZoomC !== prevZoom) {
      await io.write(BUNDLE_FILES.cgZoomC, cgZoomC);
      changedFiles.push(BUNDLE_FILES.cgZoomC);
    }
    if (cgNavC !== prevNav) {
      await io.write(BUNDLE_FILES.cgNavC, cgNavC);
      changedFiles.push(BUNDLE_FILES.cgNavC);
    }
  }
  if (patch.helperSmoother) {
    // The macOS helper is optional: a repository without it skips this part.
    const prev = await io.read(BUNDLE_FILES.helperSmootherSwift).catch(() => null);
    if (prev !== null) {
      const next = updateHelperSmoother(prev, patch.helperSmoother);
      if (next !== prev) {
        await io.write(BUNDLE_FILES.helperSmootherSwift, next);
        changedFiles.push(BUNDLE_FILES.helperSmootherSwift);
      }
    }
  }
  if (patch.conf) {
    const prevLeft = await io.read(BUNDLE_FILES.leftConf);
    const prevRight = await io.read(BUNDLE_FILES.rightConf);
    const { leftConf, rightConf } = updateConfTuning(prevLeft, prevRight, patch.conf);
    if (leftConf !== prevLeft) {
      await io.write(BUNDLE_FILES.leftConf, leftConf);
      changedFiles.push(BUNDLE_FILES.leftConf);
    }
    if (rightConf !== prevRight) {
      await io.write(BUNDLE_FILES.rightConf, rightConf);
      changedFiles.push(BUNDLE_FILES.rightConf);
    }
  }
  return changedFiles;
}

export async function saveRepoKeymapFile(io: RepoFileIo, payload: RepoKeymapSavePayload): Promise<void> {
  const prev = await io.read(BUNDLE_FILES.keymap);
  const next = updateRepoKeymapSource(prev, payload);
  if (next !== prev) {
    await io.write(BUNDLE_FILES.keymap, next);
  }
}

/** Adds or replaces a behavior node. The source file is created when it does not exist yet. */
export async function upsertCustomBehaviorFile(io: RepoFileIo, behavior: CustomBehaviorDef): Promise<void> {
  const relPath = behavior.sourceFile || DEFAULT_BEHAVIOR_FILE;
  const prev = await io.read(relPath).catch(() => "");
  await io.write(relPath, upsertCustomBehaviorNode(prev, behavior));
}

export async function deleteCustomBehaviorFile(io: RepoFileIo, sourceFile: string, label: string): Promise<void> {
  const relPath = sourceFile || DEFAULT_BEHAVIOR_FILE;
  const prev = await io.read(relPath);
  await io.write(relPath, deleteCustomBehaviorNode(prev, label));
}
