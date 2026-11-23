import { useEffect, useMemo, useState } from "react";

import {
  GetBehaviorDetailsResponse,
  BehaviorBindingParametersSet,
} from "@zmkfirmware/zmk-studio-ts-client/behaviors";
import { BehaviorBinding } from "@zmkfirmware/zmk-studio-ts-client/keymap";
import { BehaviorParametersPicker } from "./BehaviorParametersPicker";
import { validateValue } from "./parameters";
import type { CustomBehaviorDef } from "../vmk/types";
import {
  classifyBehavior,
  formatHex,
  isProtectedBinding,
} from "../vmk/customBehaviors";
import { Code2, Lock, RotateCcw, ShieldAlert, Sparkles, Unlock } from "lucide-react";

export interface BehaviorBindingPickerProps {
  binding: BehaviorBinding;
  behaviors: GetBehaviorDetailsResponse[];
  customBehaviors?: CustomBehaviorDef[];
  guardEnabled?: boolean;
  keyPosition?: number;
  snapshotBaseline?: BehaviorBinding;
  onRestoreFromSnapshot?: (binding: BehaviorBinding) => void;
  layers: { id: number; name: string }[];
  onBindingChanged: (binding: BehaviorBinding) => void;
}

function validateBinding(
  metadata: BehaviorBindingParametersSet[],
  layerIds: number[],
  param1?: number,
  param2?: number
): boolean {
  if (
    (param1 === undefined || param1 === 0) &&
    metadata.every((s) => !s.param1 || s.param1.length === 0)
  ) {
    return true;
  }

  const matchingSet = metadata.find((s) =>
    validateValue(layerIds, param1, s.param1)
  );

  if (!matchingSet) {
    return false;
  }

  return validateValue(layerIds, param2, matchingSet.param2);
}

export const BehaviorBindingPicker = ({
  binding,
  layers,
  behaviors,
  customBehaviors = [],
  guardEnabled = true,
  keyPosition,
  snapshotBaseline,
  onRestoreFromSnapshot,
  onBindingChanged,
}: BehaviorBindingPickerProps) => {
  const [behaviorId, setBehaviorId] = useState(binding.behaviorId);
  const [param1, setParam1] = useState<number | undefined>(binding.param1);
  const [param2, setParam2] = useState<number | undefined>(binding.param2);
  const [unlockedForEdit, setUnlockedForEdit] = useState(false);
  const [showRawInspector, setShowRawInspector] = useState(false);
  const [rawBehaviorId, setRawBehaviorId] = useState(String(binding.behaviorId));
  const [rawParam1, setRawParam1] = useState(String(binding.param1 >>> 0));
  const [rawParam2, setRawParam2] = useState(String(binding.param2 >>> 0));

  const behaviorMap = useMemo(() => {
    const map: Record<number, GetBehaviorDetailsResponse> = {};
    for (const b of behaviors) map[b.id] = b;
    return map;
  }, [behaviors]);

  const protection = useMemo(
    () => isProtectedBinding(binding, behaviorMap, customBehaviors),
    [binding, behaviorMap, customBehaviors]
  );

  const isLocked = guardEnabled && protection.protected && !unlockedForEdit;

  const metadata = useMemo(
    () => behaviors.find((b) => b.id == behaviorId)?.metadata,
    [behaviorId, behaviors]
  );

  const groupedBehaviors = useMemo(() => {
    const sorted = [...behaviors].sort((a, b) =>
      a.displayName.localeCompare(b.displayName)
    );
    const custom: GetBehaviorDetailsResponse[] = [];
    const safety: GetBehaviorDetailsResponse[] = [];
    const stock: GetBehaviorDetailsResponse[] = [];
    for (const b of sorted) {
      const cls = classifyBehavior(b, customBehaviors);
      if (cls.kind === "custom") custom.push(b);
      else if (cls.kind === "safety") safety.push(b);
      else stock.push(b);
    }
    return { custom, safety, stock };
  }, [behaviors, customBehaviors]);

  // Reset local editor state & re-engage guard whenever selected key/binding changes
  useEffect(() => {
    setBehaviorId(binding.behaviorId);
    setParam1(binding.param1);
    setParam2(binding.param2);
    setRawBehaviorId(String(binding.behaviorId));
    setRawParam1(String(binding.param1 >>> 0));
    setRawParam2(String(binding.param2 >>> 0));
    setUnlockedForEdit(false);
  }, [binding, keyPosition]);

  // Auto-commit valid changes ONLY when not locked by the custom guard and not in raw mode
  useEffect(() => {
    if (isLocked || showRawInspector) return;
    if (
      binding.behaviorId === behaviorId &&
      binding.param1 === param1 &&
      binding.param2 === param2
    ) {
      return;
    }

    if (!metadata) {
      return;
    }

    if (
      validateBinding(
        metadata,
        layers.map(({ id }) => id),
        param1,
        param2
      )
    ) {
      onBindingChanged({
        behaviorId,
        param1: (param1 || 0) >>> 0,
        param2: (param2 || 0) >>> 0,
      });
    }
  }, [behaviorId, param1, param2, isLocked, showRawInspector]);

  const parseRawNum = (text: string): number => {
    const trimmed = text.trim();
    if (/^0x/i.test(trimmed)) return parseInt(trimmed, 16) >>> 0;
    return parseInt(trimmed, 10) >>> 0;
  };

  const applyRaw = () => {
    const nextId = parseRawNum(rawBehaviorId);
    const nextP1 = parseRawNum(rawParam1);
    const nextP2 = parseRawNum(rawParam2);
    if (Number.isNaN(nextId) || Number.isNaN(nextP1) || Number.isNaN(nextP2)) {
      return;
    }
    onBindingChanged({ behaviorId: nextId, param1: nextP1, param2: nextP2 });
  };

  const diffFromSnapshot =
    snapshotBaseline &&
    (snapshotBaseline.behaviorId !== binding.behaviorId ||
      snapshotBaseline.param1 !== binding.param1 ||
      snapshotBaseline.param2 !== binding.param2);

  return (
    <div className="flex flex-col gap-2.5">
      {/* Protection / Custom Behavior Banner */}
      {protection.protected && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-md border text-xs ${
            protection.kind === "custom"
              ? "bg-emerald-950/35 border-emerald-500/40 text-emerald-200"
              : protection.kind === "safety"
                ? "bg-amber-950/35 border-amber-500/40 text-amber-200"
                : "bg-rose-950/35 border-rose-500/40 text-rose-200"
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {protection.kind === "custom" ? (
              <Sparkles className="w-4 h-4 shrink-0 text-emerald-400" />
            ) : (
              <ShieldAlert className="w-4 h-4 shrink-0 text-amber-400" />
            )}
            <div className="truncate">
              <span className="font-semibold">
                {protection.kind === "custom"
                  ? "Custom Firmware Binding"
                  : protection.kind === "safety"
                    ? "Protected Safety Binding"
                    : "Unknown Firmware Binding"}
              </span>
              {protection.customDef && (
                <span className="ml-2 font-mono opacity-90">
                  &amp;{protection.customDef.label} ({protection.customDef.sourceFile})
                </span>
              )}
              {protection.reason && (
                <span className="ml-2 opacity-80 hidden sm:inline">
                  — {protection.reason}
                </span>
              )}
            </div>
          </div>

          {guardEnabled && (
            <button
              type="button"
              onClick={() => setUnlockedForEdit((v) => !v)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                isLocked
                  ? "bg-base-100/20 hover:bg-base-100/35 text-white"
                  : "bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-100"
              }`}
            >
              {isLocked ? (
                <>
                  <Lock className="w-3.5 h-3.5" />
                  Unlock Key to Edit
                </>
              ) : (
                <>
                  <Unlock className="w-3.5 h-3.5" />
                  Unlocked (Click to Re-lock)
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Main picker row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {keyPosition !== undefined && (
            <span className="text-xs font-mono px-2 py-1 rounded bg-base-300 text-base-content/80">
              Pos #{keyPosition}
            </span>
          )}
          <label className="text-xs font-medium opacity-80">Behavior:</label>
          <select
            value={behaviorId}
            disabled={isLocked}
            className="h-8 px-2 text-sm rounded bg-base-100 border border-base-300 disabled:opacity-50"
            onChange={(e) => {
              const nextId = parseInt(e.target.value, 10);
              setBehaviorId(nextId);
              const nextMeta = behaviors.find((b) => b.id === nextId)?.metadata;
              // Only reset params to 0 when the new behavior actually takes 0 args;
              // otherwise keep undefined so we never blast an invalid (0, 0) binding.
              const isZeroArg =
                !nextMeta ||
                nextMeta.length === 0 ||
                nextMeta.every((s) => !s.param1 || s.param1.length === 0);
              setParam1(isZeroArg ? 0 : undefined);
              setParam2(isZeroArg ? 0 : undefined);
            }}
          >
            {!behaviors.some((b) => b.id === behaviorId) && (
              <option value={behaviorId}>Unknown Behavior (#{behaviorId})</option>
            )}
            {groupedBehaviors.custom.length > 0 && (
              <optgroup label="Custom Firmware Behaviors">
                {groupedBehaviors.custom.map((b) => (
                  <option key={b.id} value={b.id}>
                    ★ {b.displayName}
                  </option>
                ))}
              </optgroup>
            )}
            {groupedBehaviors.safety.length > 0 && (
              <optgroup label="Safety & Bootloader">
                {groupedBehaviors.safety.map((b) => (
                  <option key={b.id} value={b.id}>
                    ⚠ {b.displayName}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Standard ZMK Behaviors">
              {groupedBehaviors.stock.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.displayName}
                </option>
              ))}
            </optgroup>
          </select>

          <span className="text-xs font-mono opacity-60">
            id={binding.behaviorId} p1={formatHex(binding.param1)} p2={formatHex(binding.param2)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {diffFromSnapshot && onRestoreFromSnapshot && snapshotBaseline && (
            <button
              type="button"
              onClick={() => onRestoreFromSnapshot(snapshotBaseline)}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-xs bg-sky-600/20 hover:bg-sky-600/35 border border-sky-400/40 text-sky-300"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Restore Key from Snapshot
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowRawInspector((v) => !v)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs border transition-colors ${
              showRawInspector
                ? "bg-primary/20 border-primary text-primary"
                : "bg-base-300 border-transparent hover:border-base-content/20"
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            Raw Inspector
          </button>
        </div>
      </div>

      {/* Standard parameter pickers OR Raw inspector */}
      {showRawInspector ? (
        <div className="flex flex-wrap items-end gap-3 p-2.5 rounded bg-base-300/70 border border-base-content/10 text-xs">
          <div className="flex flex-col gap-1">
            <label className="opacity-70">behaviorId</label>
            <input
              type="text"
              disabled={isLocked}
              value={rawBehaviorId}
              onChange={(e) => setRawBehaviorId(e.target.value)}
              className="h-7 w-24 px-2 font-mono rounded bg-base-100 border border-base-300 disabled:opacity-50"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="opacity-70">param1 (dec or 0xHEX)</label>
            <input
              type="text"
              disabled={isLocked}
              value={rawParam1}
              onChange={(e) => setRawParam1(e.target.value)}
              className="h-7 w-36 px-2 font-mono rounded bg-base-100 border border-base-300 disabled:opacity-50"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="opacity-70">param2 (dec or 0xHEX)</label>
            <input
              type="text"
              disabled={isLocked}
              value={rawParam2}
              onChange={(e) => setRawParam2(e.target.value)}
              className="h-7 w-36 px-2 font-mono rounded bg-base-100 border border-base-300 disabled:opacity-50"
            />
          </div>
          <button
            type="button"
            disabled={isLocked}
            onClick={applyRaw}
            className="h-7 px-3 rounded bg-primary text-primary-content font-medium disabled:opacity-40"
          >
            Apply Raw Binding
          </button>
        </div>
      ) : (
        metadata && (
          <BehaviorParametersPicker
            isDisabled={isLocked}
            metadata={metadata}
            param1={param1}
            param2={param2}
            layers={layers}
            onParam1Changed={setParam1}
            onParam2Changed={setParam2}
          />
        )
      )}
    </div>
  );
};
