import { invoke } from "@tauri-apps/api/core";
import type { FirmwareBundle, RepoFileIo } from "./firmwareOps";
import type {
  CommandJob,
  CustomBehaviorDef,
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

/** File access through the Tauri commands, confined to the repository by `safe_join` in vmk.rs. */
function tauriRepoIo(repoPath: string): RepoFileIo {
  return {
    read: (relPath) => readRepoFile(repoPath, relPath),
    write: (relPath, content) => writeRepoFile(repoPath, relPath, content),
  };
}

export async function getFirmwareModel(repoPath?: string): Promise<FirmwareModel> {
  if (isTauriRuntime()) {
    const [bundle, { buildFirmwareModel }] = await Promise.all([
      invoke<FirmwareBundle>("vmk_read_firmware_bundle", { repoPath: repoPath ?? "" }),
      import("./firmwareOps"),
    ]);
    return buildFirmwareModel(bundle);
  }

  return postApi<FirmwareModel>("firmware-model", { repoPath });
}

export async function applyFirmwarePatch(
  repoPath: string,
  patch: FirmwareTuningPatch
): Promise<{ changedFiles: string[]; model: FirmwareModel }> {
  if (isTauriRuntime()) {
    const { applyFirmwarePatchFiles } = await import("./firmwareOps");
    const changedFiles = await applyFirmwarePatchFiles(tauriRepoIo(repoPath), patch);
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
    const { saveRepoKeymapFile } = await import("./firmwareOps");
    await saveRepoKeymapFile(tauriRepoIo(repoPath), payload);
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
    const { upsertCustomBehaviorFile } = await import("./firmwareOps");
    await upsertCustomBehaviorFile(tauriRepoIo(repoPath), behavior);
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
    const { deleteCustomBehaviorFile } = await import("./firmwareOps");
    await deleteCustomBehaviorFile(tauriRepoIo(repoPath), sourceFile, label);
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
