import { invoke } from "@tauri-apps/api/core";
import type {
  CommandJob,
  CustomBehaviorDef,
  EditableRepoFile,
  FirmwareModel,
  FirmwareTuningPatch,
  JobKind,
  RepoKeymapSavePayload,
  SnapshotSummary,
  StudioSnapshot,
  VmkWorkspacePaths,
  VmkWorkspaceStatus,
} from "./types";

const STORAGE_KEY = "vmk_studio_workspace_paths_v1";

export function loadSavedWorkspacePaths(): Partial<VmkWorkspacePaths> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<VmkWorkspacePaths>) : {};
  } catch {
    return {};
  }
}

export function saveWorkspacePaths(paths: Partial<VmkWorkspacePaths>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(paths));
  } catch {
    // ignore storage quota errors
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

async function postApi<T>(endpoint: string, body: unknown): Promise<T> {
  const resp = await fetch(`/api/vmk/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data.error || `VMK API error (${resp.status}) on ${endpoint}`);
  }
  return data as T;
}

export async function getWorkspaceStatus(
  paths?: Partial<VmkWorkspacePaths>
): Promise<VmkWorkspaceStatus> {
  if (isTauriRuntime()) {
    return invoke<VmkWorkspaceStatus>("vmk_get_workspace_status", {
      paths: paths ?? {},
    });
  }
  return postApi<VmkWorkspaceStatus>("status", paths ?? {});
}

export async function getFirmwareModel(repoPath?: string): Promise<FirmwareModel> {
  if (isTauriRuntime()) {
    const files = await invoke<{
      repoPath: string;
      keymap: string;
      leftOverlay: string;
      rightOverlay: string;
      toucanDtsi: string;
      leftConf: string;
      rightConf: string;
      kconfig: string;
      cgZoomC: string;
      cgNavC: string;
      helperSmootherSwift: string;
      toucanJson: string;
      dtsFiles: Array<{ relPath: string; content: string }>;
      dirtyFiles: string[];
      existingEditable: Array<{ relPath: string; exists: boolean }>;
    }>("vmk_read_firmware_bundle", { repoPath: repoPath ?? "" });

    const [
      {
        parseConfTuning,
        parseCustomBehaviors,
        parseHoldTapTuning,
        parseKeymapLayers,
        parseTrackpadHardware,
        parseTrackpadProcessors,
      },
      { parseCombos, parseConditionalLayers },
      { parseCustomCFeatures, parseHelperSmoother, parseLeftOverlayGates },
    ] = await Promise.all([
      import("./dtsParser"),
      import("./keymapCodec"),
      import("./customFirmwareCodec"),
    ]);

    const customBehaviors = files.dtsFiles.flatMap((f) =>
      parseCustomBehaviors(f.content, f.relPath)
    );
    let physicalLayout: FirmwareModel["physicalLayout"] = [];
    if (files.toucanJson) {
      try {
        const parsed = JSON.parse(files.toucanJson);
        const first = Object.values(parsed.layouts || {})[0] as
          | { layout?: FirmwareModel["physicalLayout"] }
          | undefined;
        if (first?.layout) physicalLayout = first.layout;
      } catch {
        // ignore
      }
    }

    const dirtySet = new Set(files.dirtyFiles);
    const categories: Record<
      string,
      { label: string; category: EditableRepoFile["category"] }
    > = {
      "config/toucan.keymap": { label: "toucan.keymap", category: "keymap" },
      "dts/cg_toggle.dtsi": { label: "cg_toggle.dtsi", category: "behavior" },
      "config/toucan_left.overlay": { label: "config/toucan_left.overlay", category: "behavior" },
      "config/toucan_right.overlay": { label: "config/toucan_right.overlay", category: "behavior" },
      "boards/shields/toucan/toucan.dtsi": { label: "shields/toucan.dtsi", category: "shield" },
      "boards/shields/toucan/toucan_left.overlay": { label: "shields/toucan_left.overlay", category: "shield" },
      "boards/shields/toucan/toucan_right.overlay": { label: "shields/toucan_right.overlay", category: "shield" },
      "boards/shields/toucan/toucan_left.conf": { label: "toucan_left.conf", category: "config" },
      "boards/shields/toucan/toucan_right.conf": { label: "toucan_right.conf", category: "config" },
      Kconfig: { label: "Kconfig", category: "config" },
      "src/cg_toggle.c": { label: "src/cg_toggle.c", category: "source" },
      "src/cg_zoom.c": { label: "src/cg_zoom.c", category: "source" },
      "src/cg_nav.c": { label: "src/cg_nav.c", category: "source" },
      "src/input_processor_double_tap.c": { label: "src/input_processor_double_tap.c", category: "source" },
      "src/split_input_relay.c": { label: "src/split_input_relay.c", category: "source" },
      "host/macos/Sources/Core/ZoomSmoother.swift": { label: "ZoomSmoother.swift", category: "helper" },
    };

    return {
      repoPath: files.repoPath,
      customBehaviors,
      holdTap: parseHoldTapTuning(files.keymap),
      trackpadHardware: parseTrackpadHardware(files.rightOverlay),
      trackpadProcessors: parseTrackpadProcessors(files.toucanDtsi),
      leftOverlayGates: parseLeftOverlayGates(files.leftOverlay),
      customCFeatures: parseCustomCFeatures(files.cgZoomC, files.cgNavC),
      helperSmoother: parseHelperSmoother(files.helperSmootherSwift),
      conf: parseConfTuning(files.leftConf, files.rightConf, files.kconfig),
      physicalLayout,
      repoKeymapLayers: parseKeymapLayers(files.keymap),
      conditionalLayers: parseConditionalLayers(files.keymap),
      combos: parseCombos(files.keymap),
      editableFiles: files.existingEditable.map((e) => ({
        relPath: e.relPath,
        label: categories[e.relPath]?.label || e.relPath,
        category: categories[e.relPath]?.category || "config",
        exists: e.exists,
        modified: dirtySet.has(e.relPath),
      })),
    };
  }

  return postApi<FirmwareModel>("firmware-model", { repoPath });
}

export async function applyFirmwarePatch(
  repoPath: string,
  patch: FirmwareTuningPatch
): Promise<{ changedFiles: string[]; model: FirmwareModel }> {
  if (isTauriRuntime()) {
    const [
      {
        updateConfTuning,
        updateHoldTapTuning,
        updateTrackpadHardware,
        updateTrackpadProcessors,
      },
      { updateCustomCFeatures, updateHelperSmoother, updateLeftOverlayGates },
    ] = await Promise.all([
      import("./dtsParser"),
      import("./customFirmwareCodec"),
    ]);

    const changedFiles: string[] = [];
    if (patch.holdTap) {
      const rel = "config/toucan.keymap";
      const prev = await readRepoFile(repoPath, rel);
      const next = updateHoldTapTuning(prev, patch.holdTap);
      if (next !== prev) {
        await writeRepoFile(repoPath, rel, next);
        changedFiles.push(rel);
      }
    }
    if (patch.trackpadHardware) {
      const rel = "boards/shields/toucan/toucan_right.overlay";
      const prev = await readRepoFile(repoPath, rel);
      const next = updateTrackpadHardware(prev, patch.trackpadHardware);
      if (next !== prev) {
        await writeRepoFile(repoPath, rel, next);
        changedFiles.push(rel);
      }
    }
    if (patch.trackpadProcessors) {
      const rel = "boards/shields/toucan/toucan.dtsi";
      const prev = await readRepoFile(repoPath, rel);
      const next = updateTrackpadProcessors(prev, patch.trackpadProcessors);
      if (next !== prev) {
        await writeRepoFile(repoPath, rel, next);
        changedFiles.push(rel);
      }
    }
    if (patch.leftOverlayGates) {
      const rel = "boards/shields/toucan/toucan_left.overlay";
      const prev = await readRepoFile(repoPath, rel);
      const next = updateLeftOverlayGates(prev, patch.leftOverlayGates);
      if (next !== prev) {
        await writeRepoFile(repoPath, rel, next);
        changedFiles.push(rel);
      }
    }
    if (patch.customCFeatures) {
      const zoomRel = "src/cg_zoom.c";
      const navRel = "src/cg_nav.c";
      const prevZoom = await readRepoFile(repoPath, zoomRel);
      const prevNav = await readRepoFile(repoPath, navRel);
      const { cgZoomC, cgNavC } = updateCustomCFeatures(
        prevZoom,
        prevNav,
        patch.customCFeatures
      );
      if (cgZoomC !== prevZoom) {
        await writeRepoFile(repoPath, zoomRel, cgZoomC);
        changedFiles.push(zoomRel);
      }
      if (cgNavC !== prevNav) {
        await writeRepoFile(repoPath, navRel, cgNavC);
        changedFiles.push(navRel);
      }
    }
    if (patch.helperSmoother) {
      const rel = "host/macos/Sources/Core/ZoomSmoother.swift";
      try {
        const prev = await readRepoFile(repoPath, rel);
        const next = updateHelperSmoother(prev, patch.helperSmoother);
        if (next !== prev) {
          await writeRepoFile(repoPath, rel, next);
          changedFiles.push(rel);
        }
      } catch {
        // helper file optional
      }
    }
    if (patch.conf) {
      const lRel = "boards/shields/toucan/toucan_left.conf";
      const rRel = "boards/shields/toucan/toucan_right.conf";
      const prevL = await readRepoFile(repoPath, lRel);
      const prevR = await readRepoFile(repoPath, rRel);
      const { leftConf, rightConf } = updateConfTuning(prevL, prevR, patch.conf);
      if (leftConf !== prevL) {
        await writeRepoFile(repoPath, lRel, leftConf);
        changedFiles.push(lRel);
      }
      if (rightConf !== prevR) {
        await writeRepoFile(repoPath, rRel, rightConf);
        changedFiles.push(rRel);
      }
    }
    return { changedFiles, model: await getFirmwareModel(repoPath) };
  }

  return postApi<{ changedFiles: string[]; model: FirmwareModel }>("apply-patch", {
    repoPath,
    patch,
  });
}

export async function saveRepoKeymap(
  repoPath: string,
  payload: RepoKeymapSavePayload
): Promise<FirmwareModel> {
  if (isTauriRuntime()) {
    const { updateRepoKeymapSource } = await import("./keymapCodec");
    const rel = "config/toucan.keymap";
    const prev = await readRepoFile(repoPath, rel);
    const next = updateRepoKeymapSource(prev, payload);
    if (next !== prev) {
      await writeRepoFile(repoPath, rel, next);
    }
    return getFirmwareModel(repoPath);
  }
  const data = await postApi<{ model: FirmwareModel }>("keymap/save", {
    repoPath,
    payload,
  });
  return data.model;
}

export async function upsertCustomBehavior(
  repoPath: string,
  behavior: CustomBehaviorDef
): Promise<FirmwareModel> {
  if (isTauriRuntime()) {
    const { upsertCustomBehaviorNode } = await import("./keymapCodec");
    const rel = behavior.sourceFile || "dts/cg_toggle.dtsi";
    const prev = await readRepoFile(repoPath, rel).catch(() => "");
    const next = upsertCustomBehaviorNode(prev, behavior);
    await writeRepoFile(repoPath, rel, next);
    return getFirmwareModel(repoPath);
  }
  const data = await postApi<{ model: FirmwareModel }>("behaviors/upsert", {
    repoPath,
    behavior,
  });
  return data.model;
}

export async function deleteCustomBehavior(
  repoPath: string,
  sourceFile: string,
  label: string
): Promise<FirmwareModel> {
  if (isTauriRuntime()) {
    const { deleteCustomBehaviorNode } = await import("./keymapCodec");
    const rel = sourceFile || "dts/cg_toggle.dtsi";
    const prev = await readRepoFile(repoPath, rel);
    const next = deleteCustomBehaviorNode(prev, label);
    await writeRepoFile(repoPath, rel, next);
    return getFirmwareModel(repoPath);
  }
  const data = await postApi<{ model: FirmwareModel }>("behaviors/delete", {
    repoPath,
    sourceFile,
    label,
  });
  return data.model;
}

export async function readRepoFile(repoPath: string, relPath: string): Promise<string> {
  if (isTauriRuntime()) {
    return invoke<string>("vmk_read_repo_file", { repoPath, relPath });
  }
  const data = await postApi<{ content: string }>("read-file", { repoPath, relPath });
  return data.content;
}

export async function writeRepoFile(
  repoPath: string,
  relPath: string,
  content: string
): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("vmk_write_repo_file", { repoPath, relPath, content });
    return;
  }
  await postApi("write-file", { repoPath, relPath, content });
}

export async function getGitDiff(repoPath: string, relPath?: string): Promise<string> {
  if (isTauriRuntime()) {
    return invoke<string>("vmk_git_diff", { repoPath, relPath: relPath ?? null });
  }
  const data = await postApi<{ diff: string }>("git-diff", { repoPath, relPath });
  return data.diff;
}

export async function revertRepoFile(repoPath: string, relPath: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("vmk_revert_repo_file", { repoPath, relPath });
    return;
  }
  await postApi("revert-file", { repoPath, relPath });
}

export async function listSnapshots(backupsDir?: string): Promise<SnapshotSummary[]> {
  if (isTauriRuntime()) {
    return invoke<SnapshotSummary[]>("vmk_list_snapshots", {
      backupsDir: backupsDir ?? "",
    });
  }
  const data = await postApi<{ snapshots: SnapshotSummary[] }>("snapshots/list", {
    backupsDir,
  });
  return data.snapshots;
}

export async function readSnapshot(
  relPath: string,
  backupsDir?: string
): Promise<StudioSnapshot> {
  if (isTauriRuntime()) {
    return invoke<StudioSnapshot>("vmk_read_snapshot", {
      backupsDir: backupsDir ?? "",
      relPath,
    });
  }
  const data = await postApi<{ snapshot: StudioSnapshot }>("snapshots/read", {
    backupsDir,
    relPath,
  });
  return data.snapshot;
}

export async function saveSnapshot(
  name: string,
  snapshot: StudioSnapshot,
  backupsDir?: string
): Promise<SnapshotSummary> {
  if (isTauriRuntime()) {
    return invoke<SnapshotSummary>("vmk_save_snapshot", {
      backupsDir: backupsDir ?? "",
      name,
      snapshot,
    });
  }
  const data = await postApi<{ summary: SnapshotSummary }>("snapshots/save", {
    backupsDir,
    name,
    snapshot,
  });
  return data.summary;
}

export async function startCommandJob(options: {
  kind: JobKind;
  scriptName?: string;
  paths?: Partial<VmkWorkspacePaths>;
  waitSeconds?: number;
}): Promise<CommandJob> {
  if (isTauriRuntime()) {
    return invoke<CommandJob>("vmk_start_job", { options });
  }
  const data = await postApi<{ job: CommandJob }>("jobs/start", options);
  return data.job;
}

export async function getJobStatus(id: string): Promise<CommandJob> {
  if (isTauriRuntime()) {
    return invoke<CommandJob>("vmk_get_job_status", { id });
  }
  const data = await postApi<{ job: CommandJob }>("jobs/status", { id });
  return data.job;
}

export async function cancelCommandJob(id: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("vmk_cancel_job", { id });
    return;
  }
  await postApi("jobs/cancel", { id });
}
