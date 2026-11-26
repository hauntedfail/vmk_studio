import type { Plugin, ViteDevServer } from "vite";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import type { IncomingMessage, ServerResponse } from "node:http";
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
} from "../src/vmk/dtsParser";
import {
  deleteCustomBehaviorNode,
  parseCombos,
  parseConditionalLayers,
  updateRepoKeymapSource,
  upsertCustomBehaviorNode,
} from "../src/vmk/keymapCodec";
import {
  parseCustomCFeatures,
  parseHelperSmoother,
  parseLeftOverlayGates,
  updateCustomCFeatures,
  updateHelperSmoother,
  updateLeftOverlayGates,
} from "../src/vmk/customFirmwareCodec";
import type {
  BootloaderStatus,
  BuiltArtifactInfo,
  CommandJob,
  CustomBehaviorDef,
  EditableRepoFile,
  FirmwareModel,
  FirmwareTuningPatch,
  JobKind,
  PhysicalKeyDef,
  RepoKeymapSavePayload,
  SnapshotSummary,
  StudioSnapshot,
  VmkWorkspacePaths,
  VmkWorkspaceStatus,
} from "../src/vmk/types";

const execFileAsync = promisify(execFile);

const LEFT_MARKERS = [
  "Studio Unlock",
  "studio_rpc_thread",
  "usbworkq",
  "HID Over GATT Send Work",
];

const EDITABLE_FILE_DEFS: Array<{
  relPath: string;
  label: string;
  category: EditableRepoFile["category"];
}> = [
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

export function defaultWorkspacePaths(): VmkWorkspacePaths {
  const home = os.homedir();
  return {
    firmwareRepoPath: path.join(
      home,
      "Documents",
      "deepseek-harness",
      "default-workspace",
      "toucan2-cg-toggle"
    ),
    zmkAppPath: path.join(home, "toucan2-zmk-build", "build-ws", "zmk", "app"),
    westPath: path.join(home, "toucan2-zmk-build", ".venv", "bin", "west"),
    backupsDir: path.join(home, ".local", "share", "toucan2", "backups"),
    toolsDir: path.join(home, ".local", "share", "toucan2", "tools"),
  };
}

function mergePaths(partial?: Partial<VmkWorkspacePaths>): VmkWorkspacePaths {
  const defs = defaultWorkspacePaths();
  return {
    firmwareRepoPath: partial?.firmwareRepoPath?.trim() || defs.firmwareRepoPath,
    zmkAppPath: partial?.zmkAppPath?.trim() || defs.zmkAppPath,
    westPath: partial?.westPath?.trim() || defs.westPath,
    backupsDir: partial?.backupsDir?.trim() || defs.backupsDir,
    toolsDir: partial?.toolsDir?.trim() || defs.toolsDir,
  };
}

export function assertInside(rootDir: string, relPath: string): string {
  const resolvedRoot = path.resolve(rootDir);
  const resolved = path.resolve(resolvedRoot, relPath);
  if (
    resolved !== resolvedRoot &&
    !resolved.startsWith(resolvedRoot + path.sep)
  ) {
    throw new Error(`Path escapes workspace root: ${relPath}`);
  }
  const normalizedRel = path.relative(resolvedRoot, resolved);
  if (normalizedRel === ".git" || normalizedRel.startsWith(`.git${path.sep}`)) {
    throw new Error("Modifying .git internals is not permitted.");
  }
  return resolved;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(p: string): Promise<string> {
  const buf = await fsp.readFile(p);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export async function inspectArtifact(
  repoPath: string,
  name: string,
  half: "left" | "right"
): Promise<BuiltArtifactInfo> {
  const uf2Path = path.join(repoPath, "dist", `${name}.uf2`);
  const shaPath = `${uf2Path}.sha256`;
  const exists = await fileExists(uf2Path);
  if (!exists) {
    return { name, half, path: uf2Path, exists: false };
  }
  const stat = await fsp.stat(uf2Path);
  const sha256 = await sha256File(uf2Path);
  let expectedSha256: string | undefined;
  if (await fileExists(shaPath)) {
    const raw = (await fsp.readFile(shaPath, "utf8")).trim();
    expectedSha256 = raw.split(/\s+/)[0];
  }
  return {
    name,
    half,
    path: uf2Path,
    exists: true,
    bytes: stat.size,
    sha256,
    expectedSha256,
    checksumMatches: expectedSha256 ? expectedSha256 === sha256 : undefined,
    mtimeIso: stat.mtime.toISOString(),
  };
}

export function scanUf2CentralMarkers(raw: Buffer): {
  detectedHalf: BootloaderStatus["detectedHalf"];
  detectedMarkers: string[];
} {
  // Extract UF2 payloads to match strings cleanly across block boundaries
  const chunks: Buffer[] = [];
  for (let off = 0; off + 512 <= raw.length; off += 512) {
    const m0 = raw.readUInt32LE(off);
    const m1 = raw.readUInt32LE(off + 4);
    const payloadSize = raw.readUInt32LE(off + 16);
    if (m0 === 0x0a324655 && m1 === 0x9e5d5157 && payloadSize <= 476) {
      chunks.push(raw.subarray(off + 32, off + 32 + payloadSize));
    }
  }
  const flat = Buffer.concat(chunks);
  const detectedMarkers: string[] = [];
  for (const marker of LEFT_MARKERS) {
    if (flat.includes(Buffer.from(marker, "utf8"))) {
      detectedMarkers.push(marker);
    }
  }
  return {
    detectedHalf: detectedMarkers.length > 0 ? "left" : "right_or_other",
    detectedMarkers,
  };
}

export async function inspectBootloaderAt(volumePath: string): Promise<BootloaderStatus> {
  const mounted = await fileExists(volumePath);
  if (!mounted) {
    return {
      mounted: false,
      volumePath,
      isXiaoNrf52840: false,
      detectedHalf: "unknown",
      detectedMarkers: [],
    };
  }

  let boardId: string | undefined;
  let isXiaoNrf52840 = false;
  const infoPath = path.join(volumePath, "INFO_UF2.TXT");
  if (await fileExists(infoPath)) {
    try {
      const info = await fsp.readFile(infoPath, "utf8");
      const m = info.match(/Board-ID:\s*(.+)/);
      boardId = m?.[1]?.trim();
      isXiaoNrf52840 = info.includes("Board-ID: nRF52840-SeeedXiao");
    } catch {
      // ignore read errors on transient unmount
    }
  }

  let detectedMarkers: string[] = [];
  let detectedHalf: BootloaderStatus["detectedHalf"] = "unknown";
  const currentUf2 = path.join(volumePath, "CURRENT.UF2");
  if (await fileExists(currentUf2)) {
    try {
      const raw = await fsp.readFile(currentUf2);
      const scanned = scanUf2CentralMarkers(raw);
      detectedMarkers = scanned.detectedMarkers;
      detectedHalf = scanned.detectedHalf;
    } catch {
      detectedHalf = "unknown";
    }
  }

  return {
    mounted: true,
    volumePath,
    boardId,
    isXiaoNrf52840,
    detectedHalf,
    detectedMarkers,
  };
}

async function inspectBootloader(): Promise<BootloaderStatus> {
  const volumePath = process.env.TOUCAN_BOOT_VOLUME || "/Volumes/XIAO-BOOT";
  return inspectBootloaderAt(volumePath);
}

async function listUsbProducts(): Promise<string[]> {
  if (process.platform !== "darwin") return [];
  try {
    const { stdout } = await execFileAsync("ioreg", ["-p", "IOUSB", "-l", "-w", "0"], {
      maxBuffer: 8 * 1024 * 1024,
    });
    const products: string[] = [];
    for (const line of stdout.split("\n")) {
      if (line.includes('"USB Product Name"')) {
        const val = line.split("=", 2)[1]?.trim().replace(/^"|"$/g, "");
        if (val) products.push(val);
      }
    }
    return products;
  } catch {
    return [];
  }
}

async function checkHelperStatus(): Promise<{ installed: boolean; running: boolean }> {
  const home = os.homedir();
  const appPath = path.join(home, "Applications", "Toucan 2 Helper.app");
  const installed = await fileExists(appPath);
  let running = false;
  try {
    await execFileAsync("pgrep", ["-f", "Toucan 2 Helper"]);
    running = true;
  } catch {
    running = false;
  }
  return { installed, running };
}

async function getWorkspaceStatus(
  partial?: Partial<VmkWorkspacePaths>
): Promise<VmkWorkspaceStatus> {
  const paths = mergePaths(partial);
  const repoExists = await fileExists(paths.firmwareRepoPath);
  const zmkAppExists = await fileExists(path.join(paths.zmkAppPath, "west.yml"));
  const westExists = await fileExists(paths.westPath);

  let gitBranch: string | undefined;
  let gitHead: string | undefined;
  let gitTag: string | undefined;
  let dirtyFiles: string[] = [];
  let availableScripts: string[] = [];

  if (repoExists) {
    try {
      const [branchOut, headOut, statusOut] = await Promise.all([
        execFileAsync("git", ["-C", paths.firmwareRepoPath, "rev-parse", "--abbrev-ref", "HEAD"]),
        execFileAsync("git", ["-C", paths.firmwareRepoPath, "rev-parse", "--short", "HEAD"]),
        execFileAsync("git", ["-C", paths.firmwareRepoPath, "status", "--porcelain"]),
      ]);
      gitBranch = branchOut.stdout.trim();
      gitHead = headOut.stdout.trim();
      dirtyFiles = statusOut.stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    } catch {
      // repo may not be a git repo
    }

    try {
      const tagOut = await execFileAsync("git", [
        "-C",
        paths.firmwareRepoPath,
        "describe",
        "--tags",
        "--abbrev=0",
      ]);
      gitTag = tagOut.stdout.trim();
    } catch {
      // no tags
    }

    const scriptsDir = path.join(paths.firmwareRepoPath, "scripts");
    if (await fileExists(scriptsDir)) {
      const entries = await fsp.readdir(scriptsDir);
      availableScripts = entries.filter((e) => e.endsWith(".sh")).sort();
    }
  }

  const [left, right, bootloader, usbProducts, helper] = await Promise.all([
    inspectArtifact(paths.firmwareRepoPath, "toucan_left_zg_studio", "left"),
    inspectArtifact(paths.firmwareRepoPath, "toucan_right", "right"),
    inspectBootloader(),
    listUsbProducts(),
    checkHelperStatus(),
  ]);

  return {
    paths,
    repoExists,
    zmkAppExists,
    westExists,
    gitBranch,
    gitHead,
    gitTag,
    dirtyFiles,
    artifacts: { left, right },
    bootloader,
    usbKeyboardConnected: usbProducts.some((p) => p.toLowerCase().includes("toucan")),
    usbProducts,
    helperInstalled: helper.installed,
    helperRunning: helper.running,
    availableScripts,
  };
}

async function readTextIfExists(p: string): Promise<string> {
  try {
    return await fsp.readFile(p, "utf8");
  } catch {
    return "";
  }
}

export async function readFirmwareModel(repoPath: string): Promise<FirmwareModel> {
  const keymapContent = await readTextIfExists(path.join(repoPath, "config/toucan.keymap"));
  const leftOverlay = await readTextIfExists(
    path.join(repoPath, "boards/shields/toucan/toucan_left.overlay")
  );
  const rightOverlay = await readTextIfExists(
    path.join(repoPath, "boards/shields/toucan/toucan_right.overlay")
  );
  const toucanDtsi = await readTextIfExists(
    path.join(repoPath, "boards/shields/toucan/toucan.dtsi")
  );
  const leftConf = await readTextIfExists(
    path.join(repoPath, "boards/shields/toucan/toucan_left.conf")
  );
  const rightConf = await readTextIfExists(
    path.join(repoPath, "boards/shields/toucan/toucan_right.conf")
  );
  const kconfig = await readTextIfExists(path.join(repoPath, "Kconfig"));
  const cgZoomC = await readTextIfExists(path.join(repoPath, "src/cg_zoom.c"));
  const cgNavC = await readTextIfExists(path.join(repoPath, "src/cg_nav.c"));
  const smootherSwift = await readTextIfExists(
    path.join(repoPath, "host/macos/Sources/Core/ZoomSmoother.swift")
  );

  // Scan dts/*.dtsi for custom behaviors
  const customBehaviors = [];
  const dtsDir = path.join(repoPath, "dts");
  if (await fileExists(dtsDir)) {
    const entries = await fsp.readdir(dtsDir);
    for (const file of entries.filter((f) => f.endsWith(".dtsi")).sort()) {
      const content = await readTextIfExists(path.join(dtsDir, file));
      customBehaviors.push(...parseCustomBehaviors(content, `dts/${file}`));
    }
  }

  // Parse physical layout from config/toucan.json
  let physicalLayout: PhysicalKeyDef[] = [];
  const jsonRaw = await readTextIfExists(path.join(repoPath, "config/toucan.json"));
  if (jsonRaw) {
    try {
      const parsed = JSON.parse(jsonRaw);
      const firstLayout = Object.values(parsed.layouts || {})[0] as
        | { layout?: PhysicalKeyDef[] }
        | undefined;
      if (firstLayout?.layout) {
        physicalLayout = firstLayout.layout;
      }
    } catch {
      // ignore invalid json
    }
  }

  const dirtySet = new Set<string>();
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoPath, "status", "--porcelain"]);
    for (const line of stdout.split("\n")) {
      const rel = line.slice(3).trim();
      if (rel) dirtySet.add(rel);
    }
  } catch {
    // ignore
  }

  const editableFiles: EditableRepoFile[] = await Promise.all(
    EDITABLE_FILE_DEFS.map(async (f) => ({
      ...f,
      exists: await fileExists(path.join(repoPath, f.relPath)),
      modified: dirtySet.has(f.relPath),
    }))
  );

  return {
    repoPath,
    customBehaviors,
    holdTap: parseHoldTapTuning(keymapContent),
    trackpadHardware: parseTrackpadHardware(rightOverlay),
    trackpadProcessors: parseTrackpadProcessors(toucanDtsi),
    leftOverlayGates: parseLeftOverlayGates(leftOverlay),
    customCFeatures: parseCustomCFeatures(cgZoomC, cgNavC),
    helperSmoother: parseHelperSmoother(smootherSwift),
    conf: parseConfTuning(leftConf, rightConf, kconfig),
    physicalLayout,
    repoKeymapLayers: parseKeymapLayers(keymapContent),
    conditionalLayers: parseConditionalLayers(keymapContent),
    combos: parseCombos(keymapContent),
    editableFiles,
  };
}

export async function applyFirmwarePatch(
  repoPath: string,
  patch: FirmwareTuningPatch
): Promise<{ changedFiles: string[]; model: FirmwareModel }> {
  const changedFiles: string[] = [];

  if (patch.holdTap) {
    const rel = "config/toucan.keymap";
    const full = assertInside(repoPath, rel);
    const prev = await fsp.readFile(full, "utf8");
    const next = updateHoldTapTuning(prev, patch.holdTap);
    if (next !== prev) {
      await fsp.writeFile(full, next, "utf8");
      changedFiles.push(rel);
    }
  }

  if (patch.trackpadHardware) {
    const rel = "boards/shields/toucan/toucan_right.overlay";
    const full = assertInside(repoPath, rel);
    const prev = await fsp.readFile(full, "utf8");
    const next = updateTrackpadHardware(prev, patch.trackpadHardware);
    if (next !== prev) {
      await fsp.writeFile(full, next, "utf8");
      changedFiles.push(rel);
    }
  }

  if (patch.trackpadProcessors) {
    const rel = "boards/shields/toucan/toucan.dtsi";
    const full = assertInside(repoPath, rel);
    const prev = await fsp.readFile(full, "utf8");
    const next = updateTrackpadProcessors(prev, patch.trackpadProcessors);
    if (next !== prev) {
      await fsp.writeFile(full, next, "utf8");
      changedFiles.push(rel);
    }
  }

  if (patch.leftOverlayGates) {
    const rel = "boards/shields/toucan/toucan_left.overlay";
    const full = assertInside(repoPath, rel);
    const prev = await fsp.readFile(full, "utf8");
    const next = updateLeftOverlayGates(prev, patch.leftOverlayGates);
    if (next !== prev) {
      await fsp.writeFile(full, next, "utf8");
      changedFiles.push(rel);
    }
  }

  if (patch.customCFeatures) {
    const zoomRel = "src/cg_zoom.c";
    const navRel = "src/cg_nav.c";
    const zoomFull = assertInside(repoPath, zoomRel);
    const navFull = assertInside(repoPath, navRel);
    const prevZoom = await fsp.readFile(zoomFull, "utf8");
    const prevNav = await fsp.readFile(navFull, "utf8");
    const { cgZoomC, cgNavC } = updateCustomCFeatures(
      prevZoom,
      prevNav,
      patch.customCFeatures
    );
    if (cgZoomC !== prevZoom) {
      await fsp.writeFile(zoomFull, cgZoomC, "utf8");
      changedFiles.push(zoomRel);
    }
    if (cgNavC !== prevNav) {
      await fsp.writeFile(navFull, cgNavC, "utf8");
      changedFiles.push(navRel);
    }
  }

  if (patch.helperSmoother) {
    const rel = "host/macos/Sources/Core/ZoomSmoother.swift";
    const full = assertInside(repoPath, rel);
    if (await fileExists(full)) {
      const prev = await fsp.readFile(full, "utf8");
      const next = updateHelperSmoother(prev, patch.helperSmoother);
      if (next !== prev) {
        await fsp.writeFile(full, next, "utf8");
        changedFiles.push(rel);
      }
    }
  }

  if (patch.conf) {
    const leftRel = "boards/shields/toucan/toucan_left.conf";
    const rightRel = "boards/shields/toucan/toucan_right.conf";
    const leftFull = assertInside(repoPath, leftRel);
    const rightFull = assertInside(repoPath, rightRel);
    const prevLeft = await fsp.readFile(leftFull, "utf8");
    const prevRight = await fsp.readFile(rightFull, "utf8");
    const { leftConf, rightConf } = updateConfTuning(prevLeft, prevRight, patch.conf);
    if (leftConf !== prevLeft) {
      await fsp.writeFile(leftFull, leftConf, "utf8");
      changedFiles.push(leftRel);
    }
    if (rightConf !== prevRight) {
      await fsp.writeFile(rightFull, rightConf, "utf8");
      changedFiles.push(rightRel);
    }
  }

  return { changedFiles, model: await readFirmwareModel(repoPath) };
}

export async function listSnapshots(backupsDir: string): Promise<SnapshotSummary[]> {
  if (!(await fileExists(backupsDir))) return [];
  const results: SnapshotSummary[] = [];

  async function walk(dir: string, depth: number) {
    if (depth > 3) return;
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(full, depth + 1);
      } else if (ent.isFile() && ent.name.endsWith(".json")) {
        try {
          const raw = await fsp.readFile(full, "utf8");
          const parsed = JSON.parse(raw) as Partial<StudioSnapshot>;
          if (Array.isArray(parsed.layers)) {
            const stat = await fsp.stat(full);
            results.push({
              path: full,
              relPath: path.relative(backupsDir, full),
              name: ent.name,
              mtimeIso: parsed.saved_at || stat.mtime.toISOString(),
              device: parsed.device,
              layerCount: parsed.layers.length,
              keymapSha256: parsed.keymap_sha256,
              note: parsed.note,
            });
          }
        } catch {
          // skip non-snapshot json files (such as flash records)
        }
      }
    }
  }

  await walk(backupsDir, 0);
  return results.sort((a, b) => b.mtimeIso.localeCompare(a.mtimeIso));
}

export async function saveSnapshot(
  backupsDir: string,
  name: string,
  snapshot: StudioSnapshot
): Promise<SnapshotSummary> {
  const safeBase = name.replace(/[^A-Za-z0-9._-]/g, "_") || "snapshot";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(backupsDir, "vmk-snapshots");
  await fsp.mkdir(outDir, { recursive: true });
  const fileName = `${stamp}-${safeBase}.json`;
  const outPath = path.join(outDir, fileName);

  const enriched: StudioSnapshot = {
    ...snapshot,
    saved_at: snapshot.saved_at || new Date().toISOString(),
  };
  await fsp.writeFile(outPath, JSON.stringify(enriched, null, 2) + "\n", "utf8");
  const stat = await fsp.stat(outPath);
  return {
    path: outPath,
    relPath: path.relative(backupsDir, outPath),
    name: fileName,
    mtimeIso: enriched.saved_at || stat.mtime.toISOString(),
    device: enriched.device,
    layerCount: enriched.layers.length,
    keymapSha256: enriched.keymap_sha256,
    note: enriched.note,
  };
}

interface ActiveJobRecord {
  job: CommandJob;
  proc?: ChildProcess;
}

const jobs = new Map<string, ActiveJobRecord>();

function startJob(
  kind: JobKind,
  cmd: string,
  args: string[],
  cwd: string,
  envExtra: Record<string, string> = {}
): CommandJob {
  const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const job: CommandJob = {
    id,
    kind,
    command: [cmd, ...args].join(" "),
    status: "running",
    startedAt: new Date().toISOString(),
    output: "",
  };

  const proc = spawn(cmd, args, {
    cwd,
    env: {
      ...process.env,
      ...envExtra,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const rec: ActiveJobRecord = { job, proc };
  jobs.set(id, rec);

  const append = (chunk: Buffer) => {
    job.output += chunk.toString("utf8");
    if (job.output.length > 250_000) {
      job.output = job.output.slice(-200_000);
    }
  };
  proc.stdout.on("data", append);
  proc.stderr.on("data", append);
  proc.on("error", (err) => {
    job.output += `\n[spawn error] ${err.message}\n`;
    job.status = "failed";
    job.finishedAt = new Date().toISOString();
    job.exitCode = -1;
  });
  proc.on("close", (code) => {
    job.exitCode = code;
    job.status = code === 0 ? "succeeded" : "failed";
    job.finishedAt = new Date().toISOString();
    rec.proc = undefined;
  });

  return job;
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const c of req) {
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? (JSON.parse(text) as T) : ({} as T);
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type LocalApiVerdict = { ok: true } | { ok: false; status: number; error: string };

/**
 * Decides whether a request may use the local API, which writes files and
 * starts build and flash scripts with the developer's privileges.
 *
 * A web page on another site can make the browser send a POST here, and a
 * hostile DNS name can resolve to this machine. So the request must name a
 * loopback host, must not come from another origin, and must carry a JSON
 * content type, which a cross-origin page cannot send without a preflight
 * that this server never approves. A local program that sends no Origin
 * header is allowed: it already runs as the developer.
 */
export function checkLocalApiRequest(headers: {
  host?: string;
  origin?: string;
  "sec-fetch-site"?: string;
  "content-type"?: string;
}): LocalApiVerdict {
  const host = (headers.host || "").toLowerCase();
  const hostname = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  if (!LOOPBACK_HOSTNAMES.has(hostname)) {
    return { ok: false, status: 403, error: "The VMK local API only answers on a loopback host." };
  }
  if (headers.origin !== undefined) {
    let originHost = "";
    try {
      originHost = new URL(headers.origin).host.toLowerCase();
    } catch {
      // An opaque origin such as "null" never matches.
    }
    if (originHost !== host) {
      return { ok: false, status: 403, error: "The VMK local API rejects cross-origin requests." };
    }
  }
  const site = headers["sec-fetch-site"];
  if (site !== undefined && site !== "same-origin") {
    return { ok: false, status: 403, error: "The VMK local API rejects cross-site requests." };
  }
  const contentType = (headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return { ok: false, status: 415, error: "The VMK local API requires Content-Type: application/json." };
  }
  return { ok: true };
}

export function vmkDevPlugin(): Plugin {
  return {
    name: "vmk-studio-local-api",
    configureServer(server: Pick<ViteDevServer, "middlewares">) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith("/api/vmk/")) {
          return next();
        }
        const verdict = checkLocalApiRequest(req.headers as Record<string, string | undefined>);
        if (!verdict.ok) {
          return sendJson(res, verdict.status, { error: verdict.error });
        }
        const urlObj = new URL(req.url, "http://localhost");
        const endpoint = urlObj.pathname.replace(/^\/api\/vmk\//, "");

        try {
          if (endpoint === "status" && req.method === "POST") {
            const body = await readJsonBody<Partial<VmkWorkspacePaths>>(req);
            return sendJson(res, 200, await getWorkspaceStatus(body));
          }

          if (endpoint === "firmware-model" && req.method === "POST") {
            const body = await readJsonBody<{ repoPath?: string }>(req);
            const paths = mergePaths({ firmwareRepoPath: body.repoPath });
            return sendJson(res, 200, await readFirmwareModel(paths.firmwareRepoPath));
          }

          if (endpoint === "apply-patch" && req.method === "POST") {
            const body = await readJsonBody<{
              repoPath?: string;
              patch: FirmwareTuningPatch;
            }>(req);
            const paths = mergePaths({ firmwareRepoPath: body.repoPath });
            return sendJson(
              res,
              200,
              await applyFirmwarePatch(paths.firmwareRepoPath, body.patch)
            );
          }

          if (endpoint === "keymap/save" && req.method === "POST") {
            const body = await readJsonBody<{
              repoPath?: string;
              payload: RepoKeymapSavePayload;
            }>(req);
            const paths = mergePaths({ firmwareRepoPath: body.repoPath });
            const rel = "config/toucan.keymap";
            const full = assertInside(paths.firmwareRepoPath, rel);
            const prev = await fsp.readFile(full, "utf8");
            const next = updateRepoKeymapSource(prev, body.payload);
            if (next !== prev) {
              await fsp.writeFile(full, next, "utf8");
            }
            return sendJson(res, 200, {
              ok: true,
              model: await readFirmwareModel(paths.firmwareRepoPath),
            });
          }

          if (endpoint === "behaviors/upsert" && req.method === "POST") {
            const body = await readJsonBody<{
              repoPath?: string;
              behavior: CustomBehaviorDef;
            }>(req);
            const paths = mergePaths({ firmwareRepoPath: body.repoPath });
            const rel = body.behavior.sourceFile || "dts/cg_toggle.dtsi";
            const full = assertInside(paths.firmwareRepoPath, rel);
            const prev = await readTextIfExists(full);
            const next = upsertCustomBehaviorNode(prev, body.behavior);
            await fsp.writeFile(full, next, "utf8");
            return sendJson(res, 200, {
              ok: true,
              model: await readFirmwareModel(paths.firmwareRepoPath),
            });
          }

          if (endpoint === "behaviors/delete" && req.method === "POST") {
            const body = await readJsonBody<{
              repoPath?: string;
              sourceFile: string;
              label: string;
            }>(req);
            const paths = mergePaths({ firmwareRepoPath: body.repoPath });
            const rel = body.sourceFile || "dts/cg_toggle.dtsi";
            const full = assertInside(paths.firmwareRepoPath, rel);
            const prev = await fsp.readFile(full, "utf8");
            const next = deleteCustomBehaviorNode(prev, body.label);
            await fsp.writeFile(full, next, "utf8");
            return sendJson(res, 200, {
              ok: true,
              model: await readFirmwareModel(paths.firmwareRepoPath),
            });
          }

          if (endpoint === "read-file" && req.method === "POST") {
            const body = await readJsonBody<{ repoPath?: string; relPath: string }>(req);
            const paths = mergePaths({ firmwareRepoPath: body.repoPath });
            const full = assertInside(paths.firmwareRepoPath, body.relPath);
            const content = await fsp.readFile(full, "utf8");
            return sendJson(res, 200, { relPath: body.relPath, content });
          }

          if (endpoint === "write-file" && req.method === "POST") {
            const body = await readJsonBody<{
              repoPath?: string;
              relPath: string;
              content: string;
            }>(req);
            const paths = mergePaths({ firmwareRepoPath: body.repoPath });
            const full = assertInside(paths.firmwareRepoPath, body.relPath);
            await fsp.writeFile(full, body.content, "utf8");
            return sendJson(res, 200, { ok: true, relPath: body.relPath });
          }

          if (endpoint === "git-diff" && req.method === "POST") {
            const body = await readJsonBody<{ repoPath?: string; relPath?: string }>(req);
            const paths = mergePaths({ firmwareRepoPath: body.repoPath });
            const args = ["-C", paths.firmwareRepoPath, "diff"];
            if (body.relPath) {
              assertInside(paths.firmwareRepoPath, body.relPath);
              args.push("--", body.relPath);
            }
            const { stdout } = await execFileAsync("git", args, {
              maxBuffer: 4 * 1024 * 1024,
            });
            return sendJson(res, 200, { diff: stdout });
          }

          if (endpoint === "revert-file" && req.method === "POST") {
            const body = await readJsonBody<{ repoPath?: string; relPath: string }>(req);
            const paths = mergePaths({ firmwareRepoPath: body.repoPath });
            assertInside(paths.firmwareRepoPath, body.relPath);
            await execFileAsync("git", [
              "-C",
              paths.firmwareRepoPath,
              "checkout",
              "--",
              body.relPath,
            ]);
            return sendJson(res, 200, { ok: true });
          }

          if (endpoint === "snapshots/list" && req.method === "POST") {
            const body = await readJsonBody<{ backupsDir?: string }>(req);
            const paths = mergePaths({ backupsDir: body.backupsDir });
            return sendJson(res, 200, {
              snapshots: await listSnapshots(paths.backupsDir),
            });
          }

          if (endpoint === "snapshots/read" && req.method === "POST") {
            const body = await readJsonBody<{ backupsDir?: string; relPath: string }>(req);
            const paths = mergePaths({ backupsDir: body.backupsDir });
            const full = assertInside(paths.backupsDir, body.relPath);
            const snapshot = JSON.parse(await fsp.readFile(full, "utf8")) as StudioSnapshot;
            return sendJson(res, 200, { snapshot });
          }

          if (endpoint === "snapshots/save" && req.method === "POST") {
            const body = await readJsonBody<{
              backupsDir?: string;
              name: string;
              snapshot: StudioSnapshot;
            }>(req);
            const paths = mergePaths({ backupsDir: body.backupsDir });
            const summary = await saveSnapshot(paths.backupsDir, body.name, body.snapshot);
            return sendJson(res, 200, { summary });
          }

          if (endpoint === "jobs/start" && req.method === "POST") {
            const body = await readJsonBody<{
              kind: JobKind;
              scriptName?: string;
              paths?: Partial<VmkWorkspacePaths>;
              waitSeconds?: number;
            }>(req);
            const paths = mergePaths(body.paths);
            const repo = paths.firmwareRepoPath;
            const westDir = path.dirname(paths.westPath);
            const baseEnv = {
              PATH: `${westDir}:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ""}`,
              ZMK_APP: paths.zmkAppPath,
              WEST: paths.westPath,
            };

            if (body.kind === "test-host") {
              const job = startJob("test-host", "sh", ["scripts/test-host.sh"], repo, baseEnv);
              return sendJson(res, 200, { job });
            }
            if (body.kind === "test-single") {
              const script = path.basename(body.scriptName || "test-host.sh");
              if (!/^test-[A-Za-z0-9_-]+\.sh$/.test(script)) {
                return sendJson(res, 400, { error: `Invalid test script name: ${script}` });
              }
              const job = startJob("test-single", "sh", [`scripts/${script}`], repo, baseEnv);
              return sendJson(res, 200, { job });
            }
            if (body.kind === "build-firmware") {
              const job = startJob("build-firmware", "sh", ["scripts/build.sh"], repo, baseEnv);
              return sendJson(res, 200, { job });
            }
            if (body.kind === "verify-build") {
              const job = startJob("verify-build", "sh", ["scripts/verify-build.sh"], repo, baseEnv);
              return sendJson(res, 200, { job });
            }
            if (body.kind === "helper-build-install") {
              const job = startJob(
                "helper-build-install",
                "sh",
                ["host/macos/install.sh"],
                repo,
                baseEnv
              );
              return sendJson(res, 200, { job });
            }
            if (body.kind === "flash-left" || body.kind === "flash-right") {
              const isLeft = body.kind === "flash-left";
              const scriptFile = path.join(
                paths.toolsDir,
                isLeft ? "flash_left_once.py" : "flash_right_once.py"
              );
              if (!(await fileExists(scriptFile))) {
                return sendJson(res, 400, {
                  error: `Flash helper script not found: ${scriptFile}`,
                });
              }
              const artifact = await inspectArtifact(
                repo,
                isLeft ? "toucan_left_zg_studio" : "toucan_right",
                isLeft ? "left" : "right"
              );
              if (!artifact.exists || !artifact.sha256) {
                return sendJson(res, 400, {
                  error: `UF2 image not found: ${artifact.path}`,
                });
              }
              const flashDir = path.join(paths.backupsDir, "vmk-flashes");
              await fsp.mkdir(flashDir, { recursive: true });
              const stamp = new Date().toISOString().replace(/[:.]/g, "-");
              const recordPath = path.join(
                flashDir,
                `flash-${isLeft ? "left" : "right"}-${stamp}.json`
              );
              const waitSec = String(Math.max(30, Math.min(1800, body.waitSeconds ?? 300)));
              const args = [
                scriptFile,
                artifact.path,
                artifact.sha256,
                recordPath,
                "--wait",
                waitSec,
              ];
              if (!isLeft) {
                const leftArt = await inspectArtifact(repo, "toucan_left_zg_studio", "left");
                const backupUf2 = path.join(flashDir, `right-before-${stamp}.uf2`);
                if (leftArt.exists) {
                  args.push("--left-image", leftArt.path);
                }
                args.push("--backup", backupUf2);
              }
              const job = startJob(body.kind, "python3", args, repo, baseEnv);
              return sendJson(res, 200, { job });
            }

            return sendJson(res, 400, { error: `Unknown job kind: ${body.kind}` });
          }

          if (endpoint === "jobs/status" && req.method === "POST") {
            const body = await readJsonBody<{ id: string }>(req);
            const rec = jobs.get(body.id);
            if (!rec) return sendJson(res, 404, { error: "Job not found" });
            return sendJson(res, 200, { job: rec.job });
          }

          if (endpoint === "jobs/cancel" && req.method === "POST") {
            const body = await readJsonBody<{ id: string }>(req);
            const rec = jobs.get(body.id);
            if (rec?.proc) {
              rec.proc.kill("SIGTERM");
              rec.job.output += "\n[cancelled by user]\n";
              rec.job.status = "failed";
              rec.job.finishedAt = new Date().toISOString();
            }
            return sendJson(res, 200, { ok: true, job: rec?.job });
          }

          return sendJson(res, 404, { error: `Unknown VMK endpoint: ${endpoint}` });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return sendJson(res, 500, { error: message });
        }
      });
    },
  };
}
