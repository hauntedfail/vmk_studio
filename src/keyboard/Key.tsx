import { PropsWithChildren } from "react";
import BehaviorShortNames from "./behavior-short-names.json";
import type { BehaviorKind } from "../vmk/customBehaviors";

interface KeyProps {
  selected?: boolean;
  width: number;
  height: number;
  oneU: number;
  header?: string;
  secondaryLabel?: string;
  badgeKind?: BehaviorKind;
  isDiff?: boolean;
  tooltip?: string;
  onClick?: () => void;
}

interface BehaviorShortName {
  short?: string;
}

const MAX_HEADER_LENGTH = 9;
const shortNames: Record<string, BehaviorShortName> = BehaviorShortNames;

const shortenHeader = (header: string | undefined) => {
  if (typeof header === "undefined") {
    return "";
  }
  if (typeof shortNames[header]?.short !== "undefined") {
    return shortNames[header].short;
  } else if (header.length > MAX_HEADER_LENGTH) {
    const words = header.split(/[\s,-]+/);
    const lettersPerWord = Math.max(1, Math.trunc(MAX_HEADER_LENGTH / words.length));
    return words.map((word) => word.substring(0, lettersPerWord)).join("");
  } else {
    return header;
  }
};

export const Key = ({
  selected = false,
  width,
  height,
  oneU,
  header,
  secondaryLabel,
  badgeKind,
  isDiff = false,
  tooltip,
  onClick,
  children,
}: PropsWithChildren<KeyProps>) => {
  const pixelWidth = width * oneU - 4;
  const pixelHeight = height * oneU - 4;

  const stateClass = selected
    ? "bg-[#FC4C01] text-white border-[#FC4C01] shadow-[0_2px_0_#b53500,0_6px_16px_rgba(252,76,1,0.35)]"
    : "vmk-keycap text-foreground hover:border-foreground/25";

  const diffRing = isDiff
    ? "ring-2 ring-[#FC4C01] ring-offset-1 ring-offset-recess"
    : "";

  return (
    <button
      type="button"
      title={tooltip}
      className={`group rounded-[9px] relative flex flex-col justify-center items-center cursor-pointer transition-all duration-150 hover:-translate-y-[1px] overflow-hidden px-1 select-none ${stateClass} ${diffRing}`}
      style={{
        width: `${pixelWidth}px`,
        height: `${pixelHeight}px`,
      }}
      onClick={onClick}
    >
      {/* Subtle 5px hardware-style indicator dot */}
      {badgeKind === "custom" && (
        <span
          className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${
            selected ? "bg-white" : "bg-[#FC4C01]"
          }`}
          aria-label="Custom firmware behavior"
        />
      )}
      {badgeKind === "safety" && (
        <span
          className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${
            selected ? "bg-white/90" : "bg-amber-500"
          }`}
          aria-label="Protected safety key"
        />
      )}
      {badgeKind === "unknown" && (
        <span
          className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-red-500"
          aria-label="Unknown behavior"
        />
      )}

      {header && (
        <div
          className={`absolute text-keycap-xs tracking-wider uppercase top-1 text-nowrap left-1/2 font-mono -translate-x-1/2 text-center ${
            selected ? "text-white/80" : "text-muted-foreground"
          }`}
        >
          {shortenHeader(header)}
        </div>
      )}

      <div className="flex flex-col items-center justify-center max-w-full leading-tight font-medium">
        {children}
      </div>

      {secondaryLabel && (
        <div
          className={`absolute bottom-1 left-1/2 -translate-x-1/2 text-keycap-xs font-mono text-nowrap ${
            selected ? "text-white/85" : "text-[#FC4C01]"
          }`}
        >
          {secondaryLabel}
        </div>
      )}
    </button>
  );
};
