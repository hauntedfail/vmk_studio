import React, {
  SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { Request } from "@zmkfirmware/zmk-studio-ts-client";
import { call_rpc } from "../rpc/logging";
import {
  PhysicalLayout,
  Keymap,
  SetLayerBindingResponse,
  SetLayerPropsResponse,
  BehaviorBinding,
  Layer,
} from "@zmkfirmware/zmk-studio-ts-client/keymap";
import type { GetBehaviorDetailsResponse } from "@zmkfirmware/zmk-studio-ts-client/behaviors";

import { LayerPicker } from "./LayerPicker";
import { PhysicalLayoutPicker } from "./PhysicalLayoutPicker";
import { Keymap as KeymapComp } from "./Keymap";
import { useConnectedDeviceData } from "../rpc/useConnectedDeviceData";
import { ConnectionContext } from "../rpc/ConnectionContext";
import { UndoRedoContext } from "../undoRedo";
import { BehaviorBindingPicker } from "../behaviors/BehaviorBindingPicker";
import { produce } from "immer";
import { LockStateContext } from "../rpc/LockStateContext";
import { LockState } from "@zmkfirmware/zmk-studio-ts-client/core";
import { deserializeLayoutZoom, LayoutZoom } from "./PhysicalLayout";
import { useLocalStorageState } from "../misc/useLocalStorageState";
import type {
  CustomBehaviorDef,
  FirmwareModel,
  SnapshotSummary,
  StudioSnapshot,
} from "../vmk/types";
import type { ToucanHardwareModuleId } from "../vmk/components/ToucanHardwareModules";
import { diffKeymapAgainstSnapshot } from "../vmk/customBehaviors";
import { readSnapshot, saveSnapshot } from "../vmk/api";
import { Camera, Check, GitCompare, RotateCcw, Shield, ShieldOff } from "lucide-react";

type BehaviorMap = Record<number, GetBehaviorDetailsResponse>;

export interface KeyboardProps {
  deviceName?: string;
  customBehaviors?: CustomBehaviorDef[];
  firmwareModel?: FirmwareModel | null;
  snapshots?: SnapshotSummary[];
  backupsDir?: string;
  onSnapshotSaved?: () => Promise<void>;
  onSwitchToRepoKeymap?: () => void;
  onSelectHardwareModule?: (module: ToucanHardwareModuleId) => void;
}

function useBehaviors(): BehaviorMap {
  const connection = useContext(ConnectionContext);
  const lockState = useContext(LockStateContext);

  const [behaviors, setBehaviors] = useState<BehaviorMap>({});

  useEffect(() => {
    if (
      !connection.conn ||
      lockState != LockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED
    ) {
      setBehaviors({});
      return;
    }

    async function startRequest() {
      setBehaviors({});

      if (!connection.conn) {
        return;
      }

      const get_behaviors: Request = {
        behaviors: { listAllBehaviors: true },
        requestId: 0,
      };

      const behavior_list = await call_rpc(connection.conn, get_behaviors);
      if (!ignore) {
        const behavior_map: BehaviorMap = {};
        for (const behaviorId of behavior_list.behaviors?.listAllBehaviors
          ?.behaviors || []) {
          if (ignore) {
            break;
          }
          const details_req = {
            behaviors: { getBehaviorDetails: { behaviorId } },
            requestId: 0,
          };
          const behavior_details = await call_rpc(connection.conn, details_req);
          const dets: GetBehaviorDetailsResponse | undefined =
            behavior_details?.behaviors?.getBehaviorDetails;

          if (dets) {
            behavior_map[dets.id] = dets;
          }
        }

        if (!ignore) {
          setBehaviors(behavior_map);
        }
      }
    }

    let ignore = false;
    startRequest();

    return () => {
      ignore = true;
    };
  }, [connection, lockState]);

  return behaviors;
}

function useLayouts(): [
  PhysicalLayout[] | undefined,
  React.Dispatch<SetStateAction<PhysicalLayout[] | undefined>>,
  number,
  React.Dispatch<SetStateAction<number>>
] {
  const connection = useContext(ConnectionContext);
  const lockState = useContext(LockStateContext);

  const [layouts, setLayouts] = useState<PhysicalLayout[] | undefined>(
    undefined
  );
  const [selectedPhysicalLayoutIndex, setSelectedPhysicalLayoutIndex] =
    useState<number>(0);

  useEffect(() => {
    if (
      !connection.conn ||
      lockState != LockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED
    ) {
      setLayouts(undefined);
      return;
    }

    async function startRequest() {
      setLayouts(undefined);

      if (!connection.conn) {
        return;
      }

      const response = await call_rpc(connection.conn, {
        keymap: { getPhysicalLayouts: true },
      });

      if (!ignore) {
        setLayouts(response?.keymap?.getPhysicalLayouts?.layouts);
        setSelectedPhysicalLayoutIndex(
          response?.keymap?.getPhysicalLayouts?.activeLayoutIndex || 0
        );
      }
    }

    let ignore = false;
    startRequest();

    return () => {
      ignore = true;
    };
  }, [connection, lockState]);

  return [
    layouts,
    setLayouts,
    selectedPhysicalLayoutIndex,
    setSelectedPhysicalLayoutIndex,
  ];
}

export default function Keyboard({
  deviceName = "Toucan",
  customBehaviors = [],
  firmwareModel,
  snapshots = [],
  backupsDir,
  onSnapshotSaved,
  onSwitchToRepoKeymap,
  onSelectHardwareModule,
}: KeyboardProps) {
  const [
    layouts,
    _setLayouts,
    selectedPhysicalLayoutIndex,
    setSelectedPhysicalLayoutIndex,
  ] = useLayouts();
  const [keymap, setKeymap] = useConnectedDeviceData<Keymap>(
    { keymap: { getKeymap: true } },
    (km) => km?.keymap?.getKeymap,
    true
  );

  const [keymapScale, setKeymapScale] = useLocalStorageState<LayoutZoom>(
    "keymapScale",
    "auto",
    {
      deserialize: deserializeLayoutZoom,
    }
  );

  const [guardEnabled, setGuardEnabled] = useState(true);
  const [compareSnapshotRel, setCompareSnapshotRel] = useState<string>("");
  const [comparedSnapshot, setComparedSnapshot] = useState<StudioSnapshot | null>(null);
  const [snapshotToast, setSnapshotToast] = useState<string | null>(null);

  const [selectedLayerIndex, setSelectedLayerIndex] = useState<number>(0);
  const [selectedKeyPosition, setSelectedKeyPosition] = useState<
    number | undefined
  >(undefined);
  const behaviors = useBehaviors();

  const conn = useContext(ConnectionContext);
  const undoRedo = useContext(UndoRedoContext);

  useEffect(() => {
    setSelectedLayerIndex(0);
    setSelectedKeyPosition(undefined);
  }, [conn]);

  useEffect(() => {
    if (!compareSnapshotRel) {
      setComparedSnapshot(null);
      return;
    }
    let cancelled = false;
    readSnapshot(compareSnapshotRel, backupsDir)
      .then((snap) => {
        if (!cancelled) setComparedSnapshot(snap);
      })
      .catch(() => {
        if (!cancelled) setComparedSnapshot(null);
      });
    return () => {
      cancelled = true;
    };
  }, [compareSnapshotRel, backupsDir]);

  useEffect(() => {
    async function performSetRequest() {
      if (!conn.conn || !layouts) {
        return;
      }

      const resp = await call_rpc(conn.conn, {
        keymap: { setActivePhysicalLayout: selectedPhysicalLayoutIndex },
      });

      const new_keymap = resp?.keymap?.setActivePhysicalLayout?.ok;
      if (new_keymap) {
        setKeymap(new_keymap);
      } else {
        console.error(
          "Failed to set the active physical layout err:",
          resp?.keymap?.setActivePhysicalLayout?.err
        );
      }
    }

    performSetRequest();
  }, [selectedPhysicalLayoutIndex]);

  const doSelectPhysicalLayout = useCallback(
    (i: number) => {
      const oldLayout = selectedPhysicalLayoutIndex;
      undoRedo?.(async () => {
        setSelectedPhysicalLayoutIndex(i);

        return async () => {
          setSelectedPhysicalLayoutIndex(oldLayout);
        };
      });
    },
    [undoRedo, selectedPhysicalLayoutIndex]
  );

  const doUpdateBindingAt = useCallback(
    (layerIdx: number, keyPos: number, binding: BehaviorBinding) => {
      if (!keymap) return;
      const layerId = keymap.layers[layerIdx].id;
      const oldBinding = keymap.layers[layerIdx].bindings[keyPos];

      undoRedo?.(async () => {
        if (!conn.conn) {
          throw new Error("Not connected");
        }

        const resp = await call_rpc(conn.conn, {
          keymap: { setLayerBinding: { layerId, keyPosition: keyPos, binding } },
        });

        if (
          resp.keymap?.setLayerBinding ===
          SetLayerBindingResponse.SET_LAYER_BINDING_RESP_OK
        ) {
          setKeymap(
            produce((draft: any) => {
              draft.layers[layerIdx].bindings[keyPos] = binding;
            })
          );
        } else {
          console.error("Failed to set binding", resp.keymap?.setLayerBinding);
        }

        return async () => {
          if (!conn.conn) {
            return;
          }

          const undoResp = await call_rpc(conn.conn, {
            keymap: {
              setLayerBinding: { layerId, keyPosition: keyPos, binding: oldBinding },
            },
          });
          if (
            undoResp.keymap?.setLayerBinding ===
            SetLayerBindingResponse.SET_LAYER_BINDING_RESP_OK
          ) {
            setKeymap(
              produce((draft: any) => {
                draft.layers[layerIdx].bindings[keyPos] = oldBinding;
              })
            );
          }
        };
      });
    },
    [conn, keymap, undoRedo]
  );

  const doUpdateBinding = useCallback(
    (binding: BehaviorBinding) => {
      if (!keymap || selectedKeyPosition === undefined) {
        return;
      }
      doUpdateBindingAt(selectedLayerIndex, selectedKeyPosition, binding);
    },
    [keymap, selectedLayerIndex, selectedKeyPosition, doUpdateBindingAt]
  );

  const selectedBinding = useMemo(() => {
    if (
      keymap == null ||
      selectedKeyPosition == null ||
      !keymap.layers[selectedLayerIndex]
    ) {
      return null;
    }

    return keymap.layers[selectedLayerIndex].bindings[selectedKeyPosition];
  }, [keymap, selectedLayerIndex, selectedKeyPosition]);

  const allDiffs = useMemo(() => {
    if (!keymap || !comparedSnapshot) return [];
    return diffKeymapAgainstSnapshot(keymap, comparedSnapshot);
  }, [keymap, comparedSnapshot]);

  const currentLayerDiffPositions = useMemo(() => {
    const set = new Set<number>();
    for (const d of allDiffs) {
      if (d.layerIndex === selectedLayerIndex) set.add(d.keyPosition);
    }
    return set;
  }, [allDiffs, selectedLayerIndex]);

  const selectedSnapshotBaseline = useMemo(() => {
    if (selectedKeyPosition === undefined || !comparedSnapshot || !keymap) {
      return undefined;
    }
    const curLayer = keymap.layers[selectedLayerIndex];
    if (!curLayer) return undefined;
    const snapLayer =
      comparedSnapshot.layers.find((l) => l.id === curLayer.id) ??
      comparedSnapshot.layers[selectedLayerIndex];
    const b = snapLayer?.bindings[selectedKeyPosition];
    if (!b) return undefined;
    return {
      behaviorId: b.behavior_id,
      param1: b.param1,
      param2: b.param2,
    };
  }, [selectedKeyPosition, comparedSnapshot, keymap, selectedLayerIndex]);

  const handleSaveSnapshot = async () => {
    if (!keymap) return;
    const note = window.prompt("Optional note for this live keymap snapshot:", "before-edit");
    if (note === null) return;

    const behaviorSummaries: StudioSnapshot["behaviors"] = {};
    for (const [idStr, b] of Object.entries(behaviors)) {
      behaviorSummaries[Number(idStr)] = {
        id: b.id,
        displayName: b.displayName,
      };
    }

    const snap: StudioSnapshot = {
      device: deviceName,
      saved_at: new Date().toISOString(),
      note: note.trim() || undefined,
      behavior_ids: Object.keys(behaviors).map(Number),
      behaviors: behaviorSummaries,
      layers: keymap.layers.map((l) => ({
        id: l.id,
        name: l.name,
        bindings: l.bindings.map((b) => ({
          behavior_id: b.behaviorId,
          param1: b.param1,
          param2: b.param2,
        })),
      })),
    };

    try {
      const saved = await saveSnapshot(note.trim() || "live", snap, backupsDir);
      setSnapshotToast(`Saved ${saved.name}`);
      await onSnapshotSaved?.();
      window.setTimeout(() => setSnapshotToast(null), 4000);
    } catch (e) {
      window.alert(`Failed to save snapshot: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleRestoreLayerFromSnapshot = async () => {
    if (!keymap || !comparedSnapshot) return;
    const diffsOnLayer = allDiffs.filter((d) => d.layerIndex === selectedLayerIndex && d.baseline);
    if (diffsOnLayer.length === 0) return;
    const ok = window.confirm(
      `Restore ${diffsOnLayer.length} differing key(s) on layer "${keymap.layers[selectedLayerIndex].name}" from snapshot?`
    );
    if (!ok) return;
    for (const d of diffsOnLayer) {
      if (d.baseline) {
        doUpdateBindingAt(selectedLayerIndex, d.keyPosition, d.baseline);
      }
    }
  };

  const moveLayer = useCallback(
    (start: number, end: number) => {
      const doMove = async (startIndex: number, destIndex: number) => {
        if (!conn.conn) {
          return;
        }

        const resp = await call_rpc(conn.conn, {
          keymap: { moveLayer: { startIndex, destIndex } },
        });

        if (resp.keymap?.moveLayer?.ok) {
          setKeymap(resp.keymap?.moveLayer?.ok);
          setSelectedLayerIndex(destIndex);
        } else {
          console.error("Error moving", resp);
        }
      };

      undoRedo?.(async () => {
        await doMove(start, end);
        return () => doMove(end, start);
      });
    },
    [undoRedo, conn]
  );

  const addLayer = useCallback(() => {
    async function doAdd(): Promise<number> {
      if (!conn.conn || !keymap) {
        throw new Error("Not connected");
      }

      const resp = await call_rpc(conn.conn, { keymap: { addLayer: {} } });

      if (resp.keymap?.addLayer?.ok) {
        const newSelection = keymap.layers.length;
        setKeymap(
          produce((draft: any) => {
            draft.layers.push(resp.keymap!.addLayer!.ok!.layer);
            draft.availableLayers--;
          })
        );

        setSelectedLayerIndex(newSelection);

        return resp.keymap.addLayer.ok.index;
      } else {
        throw new Error("Failed to add layer:" + resp.keymap?.addLayer?.err);
      }
    }

    async function doRemove(layerIndex: number) {
      if (!conn.conn) {
        throw new Error("Not connected");
      }

      const resp = await call_rpc(conn.conn, {
        keymap: { removeLayer: { layerIndex } },
      });

      if (resp.keymap?.removeLayer?.ok) {
        setKeymap(
          produce((draft: any) => {
            draft.layers.splice(layerIndex, 1);
            draft.availableLayers++;
          })
        );
      } else {
        throw new Error(
          "Failed to remove layer:" + resp.keymap?.removeLayer?.err
        );
      }
    }

    undoRedo?.(async () => {
      const index = await doAdd();
      return () => doRemove(index);
    });
  }, [conn, undoRedo, keymap]);

  const removeLayer = useCallback(() => {
    async function doRemove(layerIndex: number): Promise<void> {
      if (!conn.conn || !keymap) {
        throw new Error("Not connected");
      }

      const resp = await call_rpc(conn.conn, {
        keymap: { removeLayer: { layerIndex } },
      });

      if (resp.keymap?.removeLayer?.ok) {
        if (layerIndex == keymap.layers.length - 1) {
          setSelectedLayerIndex(layerIndex - 1);
        }
        setKeymap(
          produce((draft: any) => {
            draft.layers.splice(layerIndex, 1);
            draft.availableLayers++;
          })
        );
      } else {
        throw new Error(
          "Failed to remove layer:" + resp.keymap?.removeLayer?.err
        );
      }
    }

    async function doRestore(layerId: number, atIndex: number) {
      if (!conn.conn) {
        throw new Error("Not connected");
      }

      const resp = await call_rpc(conn.conn, {
        keymap: { restoreLayer: { layerId, atIndex } },
      });

      if (resp.keymap?.restoreLayer?.ok) {
        setKeymap(
          produce((draft: any) => {
            draft.layers.splice(atIndex, 0, resp!.keymap!.restoreLayer!.ok);
            draft.availableLayers--;
          })
        );
        setSelectedLayerIndex(atIndex);
      } else {
        throw new Error(
          "Failed to restore layer:" + resp.keymap?.restoreLayer?.err
        );
      }
    }

    if (!keymap) {
      throw new Error("No keymap loaded");
    }

    const index = selectedLayerIndex;
    const layerId = keymap.layers[index].id;
    undoRedo?.(async () => {
      await doRemove(index);
      return () => doRestore(layerId, index);
    });
  }, [conn, undoRedo, selectedLayerIndex, keymap]);

  const changeLayerName = useCallback(
    (id: number, oldName: string, newName: string) => {
      async function changeName(layerId: number, name: string) {
        if (!conn.conn) {
          throw new Error("Not connected");
        }

        const resp = await call_rpc(conn.conn, {
          keymap: { setLayerProps: { layerId, name } },
        });

        if (
          resp.keymap?.setLayerProps ==
          SetLayerPropsResponse.SET_LAYER_PROPS_RESP_OK
        ) {
          setKeymap(
            produce((draft: any) => {
              const layer_index = draft.layers.findIndex(
                (l: Layer) => l.id == layerId
              );
              draft.layers[layer_index].name = name;
            })
          );
        } else {
          throw new Error(
            "Failed to change layer name:" + resp.keymap?.setLayerProps
          );
        }
      }

      undoRedo?.(async () => {
        await changeName(id, newName);
        return async () => {
          await changeName(id, oldName);
        };
      });
    },
    [conn, undoRedo, keymap]
  );

  useEffect(() => {
    if (!keymap?.layers) return;

    const layers = keymap.layers.length - 1;

    if (selectedLayerIndex > layers) {
      setSelectedLayerIndex(layers);
    }
  }, [keymap, selectedLayerIndex]);

  return (
    <div className="h-full grid grid-cols-[220px_1fr] grid-rows-[auto_1fr_minmax(10.5em,auto)] bg-base-300 max-w-full min-w-0 min-h-0 overflow-hidden">
      {/* VMK Safety & Snapshot Toolbar */}
      <div className="col-span-2 flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 bg-base-200 border-b border-base-300 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          {onSwitchToRepoKeymap && (
            <button
              type="button"
              onClick={onSwitchToRepoKeymap}
              className="px-2.5 py-1 rounded bg-base-300 hover:bg-base-100 text-xs font-medium"
            >
              Visual Repo Keymap (toucan.keymap)
            </button>
          )}
          <button
            type="button"
            onClick={() => setGuardEnabled((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-medium transition-colors ${
              guardEnabled
                ? "bg-emerald-950/40 border-emerald-500/45 text-emerald-300"
                : "bg-base-300 border-base-content/15 text-base-content/70"
            }`}
            title="Prevents accidental overwrite of custom firmware behaviors and safety keys"
          >
            {guardEnabled ? (
              <Shield className="w-3.5 h-3.5" />
            ) : (
              <ShieldOff className="w-3.5 h-3.5" />
            )}
            Custom Overwrite Guard: {guardEnabled ? "ON" : "OFF"}
          </button>

          <button
            type="button"
            disabled={!keymap}
            onClick={handleSaveSnapshot}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-base-300 hover:bg-base-100 text-xs font-medium disabled:opacity-40"
          >
            <Camera className="w-3.5 h-3.5" />
            Save Snapshot
          </button>

          {snapshotToast && (
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <Check className="w-3.5 h-3.5" />
              {snapshotToast}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <GitCompare className="w-3.5 h-3.5 opacity-60" />
          <select
            value={compareSnapshotRel}
            onChange={(e) => setCompareSnapshotRel(e.target.value)}
            className="h-7 px-2 rounded bg-base-100 border border-base-300 text-xs max-w-[240px]"
          >
            <option value="">Compare against snapshot...</option>
            {snapshots.map((s) => (
              <option key={s.relPath} value={s.relPath}>
                {s.relPath}
              </option>
            ))}
          </select>

          {comparedSnapshot && (
            <span className="px-2 py-0.5 rounded bg-sky-950/50 border border-sky-400/40 text-sky-300 text-2xs font-mono">
              {allDiffs.length} diff(s)
            </span>
          )}

          {currentLayerDiffPositions.size > 0 && (
            <button
              type="button"
              onClick={handleRestoreLayerFromSnapshot}
              className="flex items-center gap-1 px-2 py-1 rounded bg-sky-600/25 hover:bg-sky-600/40 border border-sky-400/40 text-sky-200 text-2xs font-medium"
            >
              <RotateCcw className="w-3 h-3" />
              Restore Layer ({currentLayerDiffPositions.size})
            </button>
          )}
        </div>
      </div>

      {/* Left Sidebar: Layouts & Layers */}
      <div className="p-2.5 flex flex-col gap-3 bg-base-200 border-r border-base-300 row-span-2 overflow-y-auto">
        {layouts && (
          <PhysicalLayoutPicker
            layouts={layouts}
            selectedPhysicalLayoutIndex={selectedPhysicalLayoutIndex}
            onPhysicalLayoutClicked={doSelectPhysicalLayout}
          />
        )}

        {keymap && (
          <LayerPicker
            layers={keymap.layers}
            selectedLayerIndex={selectedLayerIndex}
            onLayerClicked={setSelectedLayerIndex}
            onLayerMoved={moveLayer}
            canAdd={(keymap.availableLayers || 0) > 0}
            canRemove={(keymap.layers?.length || 0) > 1}
            onAddClicked={addLayer}
            onRemoveClicked={removeLayer}
            onLayerNameChanged={changeLayerName}
          />
        )}

        <div className="mt-auto pt-2 border-t border-base-300 text-2xs space-y-1 opacity-75">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            Custom firmware behavior
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            Safety key (Unlock / Boot)
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-sky-400" />
            Differs from snapshot
          </div>
        </div>
      </div>

      {/* Main Visual Keymap */}
      {layouts && keymap && behaviors ? (
        <div className="vmk-stage-mat p-4 col-start-2 row-start-2 grid items-center justify-center relative min-w-0 min-h-0 overflow-hidden">
          <KeymapComp
            keymap={keymap}
            layout={layouts[selectedPhysicalLayoutIndex]}
            behaviors={behaviors}
            customBehaviors={customBehaviors}
            diffPositions={currentLayerDiffPositions}
            scale={keymapScale}
            selectedLayerIndex={selectedLayerIndex}
            selectedKeyPosition={selectedKeyPosition}
            onKeyPositionClicked={setSelectedKeyPosition}
            toucanHardware={{
              firmwareModel,
              onSelectModule: onSelectHardwareModule,
            }}
          />
          <select
            className="absolute top-3 right-3 h-7 rounded-lg px-2 text-xs bg-surface border border-border text-foreground"
            value={keymapScale}
            onChange={(e) => {
              const value = deserializeLayoutZoom(e.target.value);
              setKeymapScale(value);
            }}
          >
            <option value="auto">Auto</option>
            <option value={0.5}>50%</option>
            <option value={0.75}>75%</option>
            <option value={1}>100%</option>
            <option value={1.25}>125%</option>
            <option value={1.5}>150%</option>
          </select>
        </div>
      ) : (
        <div className="col-start-2 row-start-2 flex items-center justify-center text-sm opacity-70">
          Waiting for keyboard unlock / keymap data...
        </div>
      )}

      {/* Bottom Key Binding Editor */}
      <div className="p-3 col-start-2 row-start-3 bg-base-200 border-t border-base-300 overflow-y-auto">
        {keymap && selectedBinding ? (
          <BehaviorBindingPicker
            binding={selectedBinding}
            behaviors={Object.values(behaviors)}
            customBehaviors={customBehaviors}
            guardEnabled={guardEnabled}
            keyPosition={selectedKeyPosition}
            snapshotBaseline={selectedSnapshotBaseline}
            onRestoreFromSnapshot={doUpdateBinding}
            layers={keymap.layers.map(({ id, name }, li) => ({
              id,
              name: name || li.toLocaleString(),
            }))}
            onBindingChanged={doUpdateBinding}
          />
        ) : (
          <div className="text-xs opacity-65">
            Select a key above to edit its binding. Custom firmware behaviors are automatically protected by the Custom Overwrite Guard.
          </div>
        )}
      </div>
    </div>
  );
}
