import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  parseDtsBindingExpr,
  formatDtsBindingExpr,
  parseConditionalLayers,
  parseCombos,
  updateRepoKeymapSource,
  upsertCustomBehaviorNode,
  deleteCustomBehaviorNode,
} from "../keymapCodec";
import { parseCustomBehaviors, parseKeymapLayers } from "../dtsParser";

const SAMPLE_KEYMAP = `#include <behaviors.dtsi>
#include <dt-bindings/zmk/keys.h>

/ {
    conditional_layers {
        compatible = "zmk,conditional-layers";
        tri_layer {
            if-layers = <1 2>;
            then-layer = <3>;
        };
    };

    keymap {
        compatible = "zmk,keymap";

        base {
            display-name = "BASE";
            bindings = <
                &kp TAB &kp Q &kp W &kp E &kp R &kp T   &kp Y &kp U &kp I &kp O &kp P &kp BSPC
                &kp LCTRL &kp A &kp S &kp D &kp F &kp G &kp H &kp J &kp K &kp L &kp SEMI &kp SQT
                &kp LSHFT &kp Z &kp X &kp C &kp V &kp B &kp N &kp M &kp COMMA &kp DOT &kp FSLH &kp ESC
                                &kp LGUI &mo 1 &kp SPACE &kp RET &mo 2 &kp RALT
            >;
        };

        extra_2 {
            status = "reserved";
        };
    };
};

/* preserve me */
&mt {
    quick-tap-ms = <200>;
};
`;

const SAMPLE_CG_DTSI = `/ {
    behaviors {
        cg_toggle: cg_toggle {
            compatible = "zmk,behavior-cg-toggle";
            #binding-cells = <0>;
            toggle-mode = "flip";
            display-name = "Toggle Ctrl GUI";
        };
    };
};
`;

describe("keymapCodec", () => {
  it("parses and formats DTS binding expressions including nested modifiers", () => {
    const p1 = parseDtsBindingExpr("&kp LC(LG(UP))");
    expect(p1.behavior).toBe("&kp");
    expect(p1.params).toEqual(["LC(LG(UP))"]);

    const p2 = parseDtsBindingExpr("&mt LGUI BSPC");
    expect(p2.behavior).toBe("&mt");
    expect(p2.params).toEqual(["LGUI", "BSPC"]);

    expect(formatDtsBindingExpr("&cg_toggle", [])).toBe("&cg_toggle");
    expect(formatDtsBindingExpr("&bt", ["BT_SEL", "0"])).toBe("&bt BT_SEL 0");
  });

  it("updates keymap layers, conditional layers, and combos while preserving includes and &mt block", () => {
    const layers = parseKeymapLayers(SAMPLE_KEYMAP);
    expect(layers).toHaveLength(2);
    layers[0].bindings[0] = "&cg_toggle";
    layers[0].bindings[1] = "&mt LGUI BSPC";
    layers[1] = {
      id: "extra_2",
      displayName: "CUSTOM",
      bindings: Array(42).fill("&trans"),
      reserved: false,
    };
    layers[1].bindings[0] = "&cg_smart_zoom";

    const updated = updateRepoKeymapSource(SAMPLE_KEYMAP, {
      layers,
      conditionalLayers: [{ name: "tri_layer", ifLayers: [1, 2], thenLayer: 3 }],
      combos: [
        {
          name: "combo_esc",
          timeoutMs: 40,
          keyPositions: [1, 2],
          bindings: "&kp ESC",
          layers: [0],
        },
      ],
    });

    expect(updated).toContain("#include <behaviors.dtsi>");
    expect(updated).toContain("/* preserve me */");
    expect(updated).toContain("quick-tap-ms = <200>;");

    const reparsedLayers = parseKeymapLayers(updated);
    expect(reparsedLayers).toHaveLength(2);
    expect(reparsedLayers[0].bindings[0]).toBe("&cg_toggle");
    expect(reparsedLayers[0].bindings[1]).toBe("&mt LGUI BSPC");
    expect(reparsedLayers[1].displayName).toBe("CUSTOM");
    expect(reparsedLayers[1].reserved).toBeUndefined();
    expect(reparsedLayers[1].bindings[0]).toBe("&cg_smart_zoom");

    const conds = parseConditionalLayers(updated);
    expect(conds).toEqual([{ name: "tri_layer", ifLayers: [1, 2], thenLayer: 3 }]);

    const combos = parseCombos(updated);
    expect(combos).toHaveLength(1);
    expect(combos[0]).toMatchObject({
      name: "combo_esc",
      timeoutMs: 40,
      keyPositions: [1, 2],
      bindings: "&kp ESC",
      layers: [0],
    });
  });

  it("upserts and deletes custom behaviors cleanly in cg_toggle.dtsi", () => {
    const edited = upsertCustomBehaviorNode(SAMPLE_CG_DTSI, {
      label: "cg_toggle",
      nodeName: "cg_toggle",
      compatible: "zmk,behavior-cg-toggle",
      bindingCells: 0,
      displayName: "Swap Ctrl/Cmd",
      sourceFile: "dts/cg_toggle.dtsi",
      properties: { "toggle-mode": "flip" },
    });
    expect(parseCustomBehaviors(edited, "dts/cg_toggle.dtsi")[0].displayName).toBe(
      "Swap Ctrl/Cmd"
    );

    const added = upsertCustomBehaviorNode(edited, {
      label: "my_macro",
      nodeName: "my_macro",
      compatible: "zmk,behavior-macro",
      bindingCells: 0,
      displayName: "My Macro",
      sourceFile: "dts/cg_toggle.dtsi",
      properties: {
        "wait-ms": "<30>",
        "tap-ms": "<30>",
        bindings: "<&kp H>, <&kp I>",
      },
    });
    const defs = parseCustomBehaviors(added, "dts/cg_toggle.dtsi");
    expect(defs.map((d) => d.label)).toEqual(["cg_toggle", "my_macro"]);

    const deleted = deleteCustomBehaviorNode(added, "my_macro");
    expect(parseCustomBehaviors(deleted, "dts/cg_toggle.dtsi").map((d) => d.label)).toEqual([
      "cg_toggle",
    ]);
  });

  it("parses real Toucan 2 conditional_layers cleanly", () => {
    const repo = "/Users/vvx/Documents/deepseek-harness/default-workspace/toucan2-cg-toggle";
    if (!fs.existsSync(repo)) return;
    const keymap = fs.readFileSync(path.join(repo, "config/toucan.keymap"), "utf8");
    const conds = parseConditionalLayers(keymap);
    expect(conds).toEqual([{ name: "tri_layer", ifLayers: [1, 2], thenLayer: 3 }]);
  });
});
