import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { auditEndpointSwapBindings } from "../endpointAudit";
import {
  isToucanSplitLayout,
  TOUCAN_CANVAS_PAD_X,
  TOUCAN_CANVAS_PAD_Y,
  TOUCAN_RIGHT_HALF_SHIFT_U,
  transformToucanKeyRect,
} from "../toucanLayout";
import { parseKeymapLayers } from "../dtsParser";
import type { RepoKeymapLayer } from "../types";

describe("Toucan 2 endpoint swap audit & hardware canvas detection", () => {
  it("maps USB and BLE 0..4 switch keys plus cg_toggle bindings across layers", () => {
    const layers: RepoKeymapLayer[] = [
      {
        id: "base",
        displayName: "BASE",
        bindings: ["&kp TAB", "&cg_toggle", "&cg_back", "&cg_forward"],
      },
      {
        id: "nav",
        displayName: "NAV",
        bindings: [
          "&out OUT_USB",
          "&bt BT_SEL 0",
          "&bt BT_SEL 1",
          "&bt BT_SEL 4",
          "&out OUT_TOG",
          "&cg_toggle_on",
        ],
      },
      {
        id: "extra_2",
        displayName: "extra_2",
        bindings: [],
        reserved: true,
      },
    ];

    const audit = auditEndpointSwapBindings(layers);
    expect(audit.endpoints).toHaveLength(6);
    expect(audit.endpoints[0].id).toBe("usb");
    expect(audit.endpoints[0].switchBindings).toHaveLength(1);
    expect(audit.endpoints[1].switchBindings[0]).toMatchObject({
      layerName: "NAV",
      keyPosition: 1,
      binding: "&bt BT_SEL 0",
    });
    expect(audit.endpoints[2].switchBindings[0].binding).toBe("&bt BT_SEL 1");
    expect(audit.endpoints[5].switchBindings[0].binding).toBe("&bt BT_SEL 4");
    expect(audit.genericSwitchBindings).toHaveLength(1);
    expect(audit.cgToggleBindings.map((b) => b.binding)).toEqual([
      "&cg_toggle",
      "&cg_toggle_on",
    ]);
    expect(audit.osAwareBindings.map((b) => b.binding)).toEqual([
      "&cg_back",
      "&cg_forward",
    ]);
  });

  it("detects Toucan 2 42-key split layout and rejects non-Toucan layouts", () => {
    const toucanKeys = [
      // 21 left keys (x: 0..5.5)
      ...Array.from({ length: 18 }, (_, i) => ({
        x: i % 6,
        y: Math.floor(i / 6),
        width: 1,
        height: 1,
      })),
      { x: 3.5, y: 3.12, width: 1, height: 1 },
      { x: 4.5, y: 3.12, width: 1, height: 1 },
      { x: 5.48, y: 3.28, width: 1, height: 1 },
      // 21 right keys (x: 7.52..13)
      ...Array.from({ length: 18 }, (_, i) => ({
        x: 8 + (i % 6),
        y: Math.floor(i / 6),
        width: 1,
        height: 1,
      })),
      { x: 7.52, y: 3.28, width: 1, height: 1 },
      { x: 8.5, y: 3.12, width: 1, height: 1 },
      { x: 9.5, y: 3.12, width: 1, height: 1 },
    ];

    expect(isToucanSplitLayout(toucanKeys)).toBe(true);
    expect(isToucanSplitLayout(toucanKeys.slice(0, 36))).toBe(false);

    // Verify transformToucanKeyRect shifts only the right half to fit LCD + tilted TPS43 trackpad
    const leftT = transformToucanKeyRect({ x: 5, y: 0.24, width: 1, height: 1 });
    const rightY = transformToucanKeyRect({ x: 8, y: 0.24, width: 1, height: 1 });
    expect(leftT.x).toBeCloseTo(5 + TOUCAN_CANVAS_PAD_X, 5);
    expect(leftT.y).toBeCloseTo(0.24 + TOUCAN_CANVAS_PAD_Y, 5);
    expect(rightY.x).toBeCloseTo(8 + TOUCAN_CANVAS_PAD_X + TOUCAN_RIGHT_HALF_SHIFT_U, 5);
    expect(rightY.x - (leftT.x + 1)).toBeGreaterThan(5.0);
    expect(
      isToucanSplitLayout(
        Array.from({ length: 42 }, (_, i) => ({
          x: i % 12,
          y: Math.floor(i / 12),
          width: 1,
          height: 1,
        }))
      )
    ).toBe(false);
  });

  it("audits real Toucan 2 keymap and toucan.json layout when repo is present", () => {
    const repo =
      "/Users/vvx/Documents/deepseek-harness/default-workspace/toucan2-cg-toggle";
    if (!fs.existsSync(repo)) return;

    const keymap = fs.readFileSync(path.join(repo, "config/toucan.keymap"), "utf8");
    const layers = parseKeymapLayers(keymap);
    const audit = auditEndpointSwapBindings(layers);

    // NAV layer maps BT_SEL 0..4 on keys 13..17
    for (let i = 0; i < 5; i += 1) {
      expect(audit.endpoints[i + 1].switchBindings).toHaveLength(1);
      expect(audit.endpoints[i + 1].switchBindings[0].layerName).toBe("NAV");
    }

    const json = JSON.parse(
      fs.readFileSync(path.join(repo, "config/toucan.json"), "utf8")
    );
    const layout = json.layouts["Default Layout"].layout.map(
      (k: { x: number; y: number; w?: number; h?: number }) => ({
        x: k.x,
        y: k.y,
        width: k.w ?? 1,
        height: k.h ?? 1,
      })
    );
    expect(isToucanSplitLayout(layout)).toBe(true);
  });
});
