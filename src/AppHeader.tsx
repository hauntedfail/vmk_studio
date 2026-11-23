import {
  Button,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
} from "react-aria-components";
import { useConnectedDeviceData } from "./rpc/useConnectedDeviceData";
import { useSub } from "./usePubSub";
import { useContext, useEffect, useState } from "react";
import { useModalRef } from "./misc/useModalRef";
import { LockStateContext } from "./rpc/LockStateContext";
import { LockState } from "@zmkfirmware/zmk-studio-ts-client/core";
import { ConnectionContext } from "./rpc/ConnectionContext";
import {
  ChevronDown,
  Undo2,
  Redo2,
  Save,
  Trash2,
  Keyboard as KeyboardIcon,
  Sliders,
  FileCode2,
  Hammer,
  Plug,
  AlertTriangle,
  Sun,
  Moon,
} from "lucide-react";
import { Tooltip } from "./misc/Tooltip";
import { GenericModal } from "./GenericModal";
import { GooeyNav } from "@/components/ui/gooey-nav";
import { ThemeSelector } from "@/components/ui/theme-selector";

export type VmkTab = "keymap" | "tuner" | "files" | "build";

const TAB_ORDER: VmkTab[] = ["keymap", "tuner", "files", "build"];

export interface AppHeaderProps {
  activeTab: VmkTab;
  onSelectTab: (tab: VmkTab) => void;
  theme: "dark" | "light";
  onChangeTheme: (theme: "dark" | "light") => void;
  dirtyFileCount?: number;
  connectedDeviceLabel?: string;
  onOpenConnect?: () => void;
  onSave?: () => void | Promise<void>;
  onDiscard?: () => void | Promise<void>;
  onUndo?: () => Promise<void>;
  onRedo?: () => Promise<void>;
  onResetSettings?: () => void | Promise<void>;
  onDisconnect?: () => void | Promise<void>;
  canUndo?: boolean;
  canRedo?: boolean;
}

export const AppHeader = ({
  activeTab,
  onSelectTab,
  theme,
  onChangeTheme,
  dirtyFileCount = 0,
  connectedDeviceLabel,
  onOpenConnect,
  canRedo,
  canUndo,
  onRedo,
  onUndo,
  onSave,
  onDiscard,
  onDisconnect,
  onResetSettings,
}: AppHeaderProps) => {
  const [showSettingsReset, setShowSettingsReset] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [showThemePicker, setShowThemePicker] = useState(false);

  const lockState = useContext(LockStateContext);
  const connectionState = useContext(ConnectionContext);

  useEffect(() => {
    if (
      (!connectionState.conn ||
        lockState != LockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED) &&
      showSettingsReset
    ) {
      setShowSettingsReset(false);
    }
  }, [lockState, showSettingsReset, connectionState.conn]);

  const showSettingsRef = useModalRef(showSettingsReset);
  const [unsaved, setUnsaved] = useConnectedDeviceData<boolean>(
    { keymap: { checkUnsavedChanges: true } },
    (r) => r.keymap?.checkUnsavedChanges
  );

  useSub("rpc_notification.keymap.unsavedChangesStatusChanged", (u) =>
    setUnsaved(u)
  );

  const navItems = [
    { label: "Keymap", icon: <KeyboardIcon className="w-3.5 h-3.5" /> },
    { label: "Firmware", icon: <Sliders className="w-3.5 h-3.5" /> },
    {
      label: dirtyFileCount > 0 ? `Behaviors (${dirtyFileCount})` : "Behaviors",
      icon: <FileCode2 className="w-3.5 h-3.5" />,
    },
    { label: "Build & Flash", icon: <Hammer className="w-3.5 h-3.5" /> },
  ];

  const activeIndex = TAB_ORDER.indexOf(activeTab);

  return (
    <header className="relative z-30 flex items-center justify-between gap-4 h-14 px-4 bg-background border-b border-border max-w-full">
      {/* Brand */}
      <div className="flex items-center gap-2.5 shrink-0">
        <img src="/vmk.svg" alt="VMK Studio" className="h-7 w-7 rounded-lg" />
        <div className="leading-tight">
          <div className="text-[13px] font-semibold tracking-tight text-foreground">
            VMK Studio
          </div>
          <div className="text-[10px] font-mono text-muted-foreground tracking-wide">
            TOUCAN 2
          </div>
        </div>
      </div>

      {/* Rare UI GooeyNav Centerpiece */}
      <div className="flex items-center justify-center min-w-0">
        <GooeyNav
          items={navItems}
          value={activeIndex}
          onChange={(idx) => onSelectTab(TAB_ORDER[idx] ?? "keymap")}
          size="sm"
          activeColor="#FC4C01"
          activeLabelColor="#ffffff"
        />
      </div>

      {/* Safeguarded Restore Stock Settings Modal */}
      <GenericModal ref={showSettingsRef} className="max-w-md rounded-2xl bg-surface border border-border">
        <div className="space-y-4 p-1">
          <div className="flex items-center gap-2 text-red-500">
            <AlertTriangle className="w-4 h-4" />
            <h2 className="text-sm font-semibold">Restore Stock Settings</h2>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            This erases your stored Studio keymap, custom behavior assignments, BLE pairings, and per-endpoint Ctrl/GUI swap states. It is not needed for firmware updates.
          </p>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">
              Type <code className="font-mono font-semibold text-foreground">RESET</code> to confirm
            </label>
            <input
              type="text"
              value={resetConfirmText}
              onChange={(e) => setResetConfirmText(e.target.value)}
              placeholder="RESET"
              className="w-full h-9 px-3 font-mono text-xs rounded-lg bg-recess border border-border text-foreground focus:outline-none focus:border-accent"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              className="rounded-lg bg-muted hover:opacity-90 px-3 py-1.5 text-xs font-medium text-foreground"
              onPress={() => {
                setResetConfirmText("");
                setShowSettingsReset(false);
              }}
            >
              Cancel
            </Button>
            <Button
              isDisabled={resetConfirmText !== "RESET"}
              className="rounded-lg bg-red-600 text-white px-3 py-1.5 text-xs font-medium disabled:opacity-40"
              onPress={() => {
                setResetConfirmText("");
                setShowSettingsReset(false);
                onResetSettings?.();
              }}
            >
              Confirm Reset
            </Button>
          </div>
        </div>
      </GenericModal>

      {/* Right Actions: Theme Selector + Connection + Live Studio Controls */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Rare UI Theme Selector Popover */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowThemePicker((v) => !v)}
            className="grid h-8 w-8 place-items-center rounded-lg bg-surface border border-border text-muted-foreground hover:text-foreground transition-colors"
            title="Switch Theme"
          >
            {theme === "dark" ? (
              <Moon className="w-3.5 h-3.5" />
            ) : (
              <Sun className="w-3.5 h-3.5" />
            )}
          </button>
          {showThemePicker && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowThemePicker(false)}
              />
              <div className="absolute right-0 top-10 z-50 w-64 p-3 rounded-2xl bg-surface border border-border shadow-2xl">
                <div className="text-[11px] font-medium text-muted-foreground mb-2.5 px-0.5">
                  Appearance
                </div>
                <ThemeSelector
                  value={theme}
                  onChange={(v) => {
                    onChangeTheme(v === "light" ? "light" : "dark");
                    setShowThemePicker(false);
                  }}
                />
              </div>
            </>
          )}
        </div>

        {connectedDeviceLabel ? (
          <MenuTrigger>
            <Button className="flex items-center gap-2 h-8 px-3 rounded-lg bg-surface border border-border text-xs font-medium text-foreground hover:bg-muted transition-colors whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full bg-[#30D158]" />
              {connectedDeviceLabel}
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            </Button>
            <Popover>
              <Menu className="shadow-xl rounded-xl bg-surface border border-border text-foreground text-xs cursor-pointer overflow-hidden p-1 min-w-[180px]">
                <MenuItem
                  className="px-2.5 py-1.5 rounded-lg hover:bg-muted outline-none"
                  onAction={onDisconnect}
                >
                  Disconnect
                </MenuItem>
                <MenuItem
                  className="px-2.5 py-1.5 rounded-lg hover:bg-red-500/10 text-red-500 outline-none"
                  onAction={() => setShowSettingsReset(true)}
                >
                  Restore Stock Settings…
                </MenuItem>
              </Menu>
            </Popover>
          </MenuTrigger>
        ) : (
          <button
            type="button"
            onClick={onOpenConnect}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-surface border border-border hover:bg-muted text-xs font-medium text-foreground transition-colors whitespace-nowrap"
          >
            <Plug className="w-3.5 h-3.5 text-accent" />
            Connect
          </button>
        )}

        {connectedDeviceLabel && (
          <div className="flex items-center gap-0.5 pl-2 border-l border-border">
            {onUndo && (
              <Tooltip label="Undo">
                <Button
                  className="grid h-8 w-8 place-items-center rounded-lg hover:bg-muted disabled:opacity-35"
                  isDisabled={!canUndo}
                  onPress={onUndo}
                >
                  <Undo2 className="w-3.5 h-3.5" aria-label="Undo" />
                </Button>
              </Tooltip>
            )}
            {onRedo && (
              <Tooltip label="Redo">
                <Button
                  className="grid h-8 w-8 place-items-center rounded-lg hover:bg-muted disabled:opacity-35"
                  isDisabled={!canRedo}
                  onPress={onRedo}
                >
                  <Redo2 className="w-3.5 h-3.5" aria-label="Redo" />
                </Button>
              </Tooltip>
            )}
            <Tooltip label="Save to Keyboard Flash">
              <Button
                className={`grid h-8 w-8 place-items-center rounded-lg hover:bg-muted disabled:opacity-35 ${
                  unsaved ? "text-accent" : ""
                }`}
                isDisabled={!unsaved}
                onPress={onSave}
              >
                <Save className="w-3.5 h-3.5" aria-label="Save" />
              </Button>
            </Tooltip>
            <Tooltip label="Discard Unsaved Keymap Changes">
              <Button
                className="grid h-8 w-8 place-items-center rounded-lg hover:bg-muted disabled:opacity-35"
                onPress={onDiscard}
                isDisabled={!unsaved}
              >
                <Trash2 className="w-3.5 h-3.5" aria-label="Discard" />
              </Button>
            </Tooltip>
          </div>
        )}
      </div>
    </header>
  );
};
