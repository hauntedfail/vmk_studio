import type { RepoKeymapLayer } from "./types";
import { parseDtsBindingExpr } from "./keymapCodec";

export interface KeymapBindingRef {
  layerIndex: number;
  layerName: string;
  keyPosition: number;
  binding: string;
}

export interface EndpointSlotInfo {
  index: number;
  id: string;
  label: string;
  transport: "usb" | "ble";
  profileIndex?: number;
  switchBindings: KeymapBindingRef[];
}

export interface EndpointSwapAudit {
  endpoints: EndpointSlotInfo[];
  genericSwitchBindings: KeymapBindingRef[];
  cgToggleBindings: KeymapBindingRef[];
  osAwareBindings: KeymapBindingRef[];
}

const CG_TOGGLE_REFS = new Set(["&cg_toggle", "&cg_toggle_on", "&cg_toggle_off"]);
const OS_AWARE_REFS = new Set([
  "&cg_zoom_in",
  "&cg_zoom_out",
  "&cg_smart_zoom",
  "&cg_back",
  "&cg_forward",
]);

/**
 * Inspects config/toucan.keymap layers to map ZMK endpoints (USB + BLE 0..4)
 * and Ctrl/GUI per-endpoint swap bindings (`cg_toggle/endpoints` in src/cg_toggle.c).
 */
export function auditEndpointSwapBindings(
  layers: RepoKeymapLayer[]
): EndpointSwapAudit {
  const endpoints: EndpointSlotInfo[] = [
    {
      index: 0,
      id: "usb",
      label: "USB",
      transport: "usb",
      switchBindings: [],
    },
    ...Array.from({ length: 5 }, (_, i) => ({
      index: i + 1,
      id: `ble-${i}`,
      label: `BLE ${i}`,
      transport: "ble" as const,
      profileIndex: i,
      switchBindings: [],
    })),
  ];

  const genericSwitchBindings: KeymapBindingRef[] = [];
  const cgToggleBindings: KeymapBindingRef[] = [];
  const osAwareBindings: KeymapBindingRef[] = [];

  layers.forEach((layer, layerIndex) => {
    if (layer.reserved) return;
    const layerName = layer.displayName || layer.id || `L${layerIndex}`;
    layer.bindings.forEach((rawBinding, keyPosition) => {
      const parsed = parseDtsBindingExpr(rawBinding);
      const ref: KeymapBindingRef = {
        layerIndex,
        layerName,
        keyPosition,
        binding: rawBinding.trim(),
      };

      if (CG_TOGGLE_REFS.has(parsed.behavior)) {
        cgToggleBindings.push(ref);
      } else if (OS_AWARE_REFS.has(parsed.behavior)) {
        osAwareBindings.push(ref);
      } else if (parsed.behavior === "&bt") {
        const sub = parsed.params[0];
        if (sub === "BT_SEL") {
          const prof = parseInt(parsed.params[1] ?? "", 10);
          if (!Number.isNaN(prof) && prof >= 0 && prof < 5) {
            endpoints[prof + 1].switchBindings.push(ref);
          }
        } else if (sub === "BT_NXT" || sub === "BT_PRV") {
          genericSwitchBindings.push(ref);
        }
      } else if (parsed.behavior === "&out") {
        const sub = parsed.params[0];
        if (sub === "OUT_USB") {
          endpoints[0].switchBindings.push(ref);
        } else if (sub === "OUT_TOG" || sub === "OUT_BLE") {
          genericSwitchBindings.push(ref);
        }
      }
    });
  });

  return {
    endpoints,
    genericSwitchBindings,
    cgToggleBindings,
    osAwareBindings,
  };
}
