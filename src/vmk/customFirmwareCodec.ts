import type {
  CustomCFeaturesTuning,
  HelperSmootherTuning,
  LeftOverlayGates,
} from "./types";

function readStatusFlag(source: string, nodeRef: string, fallback = true): boolean {
  const re = new RegExp(`&${nodeRef}\\s*\\{[^}]*status\\s*=\\s*"([^"]+)"`, "s");
  const m = source.match(re);
  if (!m) return fallback;
  return m[1] === "okay";
}

function setStatusFlag(source: string, nodeRef: string, enabled: boolean): string {
  const statusVal = enabled ? "okay" : "disabled";
  const re = new RegExp(`(&${nodeRef}\\s*\\{[^}]*status\\s*=\\s*")[^"]+(")`, "s");
  if (re.test(source)) {
    return source.replace(re, `$1${statusVal}$2`);
  }
  const sep = source.endsWith("\n") ? "\n" : "\n\n";
  return `${source}${sep}&${nodeRef} {\n    status = "${statusVal}";\n};\n`;
}

export function parseLeftOverlayGates(leftOverlay: string): LeftOverlayGates {
  return {
    trackpadListenerEnabled: readStatusFlag(leftOverlay, "trackpad_listener", true),
    zipZoomMapperEnabled: readStatusFlag(leftOverlay, "zip_zoom_mapper", true),
    twoFingerDoubleTapEnabled: readStatusFlag(leftOverlay, "two_finger_double_tap", true),
  };
}

export function updateLeftOverlayGates(
  leftOverlay: string,
  next: LeftOverlayGates
): string {
  let out = leftOverlay;
  out = setStatusFlag(out, "trackpad_listener", next.trackpadListenerEnabled);
  out = setStatusFlag(out, "zip_zoom_mapper", next.zipZoomMapperEnabled);
  out = setStatusFlag(out, "two_finger_double_tap", next.twoFingerDoubleTapEnabled);
  return out;
}

export function parseCustomCFeatures(
  cgZoomC: string,
  cgNavC: string
): CustomCFeaturesTuning {
  const zoomMarker =
    cgZoomC.match(/CG_ZOOM_MARKER\s*=\s*([A-Za-z0-9_()]+)\s*;/)?.[1] ?? "F20";
  const smartMarker =
    cgZoomC.match(/CG_SMART_ZOOM_MARKER\s*=\s*([A-Za-z0-9_()]+)\s*;/)?.[1] ?? "F19";
  const zoomChordMatch = cgZoomC.match(
    /direction\s*==\s*CG_ZOOM_IN\s*\?\s*([^:\n]+?)\s*:\s*([^;\n]+?)\s*;/
  );

  const navMatches = Array.from(
    cgNavC.matchAll(
      /return\s+mac_mode\s*\?\s*APPLY_MODS\(\s*([^,\s]+)\s*,\s*([^)\s]+)\s*\)\s*:\s*APPLY_MODS\(\s*([^,\s]+)\s*,\s*([^)\s]+)\s*\)\s*;/g
    )
  );
  const backMatch = navMatches[0];
  const fwdMatch = navMatches[1];

  return {
    zoomMarkerKey: zoomMarker.trim(),
    smartZoomMarkerKey: smartMarker.trim(),
    zoomInChord: zoomChordMatch?.[1]?.trim() ?? "LC(EQUAL)",
    zoomOutChord: zoomChordMatch?.[2]?.trim() ?? "LC(MINUS)",
    navMacBackMod: backMatch?.[1]?.trim() ?? "MOD_LCTL",
    navMacBackKey: backMatch?.[2]?.trim() ?? "LEFT_BRACKET",
    navWinBackMod: backMatch?.[3]?.trim() ?? "MOD_LALT",
    navWinBackKey: backMatch?.[4]?.trim() ?? "LEFT",
    navMacForwardMod: fwdMatch?.[1]?.trim() ?? "MOD_LCTL",
    navMacForwardKey: fwdMatch?.[2]?.trim() ?? "RIGHT_BRACKET",
    navWinForwardMod: fwdMatch?.[3]?.trim() ?? "MOD_LALT",
    navWinForwardKey: fwdMatch?.[4]?.trim() ?? "RIGHT",
  };
}

export function updateCustomCFeatures(
  cgZoomC: string,
  cgNavC: string,
  next: CustomCFeaturesTuning
): { cgZoomC: string; cgNavC: string } {
  let outZoom = cgZoomC;
  outZoom = outZoom.replace(
    /(CG_ZOOM_MARKER\s*=\s*)[^;]+(;)/,
    `$1${next.zoomMarkerKey.trim()}$2`
  );
  outZoom = outZoom.replace(
    /(CG_SMART_ZOOM_MARKER\s*=\s*)[^;]+(;)/,
    `$1${next.smartZoomMarkerKey.trim()}$2`
  );
  outZoom = outZoom.replace(
    /(direction\s*==\s*CG_ZOOM_IN\s*\?\s*)[^:\n]+?(\s*:\s*)[^;\n]+?(;)/,
    `$1${next.zoomInChord.trim()}$2${next.zoomOutChord.trim()}$3`
  );

  let navIdx = 0;
  const outNav = cgNavC.replace(
    /(return\s+mac_mode\s*\?\s*)APPLY_MODS\([^)]+\)(\s*:\s*)APPLY_MODS\([^)]+\)(;)/g,
    (_full, p1, p2, p3) => {
      navIdx++;
      if (navIdx === 1) {
        return `${p1}APPLY_MODS(${next.navMacBackMod.trim()}, ${next.navMacBackKey.trim()})${p2}APPLY_MODS(${next.navWinBackMod.trim()}, ${next.navWinBackKey.trim()})${p3}`;
      }
      return `${p1}APPLY_MODS(${next.navMacForwardMod.trim()}, ${next.navMacForwardKey.trim()})${p2}APPLY_MODS(${next.navWinForwardMod.trim()}, ${next.navWinForwardKey.trim()})${p3}`;
    }
  );

  return { cgZoomC: outZoom, cgNavC: outNav };
}

export function parseHelperSmoother(
  swiftSource: string
): HelperSmootherTuning | null {
  if (!swiftSource.trim()) return null;
  const low = swiftSource.match(/case\s+\.low:\s*return\s+([0-9.]+)/)?.[1];
  const med = swiftSource.match(/case\s+\.medium:\s*return\s+([0-9.]+)/)?.[1];
  const high = swiftSource.match(/case\s+\.high:\s*return\s+([0-9.]+)/)?.[1];
  const easing = swiftSource.match(/easing:\s*Double\s*=\s*([0-9.]+)/)?.[1];
  const smallest = swiftSource.match(/smallestFrame:\s*Double\s*=\s*([0-9.]+)/)?.[1];
  const endDelay = swiftSource.match(/endDelay:\s*Double\s*=\s*([0-9.]+)/)?.[1];

  if (!low || !med || !high || !easing || !smallest || !endDelay) return null;

  return {
    lowStep: parseFloat(low),
    mediumStep: parseFloat(med),
    highStep: parseFloat(high),
    easing: parseFloat(easing),
    smallestFrame: parseFloat(smallest),
    endDelay: parseFloat(endDelay),
  };
}

export function updateHelperSmoother(
  swiftSource: string,
  next: HelperSmootherTuning
): string {
  let out = swiftSource;
  out = out.replace(/(case\s+\.low:\s*return\s+)[0-9.]+/, `$1${next.lowStep}`);
  out = out.replace(/(case\s+\.medium:\s*return\s+)[0-9.]+/, `$1${next.mediumStep}`);
  out = out.replace(/(case\s+\.high:\s*return\s+)[0-9.]+/, `$1${next.highStep}`);
  out = out.replace(/(easing:\s*Double\s*=\s*)[0-9.]+/, `$1${next.easing}`);
  out = out.replace(
    /(smallestFrame:\s*Double\s*=\s*)[0-9.]+/,
    `$1${next.smallestFrame}`
  );
  out = out.replace(/(endDelay:\s*Double\s*=\s*)[0-9.]+/, `$1${next.endDelay}`);
  return out;
}
