import { AppHeader, VmkTab } from "./AppHeader";

import { create_rpc_connection } from "@zmkfirmware/zmk-studio-ts-client";
import { call_rpc } from "./rpc/logging";

import type { Notification } from "@zmkfirmware/zmk-studio-ts-client/studio";
import { ConnectionState, ConnectionContext } from "./rpc/ConnectionContext";
import { Dispatch, useCallback, useEffect, useState } from "react";
import { ConnectModal, TransportFactory } from "./ConnectModal";

import type { RpcTransport } from "@zmkfirmware/zmk-studio-ts-client/transport/index";
import { connect as gatt_connect } from "@zmkfirmware/zmk-studio-ts-client/transport/gatt";
import { connect as serial_connect } from "@zmkfirmware/zmk-studio-ts-client/transport/serial";
import {
  connect as tauri_ble_connect,
  list_devices as ble_list_devices,
} from "./tauri/ble";
import {
  connect as tauri_serial_connect,
  list_devices as serial_list_devices,
} from "./tauri/serial";
import Keyboard from "./keyboard/Keyboard";
import { UndoRedoContext, useUndoRedo } from "./undoRedo";
import { usePub, useSub } from "./usePubSub";
import { LockState } from "@zmkfirmware/zmk-studio-ts-client/core";
import { LockStateContext } from "./rpc/LockStateContext";
import { UnlockModal } from "./UnlockModal";
import { valueAfter } from "./misc/async";
import { AppFooter } from "./AppFooter";
import { AboutModal } from "./AboutModal";
import { LicenseNoticeModal } from "./misc/LicenseNoticeModal";
import {
  getFirmwareModel,
  getWorkspaceStatus,
  listSnapshots,
  loadSavedWorkspacePaths,
} from "./vmk/api";
import type {
  FirmwareModel,
  SnapshotSummary,
  VmkWorkspacePaths,
  VmkWorkspaceStatus,
} from "./vmk/types";
import { VisualRepoKeymapEditor } from "./vmk/components/VisualRepoKeymapEditor";
import { FirmwareTunerView } from "./vmk/components/FirmwareTunerView";
import { CustomBehaviorsAndFilesView } from "./vmk/components/CustomBehaviorsAndFilesView";
import { BuildAndFlashView } from "./vmk/components/BuildAndFlashView";
import { Toaster, toast } from "@/components/ui/toast";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: object;
  }
}

const THEME_STORAGE_KEY = "vmk_studio_theme_v1";

const TRANSPORTS: TransportFactory[] = [
  navigator.serial && { label: "USB", connect: serial_connect },
  ...(navigator.bluetooth && navigator.userAgent.indexOf("Linux") >= 0
    ? [{ label: "BLE", connect: gatt_connect }]
    : []),
  ...(window.__TAURI_INTERNALS__
    ? [
        {
          label: "BLE",
          isWireless: true,
          pick_and_connect: {
            connect: tauri_ble_connect,
            list: ble_list_devices,
          },
        },
      ]
    : []),
  ...(window.__TAURI_INTERNALS__
    ? [
        {
          label: "USB",
          pick_and_connect: {
            connect: tauri_serial_connect,
            list: serial_list_devices,
          },
        },
      ]
    : []),
].filter((t) => t !== undefined);

async function listen_for_notifications(
  notification_stream: ReadableStream<Notification>,
  signal: AbortSignal
): Promise<void> {
  const reader = notification_stream.getReader();
  const onAbort = () => {
    reader.cancel();
    reader.releaseLock();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  do {
    const pub = usePub();

    try {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (!value) {
        continue;
      }

      pub("rpc_notification", value);

      const subsystem = Object.entries(value).find(
        ([_k, v]) => v !== undefined
      );
      if (!subsystem) {
        continue;
      }

      const [subId, subData] = subsystem;
      const event = Object.entries(subData).find(([_k, v]) => v !== undefined);

      if (!event) {
        continue;
      }

      const [eventName, eventData] = event;
      const topic = ["rpc_notification", subId, eventName].join(".");

      pub(topic, eventData);
    } catch (e) {
      signal.removeEventListener("abort", onAbort);
      reader.releaseLock();
      throw e;
    }
  } while (true);

  signal.removeEventListener("abort", onAbort);
  reader.releaseLock();
  notification_stream.cancel();
}

async function connect(
  transport: RpcTransport,
  setConn: Dispatch<ConnectionState>,
  setConnectedDeviceName: Dispatch<string | undefined>,
  signal: AbortSignal
) {
  const conn = await create_rpc_connection(transport, { signal });

  const details = await Promise.race([
    call_rpc(conn, { core: { getDeviceInfo: true } })
      .then((r) => r?.core?.getDeviceInfo)
      .catch((e) => {
        console.error("Failed first RPC call", e);
        return undefined;
      }),
    valueAfter(undefined, 1500),
  ]);

  if (!details) {
    toast.error("Failed to connect to the chosen device");
    return;
  }

  listen_for_notifications(conn.notification_readable, signal)
    .then(() => {
      setConnectedDeviceName(undefined);
      setConn({ conn: null });
    })
    .catch((_e) => {
      setConnectedDeviceName(undefined);
      setConn({ conn: null });
    });

  setConnectedDeviceName(details.name);
  setConn({ conn });
  toast.success(`Connected to ${details.name}`);
}

function App() {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === "light" || saved === "dark") return saved;
    } catch {
      // ignore
    }
    return "dark";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
      root.classList.remove("light");
    } else {
      root.classList.remove("dark");
      root.classList.add("light");
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const [conn, setConn] = useState<ConnectionState>({ conn: null });
  const [connectedDeviceName, setConnectedDeviceName] = useState<
    string | undefined
  >(undefined);
  const [doIt, undo, redo, canUndo, canRedo, reset] = useUndoRedo();
  const [showAbout, setShowAbout] = useState(false);
  const [showLicenseNotice, setShowLicenseNotice] = useState(false);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [connectionAbort, setConnectionAbort] = useState(new AbortController());

  const [activeTab, setActiveTab] = useState<VmkTab>("keymap");
  const [keymapSource, setKeymapSource] = useState<"live" | "repo">("live");
  const [selectedEditorFile, setSelectedEditorFile] = useState<string>("config/toucan.keymap");
  const [customPaths, setCustomPaths] = useState<Partial<VmkWorkspacePaths>>(() =>
    loadSavedWorkspacePaths()
  );
  const [workspaceStatus, setWorkspaceStatus] = useState<VmkWorkspaceStatus | null>(null);
  const [firmwareModel, setFirmwareModel] = useState<FirmwareModel | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);

  const [lockState, setLockState] = useState<LockState>(
    LockState.ZMK_STUDIO_CORE_LOCK_STATE_LOCKED
  );

  const refreshWorkspace = useCallback(
    async (pathsOverride?: Partial<VmkWorkspacePaths>) => {
      const p = pathsOverride ?? customPaths;
      try {
        const st = await getWorkspaceStatus(p);
        setWorkspaceStatus(st);
        const [model, snaps] = await Promise.all([
          st.repoExists ? getFirmwareModel(st.paths.firmwareRepoPath) : Promise.resolve(null),
          listSnapshots(st.paths.backupsDir).catch(() => []),
        ]);
        setFirmwareModel(model);
        setSnapshots(snaps);
      } catch (e) {
        console.warn("VMK local workspace bridge unavailable:", e);
      } finally {
        setWorkspaceLoading(false);
      }
    },
    [customPaths]
  );

  useEffect(() => {
    refreshWorkspace();
  }, [refreshWorkspace]);

  useSub("rpc_notification.core.lockStateChanged", (ls) => {
    setLockState(ls);
  });

  useEffect(() => {
    if (!conn.conn) {
      reset();
      setLockState(LockState.ZMK_STUDIO_CORE_LOCK_STATE_LOCKED);
      return;
    }

    async function updateLockState() {
      if (!conn.conn) {
        return;
      }

      const locked_resp = await call_rpc(conn.conn, {
        core: { getLockState: true },
      });

      setLockState(
        locked_resp.core?.getLockState ||
          LockState.ZMK_STUDIO_CORE_LOCK_STATE_LOCKED
      );
    }

    updateLockState();
  }, [conn.conn, reset]);

  const save = useCallback(() => {
    async function doSave() {
      if (!conn.conn) {
        return;
      }

      const resp = await call_rpc(conn.conn, { keymap: { saveChanges: true } });
      if (!resp.keymap?.saveChanges || resp.keymap?.saveChanges.err) {
        toast.error("Failed to save changes to keyboard");
      } else {
        toast.success("Keymap saved to keyboard flash");
      }
    }

    doSave();
  }, [conn]);

  const discard = useCallback(() => {
    async function doDiscard() {
      if (!conn.conn) {
        return;
      }

      const resp = await call_rpc(conn.conn, {
        keymap: { discardChanges: true },
      });
      if (!resp.keymap?.discardChanges) {
        toast.error("Failed to discard changes");
      } else {
        toast.info("Discarded unsaved keyboard changes");
      }

      reset();
      setConn({ conn: conn.conn });
    }

    doDiscard();
  }, [conn, reset]);

  const resetSettings = useCallback(() => {
    async function doReset() {
      if (!conn.conn) {
        return;
      }

      const resp = await call_rpc(conn.conn, {
        core: { resetSettings: true },
      });
      if (!resp.core?.resetSettings) {
        toast.error("Failed to reset settings");
      } else {
        toast.warning("Stock settings restored");
      }

      reset();
      setConn({ conn: conn.conn });
    }

    doReset();
  }, [conn, reset]);

  const disconnect = useCallback(() => {
    async function doDisconnect() {
      if (!conn.conn) {
        return;
      }

      await conn.conn.request_writable.close();
      connectionAbort.abort("User disconnected");
      setConnectionAbort(new AbortController());
      toast.info("Keyboard disconnected");
    }

    doDisconnect();
  }, [conn, connectionAbort]);

  const onConnect = useCallback(
    (t: RpcTransport) => {
      const ac = new AbortController();
      setConnectionAbort(ac);
      setShowConnectModal(false);
      setActiveTab("keymap");
      connect(t, setConn, setConnectedDeviceName, ac.signal);
    },
    [setConn, setConnectedDeviceName]
  );

  const repoStatusLabel = workspaceStatus?.repoExists
    ? `${workspaceStatus.gitTag || workspaceStatus.gitBranch || "repo"}@${workspaceStatus.gitHead || ""} · ${firmwareModel?.customBehaviors.length ?? 0} custom`
    : undefined;

  return (
    <ConnectionContext.Provider value={conn}>
      <LockStateContext.Provider value={lockState}>
        <UndoRedoContext.Provider value={doIt}>
          <Toaster position="bottom-right" />
          <UnlockModal />
          <ConnectModal
            open={showConnectModal && !conn.conn}
            transports={TRANSPORTS}
            onTransportCreated={onConnect}
            onDismiss={() => setShowConnectModal(false)}
          />
          <AboutModal open={showAbout} onClose={() => setShowAbout(false)} />
          <LicenseNoticeModal
            open={showLicenseNotice}
            onClose={() => setShowLicenseNotice(false)}
          />
          <div className="bg-background text-foreground h-full max-h-[100vh] w-full max-w-[100vw] grid grid-cols-1 grid-rows-[auto_1fr_auto] overflow-hidden">
            <AppHeader
              activeTab={activeTab}
              onSelectTab={setActiveTab}
              theme={theme}
              onChangeTheme={setTheme}
              dirtyFileCount={workspaceStatus?.dirtyFiles.length ?? 0}
              connectedDeviceLabel={connectedDeviceName}
              onOpenConnect={() => setShowConnectModal(true)}
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={undo}
              onRedo={redo}
              onSave={save}
              onDiscard={discard}
              onDisconnect={disconnect}
              onResetSettings={resetSettings}
            />

            <main className="min-h-0 min-w-0 overflow-hidden bg-background">
              {activeTab === "keymap" &&
                (conn.conn && keymapSource === "live" ? (
                  <Keyboard
                    deviceName={connectedDeviceName}
                    customBehaviors={firmwareModel?.customBehaviors}
                    snapshots={snapshots}
                    backupsDir={workspaceStatus?.paths.backupsDir}
                    onSnapshotSaved={() => refreshWorkspace()}
                    onSwitchToRepoKeymap={() => setKeymapSource("repo")}
                  />
                ) : (
                  <VisualRepoKeymapEditor
                    firmwareModel={firmwareModel}
                    loading={workspaceLoading}
                    snapshots={snapshots}
                    backupsDir={workspaceStatus?.paths.backupsDir}
                    isConnected={Boolean(conn.conn)}
                    onModelUpdated={(nextModel) => {
                      setFirmwareModel(nextModel);
                      refreshWorkspace();
                    }}
                    onOpenConnect={() => setShowConnectModal(true)}
                    onSwitchToLive={() => setKeymapSource("live")}
                    onEditKeymapFile={() => {
                      setSelectedEditorFile("config/toucan.keymap");
                      setActiveTab("files");
                    }}
                  />
                ))}

              {activeTab === "tuner" && (
                <FirmwareTunerView
                  firmwareModel={firmwareModel}
                  onModelUpdated={(nextModel) => {
                    setFirmwareModel(nextModel);
                    refreshWorkspace();
                  }}
                  onGoToBuild={() => setActiveTab("build")}
                />
              )}

              {activeTab === "files" && (
                <CustomBehaviorsAndFilesView
                  firmwareModel={firmwareModel}
                  initialFile={selectedEditorFile}
                  onModelUpdated={(nextModel) => {
                    setFirmwareModel(nextModel);
                    refreshWorkspace();
                  }}
                  onRefreshModel={() => refreshWorkspace()}
                />
              )}

              {activeTab === "build" && (
                <BuildAndFlashView
                  status={workspaceStatus}
                  customPaths={customPaths}
                  onPathsChanged={(nextPaths) => {
                    setCustomPaths(nextPaths);
                    refreshWorkspace(nextPaths);
                  }}
                  onRefreshStatus={refreshWorkspace}
                />
              )}
            </main>

            <AppFooter
              repoStatusLabel={repoStatusLabel}
              onShowAbout={() => setShowAbout(true)}
              onShowLicenseNotice={() => setShowLicenseNotice(true)}
            />
          </div>
        </UndoRedoContext.Provider>
      </LockStateContext.Provider>
    </ConnectionContext.Provider>
  );
}

export default App;
