import {
  ArrowLeftRight,
  Bluetooth,
  CaseUpper,
  ChevronLeft,
  ChevronRight,
  HardDriveDownload,
  Mouse,
  Play,
  Repeat,
  RotateCcw,
  ScanSearch,
  SkipBack,
  SkipForward,
  Sun,
  SunDim,
  Unlock,
  Usb,
  Volume1,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { KeycapIconId, KeycapLegendSpec } from "../keycapLegendModel";

function renderKeycapIcon(icon: KeycapIconId, compact: boolean) {
  const cls = compact ? "w-3 h-3 shrink-0" : "w-3.5 h-3.5 shrink-0";
  const sw = 1.85;
  switch (icon) {
    case "vol-up":
      return <Volume2 className={cls} strokeWidth={sw} />;
    case "vol-dn":
      return <Volume1 className={cls} strokeWidth={sw} />;
    case "mute":
      return <VolumeX className={cls} strokeWidth={sw} />;
    case "play":
      return <Play className={cls} strokeWidth={sw} />;
    case "next":
      return <SkipForward className={cls} strokeWidth={sw} />;
    case "prev":
      return <SkipBack className={cls} strokeWidth={sw} />;
    case "bri-up":
      return <Sun className={cls} strokeWidth={sw} />;
    case "bri-dn":
      return <SunDim className={cls} strokeWidth={sw} />;
    case "bt":
      return <Bluetooth className={cls} strokeWidth={sw} />;
    case "usb":
      return <Usb className={cls} strokeWidth={sw} />;
    case "out-tog":
      return <ArrowLeftRight className={cls} strokeWidth={sw} />;
    case "mouse":
      return <Mouse className={cls} strokeWidth={sw} />;
    case "unlock":
      return <Unlock className={cls} strokeWidth={sw} />;
    case "bootloader":
      return <HardDriveDownload className={cls} strokeWidth={sw} />;
    case "reset":
      return <RotateCcw className={cls} strokeWidth={sw} />;
    case "cg-swap":
      return <ArrowLeftRight className={cls} strokeWidth={sw} />;
    case "zoom-in":
      return <ZoomIn className={cls} strokeWidth={sw} />;
    case "zoom-out":
      return <ZoomOut className={cls} strokeWidth={sw} />;
    case "smart-zoom":
      return <ScanSearch className={cls} strokeWidth={sw} />;
    case "nav-back":
      return <ChevronLeft className={cls} strokeWidth={sw} />;
    case "nav-fwd":
      return <ChevronRight className={cls} strokeWidth={sw} />;
    case "caps-word":
      return <CaseUpper className={cls} strokeWidth={sw} />;
    case "repeat":
      return <Repeat className={cls} strokeWidth={sw} />;
  }
}

export const KeycapLegend = ({ spec }: { spec: KeycapLegendSpec }) => {
  if (spec.kind === "icon" && spec.icon) {
    return (
      <span className="inline-flex items-center justify-center gap-0.5 leading-none max-w-full">
        {renderKeycapIcon(spec.icon, Boolean(spec.sub))}
        {spec.sub && (
          <span className="text-[10px] font-medium leading-none tracking-tight">
            {spec.sub}
          </span>
        )}
      </span>
    );
  }

  const text = spec.text ?? "";
  const len = Array.from(text).length;
  const sizeClass =
    len <= 1
      ? "text-[13px] font-medium"
      : len <= 3
        ? "text-[10.5px] font-medium tracking-[0.04em]"
        : "text-[9.5px] font-medium tracking-normal";

  return (
    <span
      className={`${sizeClass} ${
        spec.kind === "muted" ? "opacity-35" : ""
      } text-center leading-none max-w-full truncate`}
    >
      {text}
    </span>
  );
};
