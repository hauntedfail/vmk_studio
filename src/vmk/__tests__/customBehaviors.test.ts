import { describe, it, expect } from "vitest";
import {
  classifyBehavior,
  isProtectedBinding,
  decodeHidUsageWithMods,
  encodeHidUsageWithMods,
  diffKeymapAgainstSnapshot,
  formatShortBindingSummary,
} from "../customBehaviors";
import type { CustomBehaviorDef, StudioSnapshot } from "../types";
import type { GetBehaviorDetailsResponse } from "@zmkfirmware/zmk-studio-ts-client/behaviors";
import type { Keymap } from "@zmkfirmware/zmk-studio-ts-client/keymap";

const CUSTOM_DEFS: CustomBehaviorDef[] = [
  {
    nodeName: "cg_toggle",
    label: "cg_toggle",
    compatible: "zmk,behavior-cg-toggle",
    bindingCells: 0,
    displayName: "Toggle Ctrl GUI",
    sourceFile: "dts/cg_toggle.dtsi",
    properties: { "toggle-mode": "flip" },
  },
  {
    nodeName: "cg_smart_zoom",
    label: "cg_smart_zoom",
    compatible: "zmk,behavior-cg-zoom",
    bindingCells: 0,
    displayName: "Smart Zoom",
    sourceFile: "dts/cg_toggle.dtsi",
    properties: { direction: "smart" },
  },
];

const BEHAVIORS: Record<number, GetBehaviorDetailsResponse> = {
  8: { id: 8, displayName: "Key Press", metadata: [] },
  15: { id: 15, displayName: "Mod-Tap", metadata: [] },
  24: { id: 24, displayName: "Studio Unlock", metadata: [] },
  25: { id: 25, displayName: "Bootloader", metadata: [] },
  27: { id: 27, displayName: "Toggle Ctrl GUI", metadata: [] },
  28: { id: 28, displayName: "Smart Zoom", metadata: [] },
  99: { id: 99, displayName: "My Mystery Behavior", metadata: [] },
};

describe("customBehaviors", () => {
  it("classifies custom, safety, stock, and unknown behaviors", () => {
    expect(classifyBehavior(BEHAVIORS[27], CUSTOM_DEFS).kind).toBe("custom");
    expect(classifyBehavior(BEHAVIORS[24], CUSTOM_DEFS).kind).toBe("safety");
    expect(classifyBehavior(BEHAVIORS[25], CUSTOM_DEFS).kind).toBe("safety");
    expect(classifyBehavior(BEHAVIORS[8], CUSTOM_DEFS).kind).toBe("stock");
    expect(classifyBehavior(BEHAVIORS[99], CUSTOM_DEFS).kind).toBe("custom");
    expect(classifyBehavior(undefined, CUSTOM_DEFS).kind).toBe("unknown");
  });

  it("protects custom, safety, and unknown bindings from silent overwrite", () => {
    expect(
      isProtectedBinding({ behaviorId: 27, param1: 0, param2: 0 }, BEHAVIORS, CUSTOM_DEFS)
        .protected
    ).toBe(true);
    expect(
      isProtectedBinding({ behaviorId: 24, param1: 0, param2: 0 }, BEHAVIORS, CUSTOM_DEFS)
        .protected
    ).toBe(true);
    expect(
      isProtectedBinding({ behaviorId: 999, param1: 0, param2: 0 }, BEHAVIORS, CUSTOM_DEFS)
        .protected
    ).toBe(true);
    expect(
      isProtectedBinding({ behaviorId: 8, param1: 0x070004, param2: 0 }, BEHAVIORS, CUSTOM_DEFS)
        .protected
    ).toBe(false);
  });

  it("handles unsigned RightGUI bit-31 modifiers without sign corruption", () => {
    const baseA = (7 << 16) | 4; // Keyboard A
    const encoded = encodeHidUsageWithMods(baseA, 0x80 | 0x01); // RGUI + LCTRL
    expect(encoded).toBeGreaterThan(0);
    const decoded = decodeHidUsageWithMods(encoded);
    expect(decoded.page).toBe(7);
    expect(decoded.id).toBe(4);
    expect(decoded.modMask).toBe(0x81);
    expect(decoded.modLabels).toEqual(["L⌃", "R⌘"]);
  });

  it("diffs live keymap against saved StudioSnapshot", () => {
    const live: Keymap = {
      availableLayers: 2,
      maxLayerNameLength: 16,
      layers: [
        {
          id: 0,
          name: "BASE",
          bindings: [
            { behaviorId: 8, param1: 0x070004, param2: 0 },
            { behaviorId: 27, param1: 0, param2: 0 },
          ],
        },
      ],
    };

    const snap: StudioSnapshot = {
      device: "Toucan",
      behavior_ids: [8, 27],
      layers: [
        {
          id: 0,
          name: "BASE",
          bindings: [
            { behavior_id: 8, param1: 0x070004, param2: 0 },
            { behavior_id: 8, param1: 0x070005, param2: 0 },
          ],
        },
      ],
    };

    const diffs = diffKeymapAgainstSnapshot(live, snap);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].keyPosition).toBe(1);
    expect(diffs[0].current.behaviorId).toBe(27);
    expect(diffs[0].baseline?.behaviorId).toBe(8);
  });

  it("formats concise summary for Mod-Tap and custom behaviors", () => {
    const mt = formatShortBindingSummary(
      { behaviorId: 15, param1: (7 << 16) | 0xe3, param2: (7 << 16) | 0x2a },
      BEHAVIORS,
      [{ id: 0, name: "BASE" }]
    );
    expect(mt.primary).toBeTruthy();
    expect(mt.secondary).toBeTruthy();

    const cg = formatShortBindingSummary(
      { behaviorId: 27, param1: 0, param2: 0 },
      BEHAVIORS,
      [{ id: 0, name: "BASE" }]
    );
    expect(cg.primary).toBe("Toggle Ctrl GUI");
  });
});
