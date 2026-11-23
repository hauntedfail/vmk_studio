import { useEffect, useRef, useState } from "react";
import type {
  CommandJob,
  JobKind,
  VmkWorkspacePaths,
  VmkWorkspaceStatus,
} from "../types";
import {
  cancelCommandJob,
  getJobStatus,
  saveWorkspacePaths,
  startCommandJob,
} from "../api";
import { toast } from "@/components/ui/toast";
import {
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  Hammer,
  RefreshCw,
  Settings2,
  Square,
  Terminal,
  Upload,
  XCircle,
} from "lucide-react";

interface BuildAndFlashViewProps {
  status: VmkWorkspaceStatus | null;
  customPaths: Partial<VmkWorkspacePaths>;
  onPathsChanged: (paths: Partial<VmkWorkspacePaths>) => void;
  onRefreshStatus: () => Promise<void>;
}

const INPUT_CLS =
  "h-8 px-2.5 rounded-lg bg-recess border border-border text-xs font-mono text-foreground focus:outline-none focus:border-[#FC4C01]";

export const BuildAndFlashView = ({
  status,
  customPaths,
  onPathsChanged,
  onRefreshStatus,
}: BuildAndFlashViewProps) => {
  const [showSettings, setShowSettings] = useState(false);
  const [draftPaths, setDraftPaths] = useState<VmkWorkspacePaths>(
    status?.paths ?? {
      firmwareRepoPath: customPaths.firmwareRepoPath || "",
      zmkAppPath: customPaths.zmkAppPath || "",
      westPath: customPaths.westPath || "",
      backupsDir: customPaths.backupsDir || "",
      toolsDir: customPaths.toolsDir || "",
    }
  );
  const [activeJob, setActiveJob] = useState<CommandJob | null>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const refreshRef = useRef(onRefreshStatus);
  refreshRef.current = onRefreshStatus;

  useEffect(() => {
    if (status?.paths) {
      setDraftPaths(status.paths);
    }
  }, [status?.paths]);

  const activeJobId = activeJob?.id;
  const activeJobStatus = activeJob?.status;
  useEffect(() => {
    if (!activeJobId || activeJobStatus !== "running") return;
    let cancelled = false;
    const poll = async () => {
      try {
        const latest = await getJobStatus(activeJobId);
        if (cancelled) return;
        setActiveJob(latest);
        if (latest.status !== "running") {
          refreshRef.current();
          if (latest.status === "succeeded") {
            toast.success(`${latest.kind} succeeded`);
          } else {
            toast.error(`${latest.kind} failed (exit ${latest.exitCode ?? "?"})`);
          }
        }
      } catch {
        // ignore transient poll errors
      }
    };
    poll();
    const timer = window.setInterval(poll, 350);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeJobId, activeJobStatus]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [activeJob?.output]);

  const launchJob = async (kind: JobKind, scriptName?: string) => {
    try {
      const job = await startCommandJob({
        kind,
        scriptName,
        paths: status?.paths || customPaths,
      });
      setActiveJob(job);
    } catch (e) {
      toast.error("Failed to start job", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const handleFlash = async (half: "left" | "right") => {
    if (!status) return;
    const bl = status.bootloader;
    if (half === "right" && bl.mounted && bl.detectedHalf === "left") {
      toast.error("Cross-flash blocked", {
        description: `Mounted XIAO-BOOT contains central (LEFT) markers: ${bl.detectedMarkers.join(", ")}`,
      });
      return;
    }
    if (half === "left" && bl.mounted && bl.detectedHalf === "right_or_other") {
      const proceed = window.confirm(
        "WARNING: Mounted XIAO-BOOT does not show central markers. Continue flashing LEFT?"
      );
      if (!proceed) return;
    }
    const label = half === "left" ? "LEFT (Central + Studio)" : "RIGHT (Peripheral + Trackpad)";
    const ok = window.confirm(
      `Start safe single-write flash for ${label}?\n\n` +
        `• Settings partition & BLE bonds are preserved (no settings_reset).\n` +
        `• Put the ${half.toUpperCase()} half into XIAO-BOOT bootloader when ready.\n` +
        `• Do not touch the volume after copy begins.`
    );
    if (!ok) return;
    await launchJob(half === "left" ? "flash-left" : "flash-right");
  };

  const isRunning = activeJob?.status === "running";
  const testScripts = (status?.availableScripts || []).filter(
    (s) => s.startsWith("test-") && s !== "test-host.sh"
  );

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto space-y-5">
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold tracking-tight text-foreground">
                Test, Build &amp; Safe Flash
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Host C/Swift tests, west UF2 compilation, SHA-256 verification, and central-marker cross-flash protection.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onRefreshStatus()}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-surface border border-border text-xs font-medium text-foreground hover:bg-muted"
              >
                <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
                Refresh
              </button>
              <button
                type="button"
                onClick={() => setShowSettings((v) => !v)}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-surface border border-border text-xs font-medium text-foreground hover:bg-muted"
              >
                <Settings2 className="w-3.5 h-3.5 text-muted-foreground" />
                Paths
              </button>
            </div>
          </div>

          {showSettings && (
            <div className="vmk-card rounded-2xl p-5 space-y-4 text-xs">
              <div className="font-semibold text-foreground">Workspace &amp; Toolchain Paths</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(
                  [
                    ["firmwareRepoPath", "Firmware Repository"],
                    ["zmkAppPath", "ZMK_APP Directory"],
                    ["westPath", "west Binary"],
                    ["backupsDir", "Snapshots & Backups"],
                    ["toolsDir", "Flash Helpers (flash_*_once.py)"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex flex-col gap-1">
                    <span className="text-muted-foreground font-medium">{label}</span>
                    <input
                      type="text"
                      value={draftPaths[key]}
                      onChange={(e) =>
                        setDraftPaths({ ...draftPaths, [key]: e.target.value })
                      }
                      className={INPUT_CLS}
                    />
                  </label>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowSettings(false)}
                  className="h-8 px-3 rounded-lg bg-recess border border-border text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    saveWorkspacePaths(draftPaths);
                    onPathsChanged(draftPaths);
                    setShowSettings(false);
                    toast.success("Workspace paths updated");
                  }}
                  className="h-8 px-3.5 rounded-lg bg-[#FC4C01] text-white font-medium"
                >
                  Save Paths
                </button>
              </div>
            </div>
          )}

          {/* Monochrome 4-Tile Hardware Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="vmk-card rounded-2xl p-4 space-y-1">
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                Repository
              </div>
              <div className="font-semibold text-sm text-foreground truncate">
                {status?.repoExists
                  ? `${status.gitTag || status.gitBranch} · ${status.gitHead}`
                  : "Not found"}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {status?.dirtyFiles.length
                  ? `${status.dirtyFiles.length} modified file(s)`
                  : "Clean working tree"}
              </div>
            </div>

            <div className="vmk-card rounded-2xl p-4 space-y-1">
              <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                <span>USB Bus</span>
                <span
                  className={`w-2 h-2 rounded-full ${
                    status?.usbKeyboardConnected ? "bg-[#30D158]" : "bg-muted-foreground/30"
                  }`}
                />
              </div>
              <div className="font-semibold text-sm text-foreground">
                {status?.usbKeyboardConnected ? "Toucan Connected" : "Not on USB Bus"}
              </div>
              <div className="text-[11px] font-mono text-muted-foreground">
                zmk:{status?.zmkAppExists ? "ok" : "missing"} · west:
                {status?.westExists ? "ok" : "missing"}
              </div>
            </div>

            <div className="vmk-card rounded-2xl p-4 space-y-1">
              <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                <span>XIAO-BOOT</span>
                <span
                  className={`w-2 h-2 rounded-full ${
                    status?.bootloader.mounted ? "bg-[#FC4C01]" : "bg-muted-foreground/30"
                  }`}
                />
              </div>
              <div className="font-semibold text-sm text-foreground">
                {status?.bootloader.mounted
                  ? status.bootloader.detectedHalf === "left"
                    ? "Mounted: LEFT"
                    : "Mounted: RIGHT"
                  : "Not Mounted"}
              </div>
              <div className="text-[11px] text-muted-foreground truncate">
                {status?.bootloader.mounted
                  ? status.bootloader.boardId || status.bootloader.volumePath
                  : "Waiting for bootloader"}
              </div>
            </div>

            <div className="vmk-card rounded-2xl p-4 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                <span>macOS Helper</span>
                <span
                  className={`w-2 h-2 rounded-full ${
                    status?.helperRunning ? "bg-[#30D158]" : "bg-muted-foreground/30"
                  }`}
                />
              </div>
              <div className="font-semibold text-sm text-foreground">
                {status?.helperRunning
                  ? "Running"
                  : status?.helperInstalled
                    ? "Stopped"
                    : "Not Installed"}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground truncate">
                  Pinch &amp; smart zoom
                </span>
                <button
                  type="button"
                  disabled={isRunning || !status?.repoExists}
                  onClick={() => launchJob("helper-build-install")}
                  className="h-6 px-2 rounded-md bg-recess border border-border text-[11px] font-medium text-foreground hover:border-[#FC4C01] disabled:opacity-35 shrink-0"
                >
                  Rebuild
                </button>
              </div>
            </div>
          </div>

          {/* Step 1 & 2 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <section className="vmk-card rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FlaskConical className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-foreground">1. Host Unit Tests</h3>
                </div>
                <button
                  type="button"
                  disabled={isRunning || !status?.repoExists}
                  onClick={() => launchJob("test-host")}
                  className="h-8 px-3.5 rounded-lg bg-foreground text-background text-xs font-medium hover:opacity-90 disabled:opacity-35"
                >
                  Run All Host Tests
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Runs C host suites for CG toggle, QMK hold-tap, double-tap, split relay, and Swift helper core.
              </p>
              {testScripts.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {testScripts.map((script) => (
                    <button
                      key={script}
                      type="button"
                      disabled={isRunning}
                      onClick={() => launchJob("test-single", script)}
                      className="h-6 px-2 rounded-md bg-recess border border-border text-muted-foreground hover:text-foreground hover:border-foreground/25 font-mono text-[11px] disabled:opacity-35"
                    >
                      {script}
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="vmk-card rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Hammer className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-foreground">2. Build &amp; Verify UF2</h3>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isRunning || !status?.repoExists}
                    onClick={() => launchJob("verify-build")}
                    className="h-8 px-3 rounded-lg bg-recess border border-border text-xs font-medium text-foreground hover:bg-muted disabled:opacity-35"
                  >
                    Verify
                  </button>
                  <button
                    type="button"
                    disabled={isRunning || !status?.repoExists || !status?.zmkAppExists}
                    onClick={() => launchJob("build-firmware")}
                    className="h-8 px-3.5 rounded-lg bg-[#FC4C01] text-white text-xs font-medium hover:opacity-90 disabled:opacity-35"
                  >
                    Build Both Halves
                  </button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Compiles <code>toucan_left_zg_studio.uf2</code> and <code>toucan_right.uf2</code> via <code>scripts/build.sh</code> with SHA-256 verification.
              </p>
            </section>
          </div>

          {/* Step 3: Safe Flasher */}
          <section className="vmk-card rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Upload className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">
                  3. Half-Guarded UF2 Flasher
                </h3>
              </div>
              <span className="text-[11px] font-mono text-muted-foreground">
                Preserves Studio keymap &amp; BLE bonds · never flashes settings_reset
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              {(["left", "right"] as const).map((half) => {
                const art = status?.artifacts[half];
                const mismatchWarning =
                  status?.bootloader.mounted &&
                  ((half === "right" && status.bootloader.detectedHalf === "left") ||
                    (half === "left" && status.bootloader.detectedHalf === "right_or_other"));

                return (
                  <div
                    key={half}
                    className={`p-4 rounded-xl bg-recess border space-y-3 ${
                      mismatchWarning ? "border-red-500/70" : "border-border"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-foreground truncate">
                        {half === "left"
                          ? "Left Half (Central + Studio)"
                          : "Right Half (Peripheral + Trackpad)"}
                      </span>
                      {art?.checksumMatches && (
                        <span className="inline-flex items-center gap-1 text-[#30D158] text-[11px] font-mono whitespace-nowrap shrink-0">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          SHA-256 OK
                        </span>
                      )}
                    </div>

                    {art?.exists ? (
                      <div className="font-mono text-[11px] space-y-0.5 text-muted-foreground">
                        <div className="truncate text-foreground/85">
                          {art.name}.uf2 · {art.bytes?.toLocaleString()} bytes
                        </div>
                        <div className="truncate">{art.sha256}</div>
                        {art.mtimeIso && (
                          <div>Built {new Date(art.mtimeIso).toLocaleString()}</div>
                        )}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        Not built yet. Run Build Both Halves first.
                      </div>
                    )}

                    {mismatchWarning && (
                      <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-[11px]">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>
                          Mounted XIAO-BOOT matches the{" "}
                          <strong>
                            {status?.bootloader.detectedHalf === "left" ? "LEFT" : "RIGHT"}
                          </strong>{" "}
                          half. Cross-flashing is guarded.
                        </span>
                      </div>
                    )}

                    <button
                      type="button"
                      disabled={isRunning || !art?.exists}
                      onClick={() => handleFlash(half)}
                      className={`w-full h-8 rounded-lg font-medium text-xs transition-opacity disabled:opacity-35 ${
                        half === "left"
                          ? "bg-[#FC4C01] text-white hover:opacity-90"
                          : "bg-surface border border-border text-foreground hover:bg-muted"
                      }`}
                    >
                      Flash {half === "left" ? "Left Half" : "Right Half"}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>

      {/* Bottom Live Job Console */}
      <div className="h-56 bg-surface border-t border-border flex flex-col">
        <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border text-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <Terminal className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="font-medium text-foreground shrink-0">Output</span>
            {activeJob && (
              <>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold shrink-0 ${
                    activeJob.status === "running"
                      ? "bg-[#FC4C01]/15 text-[#FC4C01]"
                      : activeJob.status === "succeeded"
                        ? "bg-[#30D158]/15 text-[#30D158]"
                        : "bg-red-500/15 text-red-400"
                  }`}
                >
                  {activeJob.status === "succeeded" && <CheckCircle2 className="w-3 h-3" />}
                  {activeJob.status === "failed" && <XCircle className="w-3 h-3" />}
                  {activeJob.status.toUpperCase()}
                </span>
                <code className="font-mono text-[11px] text-muted-foreground truncate">
                  {activeJob.command}
                </code>
              </>
            )}
          </div>
          {isRunning && activeJob && (
            <button
              type="button"
              onClick={async () => {
                await cancelCommandJob(activeJob.id);
                try {
                  const latest = await getJobStatus(activeJob.id);
                  setActiveJob(latest);
                } catch {
                  // ignore
                }
              }}
              className="inline-flex items-center gap-1 h-6 px-2.5 rounded-md bg-red-500/15 text-red-400 hover:bg-red-500/25 text-[11px] font-medium shrink-0"
            >
              <Square className="w-3 h-3" />
              Stop
            </button>
          )}
        </div>
        <pre
          ref={logRef}
          className="flex-1 px-4 py-3 font-mono text-[11px] leading-relaxed overflow-auto bg-recess text-foreground/85 whitespace-pre-wrap"
        >
          {activeJob?.output ||
            "Ready. Run a host test, firmware build, or half-guarded flash above."}
        </pre>
      </div>
    </div>
  );
};
