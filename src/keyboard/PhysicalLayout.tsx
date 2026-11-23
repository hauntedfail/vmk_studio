import {
  CSSProperties,
  PropsWithChildren,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Key } from "./Key";
import type { BehaviorKind } from "../vmk/customBehaviors";

export type KeyPosition = PropsWithChildren<{
  id: string;
  header?: string;
  secondaryLabel?: string;
  badgeKind?: BehaviorKind;
  isDiff?: boolean;
  tooltip?: string;
  width: number;
  height: number;
  x: number;
  y: number;
  r?: number;
  rx?: number;
  ry?: number;
}>;

export type LayoutZoom = number | "auto";

export function deserializeLayoutZoom(value: string): LayoutZoom {
  if (value === "auto") {
    return "auto";
  }
  return parseFloat(value) || "auto";
}

interface PhysicalLayoutProps {
  positions: Array<KeyPosition>;
  selectedPosition?: number;
  oneU?: number;
  hoverZoom?: boolean;
  zoom?: LayoutZoom;
  onPositionClicked?: (position: number) => void;
}

interface PhysicalLayoutPositionLocation {
  x: number;
  y: number;
  r?: number;
  rx?: number;
  ry?: number;
}

function scalePosition(
  { x, y, r, rx, ry }: PhysicalLayoutPositionLocation,
  oneU: number
): CSSProperties {
  const left = x * oneU;
  const top = y * oneU;
  let transformOrigin = undefined;
  let transform = undefined;
  const transformStyle = "preserve-3d";

  if (r) {
    const transformX = ((rx ?? x) - x) * oneU;
    const transformY = ((ry ?? y) - y) * oneU;
    transformOrigin = `${transformX}px ${transformY}px`;
    transform = `rotate(${r}deg)`;
  }

  return {
    top,
    left,
    transformOrigin,
    transform,
    transformStyle,
  };
}

export const PhysicalLayout = ({
  positions,
  selectedPosition,
  oneU = 48,
  onPositionClicked,
  hoverZoom: _hoverZoom,
  zoom,
}: PhysicalLayoutProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const parent = element.parentElement;
    if (!parent) return;

    const calculateScale = () => {
      if (zoom === "auto") {
        const padding = Math.min(window.innerWidth, window.innerHeight) * 0.05;
        const newScale = Math.min(
          parent.clientWidth / (element.clientWidth + 2 * padding),
          parent.clientHeight / (element.clientHeight + 2 * padding),
          1.4
        );
        setScale(Math.max(0.25, newScale));
      } else {
        setScale(zoom || 1);
      }
    };

    calculateScale();

    const resizeObserver = new ResizeObserver(() => {
      calculateScale();
    });

    resizeObserver.observe(element);
    resizeObserver.observe(parent);

    return () => {
      resizeObserver.disconnect();
    };
  }, [zoom, positions.length]);

  const rightMost = positions
    .map((k) => k.x + k.width)
    .reduce((a, b) => Math.max(a, b), 0);
  const bottomMost = positions
    .map((k) => k.y + k.height)
    .reduce((a, b) => Math.max(a, b), 0);

  const positionItems = positions.map((p, idx) => (
    <div key={p.id} className="absolute hover:z-10" style={scalePosition(p, oneU)}>
      <Key
        oneU={oneU}
        selected={idx === selectedPosition}
        width={p.width}
        height={p.height}
        header={p.header}
        secondaryLabel={p.secondaryLabel}
        badgeKind={p.badgeKind}
        isDiff={p.isDiff}
        tooltip={p.tooltip}
        onClick={() => onPositionClicked?.(idx)}
      >
        {p.children}
      </Key>
    </div>
  ));

  return (
    <div
      className="relative"
      style={{
        height: bottomMost * oneU + "px",
        width: rightMost * oneU + "px",
        transform: `scale(${scale})`,
        transformStyle: "preserve-3d",
      }}
      ref={ref}
    >
      {positionItems}
    </div>
  );
};
