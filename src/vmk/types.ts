import type { BehaviorBinding } from "@zmkfirmware/zmk-studio-ts-client/keymap";
import type { GetBehaviorDetailsResponse } from "@zmkfirmware/zmk-studio-ts-client/behaviors";

export interface VmkWorkspacePaths {
  firmwareRepoPath: string;
  zmkAppPath: string;
  westPath: string;
  backupsDir: string;
  toolsDir: string;
}

export interface BuiltArtifactInfo {
  name: string;
  half: "left" | "right";
  path: string;
  exists: boolean;
  bytes?: number;
  sha256?: string;
  expectedSha256?: string;
  checksumMatches?: boolean;
  mtimeIso?: string;
}

export interface BootloaderStatus {
  mounted: boolean;
  volumePath: string;
  boardId?: string;
  isXiaoNrf52840: boolean;
  detectedHalf: "left" | "right_or_other" | "unknown";
  detectedMarkers: string[];
}

export interface VmkWorkspaceStatus {
  paths: VmkWorkspacePaths;
  repoExists: boolean;
  zmkAppExists: boolean;
  westExists: boolean;
  gitBranch?: string;
  gitHead?: string;
  gitTag?: string;
  dirtyFiles: string[];
  artifacts: {
    left: BuiltArtifactInfo;
    right: BuiltArtifactInfo;
  };
  bootloader: BootloaderStatus;
  usbKeyboardConnected: boolean;
  usbProducts: string[];
  helperInstalled: boolean;
  helperRunning: boolean;
  availableScripts: string[];
}

export interface CustomBehaviorDef {
  nodeName: string;
  label: string;
  compatible: string;
  bindingCells: number;
  displayName: string;
  sourceFile: string;
  properties: Record<string, string>;
}

export type HoldTapFlavor = "hold-preferred" | "balanced" | "tap-preferred";

export interface HoldTapTuning {
  mtQuickTapMs: number | null;
  mtTappingTermMs: number | null;
  mtFlavor: HoldTapFlavor | null;
  mtRequirePriorIdleMs: number | null;
  mtRetroTap?: boolean;
  ltQuickTapMs: number | null;
  ltTappingTermMs: number | null;
  ltFlavor: HoldTapFlavor | null;
  ltRequirePriorIdleMs?: number | null;
  ltRetroTap?: boolean;
}

export interface TrackpadHardwareTuning {
  sensitivity: number;
  scrollSensitivity: number;
  scrollAngle: number;
  holdTime: number;
  reportRateLp2: number;
  threeFingerSwipeThrottleMs: number;
  filterSettings: string;
  zoom: boolean;
  scroll: boolean;
  twoFingerTap: boolean;
  singleTap: boolean;
  pressAndHold: boolean;
  threeFingerSwipe: boolean;
  switchXy: boolean;
  invertScrollY: boolean;
  enablePowerManagement: boolean;
}

export interface TrackpadProcessorTuning {
  xyScaleMul: number;
  xyScaleDiv: number;
  scrollScaleMul: number;
  scrollScaleDiv: number;
  zoomSensitivity: number;
  zoomTrackRemainders: boolean;
  zoomOutBinding: string;
  zoomInBinding: string;
  doubleTapWindowMs: number;
  doubleTapRequireCgSwap: boolean;
  doubleTapSingleBinding: string;
  doubleTapDoubleBinding: string;
  touchLayer: number;
  scrollerLayers: number[];
  scrollerInvertX: boolean;
  scrollerInvertY: boolean;
  winModeDefault: boolean;
  swipeBindings: string[];
  swipeWinBindings: string[];
}

export interface LeftOverlayGates {
  trackpadListenerEnabled: boolean;
  zipZoomMapperEnabled: boolean;
  twoFingerDoubleTapEnabled: boolean;
}

export interface CustomCFeaturesTuning {
  zoomMarkerKey: string;
  smartZoomMarkerKey: string;
  zoomInChord: string;
  zoomOutChord: string;
  navMacBackMod: string;
  navMacBackKey: string;
  navMacForwardMod: string;
  navMacForwardKey: string;
  navWinBackMod: string;
  navWinBackKey: string;
  navWinForwardMod: string;
  navWinForwardKey: string;
}

export interface HelperSmootherTuning {
  lowStep: number;
  mediumStep: number;
  highStep: number;
  easing: number;
  smallestFrame: number;
  endDelay: number;
}

export interface FirmwareConfTuning {
  idleTimeoutMs: number;
  idleSleepTimeoutMs: number;
  statusScreenStyle: number;
  inputThreadStackSize: number;
  cgToggleEnabled: boolean;
  cgToggleSaveDelayMs: number;
  cgToggleDebug: boolean;
  splitInputRelayEnabled: boolean;
  splitInputRelayQueueSize: number;
  splitInputRelayStackSize: number;
}

export interface PhysicalKeyDef {
  x: number;
  y: number;
  w?: number;
  h?: number;
  r?: number;
  rx?: number;
  ry?: number;
}

export interface RepoKeymapLayer {
  id: string;
  displayName: string;
  bindings: string[];
  reserved?: boolean;
}

export interface ConditionalLayerRule {
  name: string;
  ifLayers: number[];
  thenLayer: number;
}

export interface ComboDef {
  name: string;
  timeoutMs: number;
  keyPositions: number[];
  bindings: string;
  layers?: number[];
}

export interface EditableRepoFile {
  relPath: string;
  label: string;
  category: "keymap" | "behavior" | "shield" | "config" | "source" | "helper";
  exists: boolean;
  modified?: boolean;
}

export interface FirmwareModel {
  repoPath: string;
  customBehaviors: CustomBehaviorDef[];
  holdTap: HoldTapTuning;
  trackpadHardware: TrackpadHardwareTuning;
  trackpadProcessors: TrackpadProcessorTuning;
  leftOverlayGates: LeftOverlayGates;
  customCFeatures: CustomCFeaturesTuning;
  helperSmoother: HelperSmootherTuning | null;
  conf: FirmwareConfTuning;
  physicalLayout: PhysicalKeyDef[];
  repoKeymapLayers: RepoKeymapLayer[];
  conditionalLayers: ConditionalLayerRule[];
  combos: ComboDef[];
  editableFiles: EditableRepoFile[];
}

export interface SnapshotBinding {
  behavior_id: number;
  param1: number;
  param2: number;
}

export interface SnapshotLayer {
  id: number;
  name: string;
  bindings: SnapshotBinding[];
}

export interface StudioSnapshot {
  device: string;
  serial_hex?: string;
  keymap_sha256?: string;
  saved_at?: string;
  note?: string;
  behavior_ids: number[];
  behaviors?: Record<
    number,
    Pick<GetBehaviorDetailsResponse, "id" | "displayName"> & {
      metadata?: GetBehaviorDetailsResponse["metadata"];
    }
  >;
  layers: SnapshotLayer[];
}

export interface SnapshotSummary {
  path: string;
  relPath: string;
  name: string;
  mtimeIso: string;
  device?: string;
  layerCount: number;
  keymapSha256?: string;
  note?: string;
}

export interface KeymapDiffEntry {
  layerIndex: number;
  layerId: number;
  layerName: string;
  keyPosition: number;
  current: BehaviorBinding;
  baseline?: BehaviorBinding;
}

export type JobKind =
  | "test-host"
  | "test-single"
  | "build-firmware"
  | "verify-build"
  | "flash-left"
  | "flash-right"
  | "helper-build-install";

export interface CommandJob {
  id: string;
  kind: JobKind;
  command: string;
  status: "running" | "succeeded" | "failed";
  startedAt: string;
  finishedAt?: string;
  exitCode?: number | null;
  output: string;
}

export interface FirmwareTuningPatch {
  holdTap?: HoldTapTuning;
  trackpadHardware?: TrackpadHardwareTuning;
  trackpadProcessors?: TrackpadProcessorTuning;
  leftOverlayGates?: LeftOverlayGates;
  customCFeatures?: CustomCFeaturesTuning;
  helperSmoother?: HelperSmootherTuning;
  conf?: FirmwareConfTuning;
}

export interface RepoKeymapSavePayload {
  layers: RepoKeymapLayer[];
  conditionalLayers?: ConditionalLayerRule[];
  combos?: ComboDef[];
}
