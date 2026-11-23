import {
  PhysicalLayout,
  Keymap as KeymapMsg,
} from "@zmkfirmware/zmk-studio-ts-client/keymap";
import type { GetBehaviorDetailsResponse } from "@zmkfirmware/zmk-studio-ts-client/behaviors";

import {
  LayoutZoom,
  PhysicalLayout as PhysicalLayoutComp,
} from "./PhysicalLayout";
import { HidUsageLabel } from "./HidUsageLabel";
import type { CustomBehaviorDef } from "../vmk/types";
import type { ToucanHardwareOverlayProps } from "../vmk/components/ToucanHardwareModules";
import {
  classifyBehavior,
  formatHex,
  formatShortBindingSummary,
} from "../vmk/customBehaviors";

type BehaviorMap = Record<number, GetBehaviorDetailsResponse>;

export interface KeymapProps {
  layout: PhysicalLayout;
  keymap: KeymapMsg;
  behaviors: BehaviorMap;
  customBehaviors?: CustomBehaviorDef[];
  diffPositions?: Set<number>;
  scale: LayoutZoom;
  selectedLayerIndex: number;
  selectedKeyPosition: number | undefined;
  onKeyPositionClicked: (keyPosition: number) => void;
  toucanHardware?: ToucanHardwareOverlayProps;
}

export const Keymap = ({
  layout,
  keymap,
  behaviors,
  customBehaviors = [],
  diffPositions,
  scale,
  selectedLayerIndex,
  selectedKeyPosition,
  onKeyPositionClicked,
  toucanHardware,
}: KeymapProps) => {
  const layer = keymap.layers[selectedLayerIndex];
  if (!layer) {
    return <></>;
  }

  const layerSummaries = keymap.layers.map((l, idx) => ({
    id: l.id,
    name: l.name || `L${idx}`,
  }));

  const positions = layout.keys.map((k, i) => {
    if (i >= layer.bindings.length) {
      return {
        id: `${layer.id}-${i}`,
        header: "Unknown",
        x: k.x / 100.0,
        y: k.y / 100.0,
        width: k.width / 100,
        height: k.height / 100.0,
        children: <span></span>,
      };
    }

    const binding = layer.bindings[i];
    const behavior = behaviors[binding.behaviorId];
    const cls = classifyBehavior(behavior, customBehaviors);
    const summary = formatShortBindingSummary(binding, behaviors, layerSummaries);
    const isStandardKeyPress =
      behavior?.displayName === "Key Press" ||
      behavior?.displayName === "Sticky Key" ||
      behavior?.displayName === "Key Toggle";

    const tooltipParts = [
      `Key #${i}: ${cls.label} (id=${binding.behaviorId})`,
      cls.customDef ? `DTS: &${cls.customDef.label} (${cls.customDef.sourceFile})` : null,
      binding.param1 ? `param1=${binding.param1} (${formatHex(binding.param1)})` : null,
      binding.param2 ? `param2=${binding.param2} (${formatHex(binding.param2)})` : null,
      diffPositions?.has(i) ? "Differs from compared snapshot" : null,
    ].filter(Boolean);

    return {
      id: `${layer.id}-${i}`,
      header: summary.header,
      secondaryLabel: summary.secondary,
      badgeKind: cls.kind,
      isDiff: diffPositions?.has(i) ?? false,
      tooltip: tooltipParts.join("\n"),
      x: k.x / 100.0,
      y: k.y / 100.0,
      width: k.width / 100,
      height: k.height / 100.0,
      r: (k.r || 0) / 100.0,
      rx: (k.rx || 0) / 100.0,
      ry: (k.ry || 0) / 100.0,
      children: isStandardKeyPress ? (
        <HidUsageLabel hid_usage={binding.param1} />
      ) : (
        <span className="text-[0.65rem] font-medium text-center leading-tight line-clamp-2 break-words">
          {summary.primary}
        </span>
      ),
    };
  });

  return (
    <PhysicalLayoutComp
      positions={positions}
      oneU={52}
      hoverZoom={true}
      zoom={scale}
      selectedPosition={selectedKeyPosition}
      onPositionClicked={onKeyPositionClicked}
      toucanHardware={
        toucanHardware
          ? {
              ...toucanHardware,
              activeLayerName: layer.name || `L${selectedLayerIndex}`,
            }
          : undefined
      }
    />
  );
};
