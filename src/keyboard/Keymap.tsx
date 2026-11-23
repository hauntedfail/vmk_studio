import {
  PhysicalLayout,
  Keymap as KeymapMsg,
} from "@zmkfirmware/zmk-studio-ts-client/keymap";
import type { GetBehaviorDetailsResponse } from "@zmkfirmware/zmk-studio-ts-client/behaviors";

import {
  LayoutZoom,
  PhysicalLayout as PhysicalLayoutComp,
} from "./PhysicalLayout";
import type { CustomBehaviorDef } from "../vmk/types";
import type { ToucanHardwareOverlayProps } from "../vmk/components/ToucanHardwareModules";
import { classifyBehavior, formatHex } from "../vmk/customBehaviors";
import { resolveStudioBindingLegend } from "../vmk/keycapLegendModel";
import { KeycapLegend } from "../vmk/components/KeycapLegend";

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
    const spec = resolveStudioBindingLegend(
      behavior?.displayName,
      binding.param1,
      binding.param2,
      layerSummaries
    );

    const tooltipParts = [
      `Key #${i}: ${cls.label} (id=${binding.behaviorId})`,
      cls.customDef ? `DTS: &${cls.customDef.label} (${cls.customDef.sourceFile})` : null,
      binding.param1 ? `param1=${binding.param1} (${formatHex(binding.param1)})` : null,
      binding.param2 ? `param2=${binding.param2} (${formatHex(binding.param2)})` : null,
      diffPositions?.has(i) ? "Differs from compared snapshot" : null,
    ].filter(Boolean);

    return {
      id: `${layer.id}-${i}`,
      header: spec.header,
      secondaryLabel: spec.secondaryLabel,
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
      children: <KeycapLegend spec={spec} />,
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
