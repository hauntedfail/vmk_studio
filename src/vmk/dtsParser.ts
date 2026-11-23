import type {
  CustomBehaviorDef,
  FirmwareConfTuning,
  HoldTapFlavor,
  HoldTapTuning,
  RepoKeymapLayer,
  TrackpadHardwareTuning,
  TrackpadProcessorTuning,
} from "./types";

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, "");
}

function findBlockRange(
  source: string,
  headerRegex: RegExp
): { start: number; bodyStart: number; bodyEnd: number; end: number } | null {
  const m = headerRegex.exec(source);
  if (!m || m.index === undefined) return null;
  const openBrace = source.indexOf("{", m.index + m[0].length - 1);
  if (openBrace < 0) return null;

  let depth = 0;
  let inBlockComment = false;
  let inLineComment = false;
  let inString = false;

  for (let i = openBrace; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      if (ch === "\\" && next) {
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        let end = i + 1;
        while (end < source.length && (source[end] === " " || source[end] === "\t")) {
          end++;
        }
        if (source[end] === ";") end++;
        return {
          start: m.index,
          bodyStart: openBrace + 1,
          bodyEnd: i,
          end,
        };
      }
    }
  }
  return null;
}

export function parseCustomBehaviors(
  dtsContent: string,
  sourceFile: string
): CustomBehaviorDef[] {
  const clean = stripComments(dtsContent);
  const behaviorsBlock = findBlockRange(clean, /\bbehaviors\s*\{/);
  const searchArea = behaviorsBlock
    ? clean.slice(behaviorsBlock.bodyStart, behaviorsBlock.bodyEnd)
    : clean;

  const defs: CustomBehaviorDef[] = [];
  const nodeHeader = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z0-9_@-]+)\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = nodeHeader.exec(searchArea)) !== null) {
    const label = match[1];
    const nodeName = match[2];
    const sub = searchArea.slice(match.index);
    const range = findBlockRange(sub, /^[A-Za-z_][A-Za-z0-9_]*\s*:\s*[A-Za-z0-9_@-]+\s*\{/);
    if (!range) continue;

    const body = sub.slice(range.bodyStart, range.bodyEnd);
    const compatibleMatch = body.match(/compatible\s*=\s*"([^"]+)"\s*;/);
    if (!compatibleMatch) continue;

    const cellsMatch = body.match(/#binding-cells\s*=\s*<(\d+)>\s*;/);
    const displayNameMatch = body.match(/display-name\s*=\s*"([^"]+)"\s*;/);

    const properties: Record<string, string> = {};
    const propRegex = /^\s*([A-Za-z0-9_#-]+)\s*(?:=\s*([^;]+))?;/gm;
    let pm: RegExpExecArray | null;
    while ((pm = propRegex.exec(body)) !== null) {
      const key = pm[1];
      if (key === "compatible" || key === "#binding-cells" || key === "display-name") {
        continue;
      }
      const rawVal = pm[2]?.trim();
      properties[key] = rawVal ? rawVal.replace(/^"|"$/g, "") : "true";
    }

    defs.push({
      label,
      nodeName,
      compatible: compatibleMatch[1],
      bindingCells: cellsMatch ? parseInt(cellsMatch[1], 10) : 0,
      displayName: displayNameMatch ? displayNameMatch[1] : label,
      sourceFile,
      properties,
    });

    nodeHeader.lastIndex = match.index + range.end;
  }

  return defs;
}

function readIntProp(body: string, prop: string): number | null {
  const re = new RegExp(`(^|\\n)\\s*${prop}\\s*=\\s*<(\\d+)>\\s*;`);
  const m = body.match(re);
  return m ? parseInt(m[2], 10) : null;
}

function readStringProp(body: string, prop: string): string | null {
  const re = new RegExp(`(^|\\n)\\s*${prop}\\s*=\\s*"([^"]+)"\\s*;`);
  const m = body.match(re);
  return m ? m[2] : null;
}

function readRawAngleProp(body: string, prop: string): string | null {
  const re = new RegExp(`(^|\\n)\\s*${prop}\\s*=\\s*<([^>]+)>\\s*;`);
  const m = body.match(re);
  return m ? m[2].trim() : null;
}

function hasBoolProp(body: string, prop: string): boolean {
  const clean = stripComments(body);
  const re = new RegExp(`(^|\\n)\\s*${prop}\\s*;`);
  return re.test(clean);
}

function setOrRemoveDtsProp(
  blockBody: string,
  prop: string,
  valueText: string | null,
  indent = "    "
): string {
  const activeRe = new RegExp(`(^|\\n)([ \\t]*)${prop}(?:\\s*=\\s*[^;\\n]+)?;([^\\n]*)`);
  const commentedRe = new RegExp(`(^|\\n)([ \\t]*)//\\s*${prop}(?:\\s*=\\s*[^;\\n]+)?;([^\\n]*)`);

  if (valueText === null) {
    if (activeRe.test(blockBody)) {
      return blockBody.replace(activeRe, "$1$2//" + `${prop};$3`);
    }
    return blockBody;
  }

  const line = valueText === "" ? `${prop};` : `${prop} = ${valueText};`;
  if (activeRe.test(blockBody)) {
    return blockBody.replace(activeRe, `$1$2${line}$3`);
  }
  if (commentedRe.test(blockBody)) {
    return blockBody.replace(commentedRe, `$1$2${line}$3`);
  }

  const trimmedEnd = blockBody.replace(/[ \t]*$/, "");
  const needsNewline = !trimmedEnd.endsWith("\n");
  return `${trimmedEnd}${needsNewline ? "\n" : ""}${indent}${line}\n`;
}

function setOrRemoveNumericDtsProp(
  blockBody: string,
  prop: string,
  val: number | null,
  indent = "    "
): string {
  if (val === null) {
    const activeRe = new RegExp(`(^|\\n)[ \\t]*${prop}\\s*=\\s*<[^>]+>;[^\\n]*`);
    return blockBody.replace(activeRe, "");
  }
  return setOrRemoveDtsProp(blockBody, prop, `<${Math.round(val)}>`, indent);
}

function setOrRemoveStringDtsProp(
  blockBody: string,
  prop: string,
  val: string | null,
  indent = "    "
): string {
  if (val === null) {
    const activeRe = new RegExp(`(^|\\n)[ \\t]*${prop}\\s*=\\s*"[^"]+";[^\\n]*`);
    return blockBody.replace(activeRe, "");
  }
  return setOrRemoveDtsProp(blockBody, prop, `"${val}"`, indent);
}

function setOrRemoveBoolFlagLine(
  blockBody: string,
  prop: string,
  enabled: boolean | undefined,
  indent = "    "
): string {
  if (!enabled) {
    const activeRe = new RegExp(`(^|\\n)[ \\t]*${prop}\\s*;[^\\n]*`);
    return blockBody.replace(activeRe, "");
  }
  return setOrRemoveDtsProp(blockBody, prop, "", indent);
}

function updateBehaviorOverrideBlock(
  source: string,
  refName: "mt" | "lt",
  props: {
    quickTapMs: number | null;
    tappingTermMs: number | null;
    flavor: HoldTapFlavor | null;
    requirePriorIdleMs?: number | null;
    retroTap?: boolean;
  }
): string {
  const headerRe = new RegExp(`(^|\\n)&${refName}\\s*\\{`);
  const range = findBlockRange(source, headerRe);

  const hasAny =
    props.quickTapMs !== null ||
    props.tappingTermMs !== null ||
    props.flavor !== null ||
    Boolean(props.retroTap) ||
    (props.requirePriorIdleMs !== undefined && props.requirePriorIdleMs !== null);

  if (!range) {
    if (!hasAny) return source;
    let body = "\n";
    if (props.quickTapMs !== null) {
      body += `    quick-tap-ms = <${Math.round(props.quickTapMs)}>;\n`;
    }
    if (props.tappingTermMs !== null) {
      body += `    tapping-term-ms = <${Math.round(props.tappingTermMs)}>;\n`;
    }
    if (props.flavor !== null) {
      body += `    flavor = "${props.flavor}";\n`;
    }
    if (props.requirePriorIdleMs !== undefined && props.requirePriorIdleMs !== null) {
      body += `    require-prior-idle-ms = <${Math.round(props.requirePriorIdleMs)}>;\n`;
    }
    if (props.retroTap) {
      body += `    retro-tap;\n`;
    }
    const sep = source.endsWith("\n") ? "\n" : "\n\n";
    return `${source}${sep}&${refName} {${body}};\n`;
  }

  let body = source.slice(range.bodyStart, range.bodyEnd);
  body = setOrRemoveNumericDtsProp(body, "quick-tap-ms", props.quickTapMs);
  body = setOrRemoveNumericDtsProp(body, "tapping-term-ms", props.tappingTermMs);
  body = setOrRemoveStringDtsProp(body, "flavor", props.flavor);
  if (props.requirePriorIdleMs !== undefined) {
    body = setOrRemoveNumericDtsProp(
      body,
      "require-prior-idle-ms",
      props.requirePriorIdleMs
    );
  }
  if (props.retroTap !== undefined) {
    body = setOrRemoveBoolFlagLine(body, "retro-tap", props.retroTap);
  }

  return source.slice(0, range.bodyStart) + body + source.slice(range.bodyEnd);
}

export function parseHoldTapTuning(keymapContent: string): HoldTapTuning {
  const clean = stripComments(keymapContent);
  const mtBlock = findBlockRange(clean, /(^|\n)&mt\s*\{/);
  const ltBlock = findBlockRange(clean, /(^|\n)&lt\s*\{/);

  const mtBody = mtBlock ? clean.slice(mtBlock.bodyStart, mtBlock.bodyEnd) : "";
  const ltBody = ltBlock ? clean.slice(ltBlock.bodyStart, ltBlock.bodyEnd) : "";

  return {
    mtQuickTapMs: readIntProp(mtBody, "quick-tap-ms"),
    mtTappingTermMs: readIntProp(mtBody, "tapping-term-ms"),
    mtFlavor: (readStringProp(mtBody, "flavor") as HoldTapFlavor | null) ?? null,
    mtRequirePriorIdleMs: readIntProp(mtBody, "require-prior-idle-ms"),
    mtRetroTap: hasBoolProp(mtBody, "retro-tap"),
    ltQuickTapMs: readIntProp(ltBody, "quick-tap-ms"),
    ltTappingTermMs: readIntProp(ltBody, "tapping-term-ms"),
    ltFlavor: (readStringProp(ltBody, "flavor") as HoldTapFlavor | null) ?? null,
    ltRequirePriorIdleMs: readIntProp(ltBody, "require-prior-idle-ms"),
    ltRetroTap: hasBoolProp(ltBody, "retro-tap"),
  };
}

export function updateHoldTapTuning(
  keymapContent: string,
  next: HoldTapTuning
): string {
  let out = updateBehaviorOverrideBlock(keymapContent, "mt", {
    quickTapMs: next.mtQuickTapMs,
    tappingTermMs: next.mtTappingTermMs,
    flavor: next.mtFlavor,
    requirePriorIdleMs: next.mtRequirePriorIdleMs,
    retroTap: next.mtRetroTap,
  });
  out = updateBehaviorOverrideBlock(out, "lt", {
    quickTapMs: next.ltQuickTapMs,
    tappingTermMs: next.ltTappingTermMs,
    flavor: next.ltFlavor,
    requirePriorIdleMs: next.ltRequirePriorIdleMs,
    retroTap: next.ltRetroTap,
  });
  return out;
}

export function parseTrackpadHardware(
  rightOverlay: string
): TrackpadHardwareTuning {
  const clean = stripComments(rightOverlay);
  const range = findBlockRange(clean, /tps43_trackpad\s*:\s*trackpad@[0-9a-fA-F]+\s*\{/);
  const body = range ? clean.slice(range.bodyStart, range.bodyEnd) : clean;

  return {
    sensitivity: readIntProp(body, "sensitivity") ?? 100,
    scrollSensitivity: readIntProp(body, "scroll-sensitivity") ?? 100,
    scrollAngle: readIntProp(body, "scroll-angle") ?? 30,
    holdTime: readIntProp(body, "hold-time") ?? 500,
    reportRateLp2: readIntProp(body, "report-rate-lp2") ?? 640,
    threeFingerSwipeThrottleMs:
      readIntProp(body, "three-finger-swipe-throttle-ms") ?? 1200,
    filterSettings: readRawAngleProp(body, "filter-settings") ?? "0x0B",
    zoom: hasBoolProp(body, "zoom"),
    scroll: hasBoolProp(body, "scroll"),
    twoFingerTap: hasBoolProp(body, "two-finger-tap"),
    singleTap: hasBoolProp(body, "single-tap"),
    pressAndHold: hasBoolProp(body, "press-and-hold"),
    threeFingerSwipe: hasBoolProp(body, "three-finger-swipe"),
    switchXy: hasBoolProp(body, "switch-xy"),
    invertScrollY: hasBoolProp(body, "invert-scroll-y"),
    enablePowerManagement: hasBoolProp(body, "enable-power-management"),
  };
}

export function updateTrackpadHardware(
  rightOverlay: string,
  next: TrackpadHardwareTuning
): string {
  const range = findBlockRange(
    rightOverlay,
    /tps43_trackpad\s*:\s*trackpad@[0-9a-fA-F]+\s*\{/
  );
  if (!range) return rightOverlay;

  let body = rightOverlay.slice(range.bodyStart, range.bodyEnd);
  const indent = "        ";

  body = setOrRemoveDtsProp(body, "sensitivity", `<${Math.round(next.sensitivity)}>`, indent);
  body = setOrRemoveDtsProp(
    body,
    "scroll-sensitivity",
    `<${Math.round(next.scrollSensitivity)}>`,
    indent
  );
  body = setOrRemoveDtsProp(body, "scroll-angle", `<${Math.round(next.scrollAngle)}>`, indent);
  body = setOrRemoveDtsProp(body, "hold-time", `<${Math.round(next.holdTime)}>`, indent);
  body = setOrRemoveDtsProp(
    body,
    "report-rate-lp2",
    `<${Math.round(next.reportRateLp2)}>`,
    indent
  );
  body = setOrRemoveDtsProp(
    body,
    "three-finger-swipe-throttle-ms",
    `<${Math.round(next.threeFingerSwipeThrottleMs)}>`,
    indent
  );
  body = setOrRemoveDtsProp(body, "filter-settings", `<${next.filterSettings}>`, indent);

  const boolPairs: Array<[string, boolean]> = [
    ["zoom", next.zoom],
    ["scroll", next.scroll],
    ["two-finger-tap", next.twoFingerTap],
    ["single-tap", next.singleTap],
    ["press-and-hold", next.pressAndHold],
    ["three-finger-swipe", next.threeFingerSwipe],
    ["switch-xy", next.switchXy],
    ["invert-scroll-y", next.invertScrollY],
    ["enable-power-management", next.enablePowerManagement],
  ];
  for (const [prop, enabled] of boolPairs) {
    body = setOrRemoveDtsProp(body, prop, enabled ? "" : null, indent);
  }

  return rightOverlay.slice(0, range.bodyStart) + body + rightOverlay.slice(range.bodyEnd);
}

function extractAngleList(line: string): string[] {
  const items: string[] = [];
  const re = /<([^>]+)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    items.push(m[1].trim());
  }
  return items;
}

export function parseTrackpadProcessors(
  dtsiContent: string
): TrackpadProcessorTuning {
  const clean = stripComments(dtsiContent);

  const listenerRange = findBlockRange(clean, /trackpad_listener\s*:\s*trackpad_listener\s*\{/);
  const listenerBody = listenerRange
    ? clean.slice(listenerRange.bodyStart, listenerRange.bodyEnd)
    : clean;

  const xyMatch = listenerBody.match(/&zip_xy_scaler\s+(\d+)\s+(\d+)/);
  const scrollMatch = listenerBody.match(/&zip_scroll_scaler\s+(\d+)\s+(\d+)/);

  const zoomRange = findBlockRange(clean, /zip_zoom_mapper\s*:\s*zip_zoom_mapper\s*\{/);
  const zoomBody = zoomRange ? clean.slice(zoomRange.bodyStart, zoomRange.bodyEnd) : "";
  const zoomBindingsLine = zoomBody.match(/bindings\s*=\s*([^;]+);/)?.[1] ?? "";
  const zoomBindings = extractAngleList(zoomBindingsLine);

  const dtRange = findBlockRange(
    clean,
    /two_finger_double_tap\s*:\s*two_finger_double_tap\s*\{/
  );
  const dtBody = dtRange ? clean.slice(dtRange.bodyStart, dtRange.bodyEnd) : "";
  const dtBindingsLine = dtBody.match(/bindings\s*=\s*([^;]+);/)?.[1] ?? "";
  const dtBindings = extractAngleList(dtBindingsLine);

  const touchRange = findBlockRange(
    clean,
    /is_touching_processor\s*:\s*is_touching_processor\s*\{/
  );
  const touchBody = touchRange ? clean.slice(touchRange.bodyStart, touchRange.bodyEnd) : "";
  const touchLayerMatch = touchBody.match(/bindings\s*=\s*<&mo\s+(\d+)>/);

  const scrollerRange = findBlockRange(listenerBody, /\bscroller\s*\{/);
  const scrollerBody = scrollerRange
    ? listenerBody.slice(scrollerRange.bodyStart, scrollerRange.bodyEnd)
    : "";
  const scrollerLayersMatch = scrollerBody.match(/layers\s*=\s*<([^>]+)>/);
  const scrollerLayers = scrollerLayersMatch
    ? scrollerLayersMatch[1]
        .trim()
        .split(/\s+/)
        .map((n) => parseInt(n, 10))
        .filter((n) => !Number.isNaN(n))
    : [1, 2];

  const swipeRange = findBlockRange(
    clean,
    /swipe_button_mapper\s*:\s*swipe_button_mapper\s*\{/
  );
  const swipeBody = swipeRange ? clean.slice(swipeRange.bodyStart, swipeRange.bodyEnd) : "";
  const elseIdx = swipeBody.indexOf("#else");
  const winPart = elseIdx >= 0 ? swipeBody.slice(0, elseIdx) : "";
  const macPart = elseIdx >= 0 ? swipeBody.slice(elseIdx) : swipeBody;
  const macLine = macPart.match(/bindings\s*=\s*([^;]+);/)?.[1] ?? "";
  const winLine = winPart.match(/bindings\s*=\s*([^;]+);/)?.[1] ?? "";
  const swipeBindings = extractAngleList(macLine);
  const swipeWinBindings = extractAngleList(winLine);

  return {
    xyScaleMul: xyMatch ? parseInt(xyMatch[1], 10) : 100,
    xyScaleDiv: xyMatch ? parseInt(xyMatch[2], 10) : 100,
    scrollScaleMul: scrollMatch ? parseInt(scrollMatch[1], 10) : 1,
    scrollScaleDiv: scrollMatch ? parseInt(scrollMatch[2], 10) : 20,
    zoomSensitivity: readIntProp(zoomBody, "sensitivity") ?? 10,
    zoomTrackRemainders: hasBoolProp(zoomBody, "track-remainders"),
    zoomOutBinding: zoomBindings[0] || "&cg_zoom_out",
    zoomInBinding: zoomBindings[1] || "&cg_zoom_in",
    doubleTapWindowMs: readIntProp(dtBody, "window-ms") ?? 250,
    doubleTapRequireCgSwap: hasBoolProp(dtBody, "require-cg-swap"),
    doubleTapSingleBinding: dtBindings[0] || "&mkp RCLK",
    doubleTapDoubleBinding: dtBindings[1] || "&cg_smart_zoom",
    touchLayer: touchLayerMatch ? parseInt(touchLayerMatch[1], 10) : 4,
    scrollerLayers,
    scrollerInvertX: scrollerBody.includes("INPUT_TRANSFORM_X_INVERT"),
    scrollerInvertY: scrollerBody.includes("INPUT_TRANSFORM_Y_INVERT"),
    winModeDefault: /^\s*#define\s+TOUCAN_WIN_MODE\b/m.test(clean),
    swipeBindings:
      swipeBindings.length === 4
        ? swipeBindings
        : ["&kp LC(LG(UP))", "&kp LC(LG(RIGHT))", "&kp LC(LG(DOWN))", "&kp LC(LG(LEFT))"],
    swipeWinBindings:
      swipeWinBindings.length === 4
        ? swipeWinBindings
        : ["&kp LG(TAB)", "&kp LG(RIGHT)", "&kp LG(D)", "&kp LG(LEFT)"],
  };
}

export function updateTrackpadProcessors(
  dtsiContent: string,
  next: TrackpadProcessorTuning
): string {
  let out = dtsiContent;

  // 0. TOUCAN_WIN_MODE define toggle
  if (next.winModeDefault) {
    out = out.replace(/^\s*\/\/\s*#define\s+TOUCAN_WIN_MODE\b/m, "#define TOUCAN_WIN_MODE");
  } else {
    out = out.replace(/^(\s*)#define\s+TOUCAN_WIN_MODE\b/m, "$1//#define TOUCAN_WIN_MODE");
  }

  // 1. zip_zoom_mapper
  const zoomRange = findBlockRange(out, /zip_zoom_mapper\s*:\s*zip_zoom_mapper\s*\{/);
  if (zoomRange) {
    let body = out.slice(zoomRange.bodyStart, zoomRange.bodyEnd);
    body = setOrRemoveDtsProp(
      body,
      "sensitivity",
      `<${Math.round(next.zoomSensitivity)}>`,
      "            "
    );
    body = setOrRemoveDtsProp(
      body,
      "track-remainders",
      next.zoomTrackRemainders ? "" : null,
      "            "
    );
    if (next.zoomOutBinding && next.zoomInBinding) {
      body = body.replace(
        /(bindings\s*=\s*)[^;]+;/,
        `$1<${next.zoomOutBinding.trim()}>, <${next.zoomInBinding.trim()}>;`
      );
    }
    out = out.slice(0, zoomRange.bodyStart) + body + out.slice(zoomRange.bodyEnd);
  }

  // 2. is_touching_processor layer
  const touchRange = findBlockRange(
    out,
    /is_touching_processor\s*:\s*is_touching_processor\s*\{/
  );
  if (touchRange) {
    let body = out.slice(touchRange.bodyStart, touchRange.bodyEnd);
    body = body.replace(
      /(bindings\s*=\s*<&mo\s+)\d+(>\s*;)/,
      `$1${Math.round(next.touchLayer)}$2`
    );
    out = out.slice(0, touchRange.bodyStart) + body + out.slice(touchRange.bodyEnd);
  }

  // 3. two_finger_double_tap
  const dtRange = findBlockRange(
    out,
    /two_finger_double_tap\s*:\s*two_finger_double_tap\s*\{/
  );
  if (dtRange) {
    let body = out.slice(dtRange.bodyStart, dtRange.bodyEnd);
    body = setOrRemoveDtsProp(
      body,
      "window-ms",
      `<${Math.round(next.doubleTapWindowMs)}>`,
      "            "
    );
    body = setOrRemoveDtsProp(
      body,
      "require-cg-swap",
      next.doubleTapRequireCgSwap ? "" : null,
      "            "
    );
    if (next.doubleTapSingleBinding && next.doubleTapDoubleBinding) {
      body = body.replace(
        /(bindings\s*=\s*)[^;]+;/,
        `$1<${next.doubleTapSingleBinding.trim()}>, <${next.doubleTapDoubleBinding.trim()}>;`
      );
    }
    out = out.slice(0, dtRange.bodyStart) + body + out.slice(dtRange.bodyEnd);
  }

  // 4. swipe_button_mapper (both macOS #else and Windows #ifdef)
  const swipeRange = findBlockRange(
    out,
    /swipe_button_mapper\s*:\s*swipe_button_mapper\s*\{/
  );
  if (swipeRange) {
    let body = out.slice(swipeRange.bodyStart, swipeRange.bodyEnd);
    const elseIdx = body.indexOf("#else");
    if (elseIdx >= 0) {
      let winPart = body.slice(0, elseIdx);
      let macPart = body.slice(elseIdx);
      if (next.swipeWinBindings?.length === 4) {
        const winFmt = next.swipeWinBindings.map((b) => `<${b.trim()}>`).join(", ");
        winPart = winPart.replace(/(bindings\s*=\s*)[^;]+;/, `$1${winFmt};`);
      }
      if (next.swipeBindings.length === 4) {
        const macFmt = next.swipeBindings.map((b) => `<${b.trim()}>`).join(", ");
        macPart = macPart.replace(/(bindings\s*=\s*)[^;]+;/, `$1${macFmt};`);
      }
      body = winPart + macPart;
    } else if (next.swipeBindings.length === 4) {
      const macFmt = next.swipeBindings.map((b) => `<${b.trim()}>`).join(", ");
      body = body.replace(/(bindings\s*=\s*)[^;]+;/, `$1${macFmt};`);
    }
    out = out.slice(0, swipeRange.bodyStart) + body + out.slice(swipeRange.bodyEnd);
  }

  // 5. trackpad_listener scalers & scroller
  const listenerRange = findBlockRange(out, /trackpad_listener\s*:\s*trackpad_listener\s*\{/);
  if (listenerRange) {
    let body = out.slice(listenerRange.bodyStart, listenerRange.bodyEnd);
    body = body.replace(
      /&zip_xy_scaler\s+\d+\s+\d+/,
      `&zip_xy_scaler ${Math.round(next.xyScaleMul)} ${Math.round(next.xyScaleDiv)}`
    );
    body = body.replace(
      /&zip_scroll_scaler\s+\d+\s+\d+/g,
      `&zip_scroll_scaler ${Math.round(next.scrollScaleMul)} ${Math.round(next.scrollScaleDiv)}`
    );
    if (next.scrollerLayers.length > 0) {
      const layersStr = next.scrollerLayers.map((l) => Math.round(l)).join(" ");
      body = body.replace(/(layers\s*=\s*<)[^>]+(>)/, `$1${layersStr}$2`);
    }

    const scrollerRange = findBlockRange(body, /\bscroller\s*\{/);
    if (scrollerRange) {
      let sBody = body.slice(scrollerRange.bodyStart, scrollerRange.bodyEnd);
      const flags: string[] = [];
      if (next.scrollerInvertX) flags.push("INPUT_TRANSFORM_X_INVERT");
      if (next.scrollerInvertY) flags.push("INPUT_TRANSFORM_Y_INVERT");
      const transformExpr =
        flags.length === 0
          ? ""
          : flags.length === 1
            ? `&zip_scroll_transform ${flags[0]}`
            : `&zip_scroll_transform (${flags.join(" | ")})`;

      if (/&zip_scroll_transform\s+[^\n>]+/.test(sBody)) {
        if (transformExpr) {
          sBody = sBody.replace(/&zip_scroll_transform\s+[^\n>]+/, transformExpr);
        } else {
          sBody = sBody.replace(/[ \t]*&zip_scroll_transform\s+[^\n>]+\n?/, "");
        }
      } else if (transformExpr) {
        sBody = sBody.replace(
          /(&zip_scroll_scaler\s+\d+\s+\d+)/,
          `$1\n                ${transformExpr}`
        );
      }
      body = body.slice(0, scrollerRange.bodyStart) + sBody + body.slice(scrollerRange.bodyEnd);
    }

    out = out.slice(0, listenerRange.bodyStart) + body + out.slice(listenerRange.bodyEnd);
  }

  return out;
}

function readConfValue(conf: string, key: string): string | null {
  const re = new RegExp(`^\\s*${key}\\s*=\\s*([^\\s#]+)`, "m");
  const m = conf.match(re);
  return m ? m[1].trim() : null;
}

function readKconfigDefault(kconfig: string, symbol: string): string | null {
  const re = new RegExp(
    `(?:menu)?config\\s+${symbol}\\b[\\s\\S]*?^\\s*default\\s+([^\\s#]+)`,
    "m"
  );
  const m = kconfig.match(re);
  return m ? m[1].trim() : null;
}

function setConfValue(conf: string, key: string, value: string): string {
  const re = new RegExp(`^(\\s*${key}\\s*=\\s*)[^\\s#]+`, "m");
  if (re.test(conf)) {
    return conf.replace(re, `$1${value}`);
  }
  const sep = conf.endsWith("\n") ? "" : "\n";
  return `${conf}${sep}${key}=${value}\n`;
}

export function parseConfTuning(
  leftConf: string,
  rightConf: string,
  kconfig: string
): FirmwareConfTuning {
  const num = (v: string | null, fallback: number) => {
    if (v === null) return fallback;
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? fallback : n;
  };
  const boolVal = (v: string | null, fallback: boolean) => {
    if (v === null) return fallback;
    return v === "y" || v === "true";
  };

  return {
    idleTimeoutMs: num(readConfValue(leftConf, "CONFIG_ZMK_IDLE_TIMEOUT"), 30000),
    idleSleepTimeoutMs: num(
      readConfValue(leftConf, "CONFIG_ZMK_IDLE_SLEEP_TIMEOUT"),
      3600000
    ),
    statusScreenStyle: num(readConfValue(leftConf, "CONFIG_TOUCAN_STATUS_SCREEN"), 2),
    inputThreadStackSize: num(
      readConfValue(leftConf, "CONFIG_INPUT_THREAD_STACK_SIZE"),
      2048
    ),
    cgToggleEnabled: boolVal(
      readConfValue(leftConf, "CONFIG_ZMK_CG_TOGGLE") ??
        readKconfigDefault(kconfig, "ZMK_CG_TOGGLE"),
      true
    ),
    cgToggleSaveDelayMs: num(
      readConfValue(leftConf, "CONFIG_ZMK_CG_TOGGLE_SAVE_DELAY_MS") ??
        readKconfigDefault(kconfig, "ZMK_CG_TOGGLE_SAVE_DELAY_MS"),
      1000
    ),
    cgToggleDebug: boolVal(readConfValue(leftConf, "CONFIG_ZMK_CG_TOGGLE_DEBUG"), false),
    splitInputRelayEnabled: boolVal(
      readConfValue(rightConf, "CONFIG_TOUCAN_SPLIT_INPUT_RELAY") ??
        readKconfigDefault(kconfig, "TOUCAN_SPLIT_INPUT_RELAY"),
      true
    ),
    splitInputRelayQueueSize: num(
      readConfValue(rightConf, "CONFIG_TOUCAN_SPLIT_INPUT_RELAY_QUEUE_SIZE") ??
        readKconfigDefault(kconfig, "TOUCAN_SPLIT_INPUT_RELAY_QUEUE_SIZE"),
      32
    ),
    splitInputRelayStackSize: num(
      readConfValue(rightConf, "CONFIG_TOUCAN_SPLIT_INPUT_RELAY_STACK_SIZE") ??
        readKconfigDefault(kconfig, "TOUCAN_SPLIT_INPUT_RELAY_STACK_SIZE"),
      1536
    ),
  };
}

export function updateConfTuning(
  leftConf: string,
  rightConf: string,
  next: FirmwareConfTuning
): { leftConf: string; rightConf: string } {
  let left = leftConf;
  let right = rightConf;

  left = setConfValue(left, "CONFIG_ZMK_IDLE_TIMEOUT", String(Math.round(next.idleTimeoutMs)));
  right = setConfValue(right, "CONFIG_ZMK_IDLE_TIMEOUT", String(Math.round(next.idleTimeoutMs)));

  left = setConfValue(
    left,
    "CONFIG_ZMK_IDLE_SLEEP_TIMEOUT",
    String(Math.round(next.idleSleepTimeoutMs))
  );
  right = setConfValue(
    right,
    "CONFIG_ZMK_IDLE_SLEEP_TIMEOUT",
    String(Math.round(next.idleSleepTimeoutMs))
  );

  left = setConfValue(
    left,
    "CONFIG_TOUCAN_STATUS_SCREEN",
    String(Math.round(next.statusScreenStyle))
  );
  left = setConfValue(
    left,
    "CONFIG_INPUT_THREAD_STACK_SIZE",
    String(Math.round(next.inputThreadStackSize))
  );
  right = setConfValue(
    right,
    "CONFIG_INPUT_THREAD_STACK_SIZE",
    String(Math.round(next.inputThreadStackSize))
  );

  left = setConfValue(left, "CONFIG_ZMK_CG_TOGGLE", next.cgToggleEnabled ? "y" : "n");
  left = setConfValue(
    left,
    "CONFIG_ZMK_CG_TOGGLE_SAVE_DELAY_MS",
    String(Math.round(next.cgToggleSaveDelayMs))
  );
  if (next.cgToggleDebug || readConfValue(left, "CONFIG_ZMK_CG_TOGGLE_DEBUG") !== null) {
    left = setConfValue(left, "CONFIG_ZMK_CG_TOGGLE_DEBUG", next.cgToggleDebug ? "y" : "n");
  }

  right = setConfValue(
    right,
    "CONFIG_TOUCAN_SPLIT_INPUT_RELAY",
    next.splitInputRelayEnabled ? "y" : "n"
  );
  right = setConfValue(
    right,
    "CONFIG_TOUCAN_SPLIT_INPUT_RELAY_QUEUE_SIZE",
    String(Math.round(next.splitInputRelayQueueSize))
  );
  right = setConfValue(
    right,
    "CONFIG_TOUCAN_SPLIT_INPUT_RELAY_STACK_SIZE",
    String(Math.round(next.splitInputRelayStackSize))
  );

  return { leftConf: left, rightConf: right };
}

export function parseKeymapLayers(keymapContent: string): RepoKeymapLayer[] {
  const clean = stripComments(keymapContent);
  const keymapRange = findBlockRange(clean, /\bkeymap\s*\{/);
  if (!keymapRange) return [];

  const body = clean.slice(keymapRange.bodyStart, keymapRange.bodyEnd);
  const layers: RepoKeymapLayer[] = [];
  const layerHeaderRe = /([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;
  let m: RegExpExecArray | null;

  while ((m = layerHeaderRe.exec(body)) !== null) {
    const id = m[1];
    const sub = body.slice(m.index);
    const range = findBlockRange(sub, /^[A-Za-z_][A-Za-z0-9_]*\s*\{/);
    if (!range) continue;

    const lBody = sub.slice(range.bodyStart, range.bodyEnd);
    const reserved = /status\s*=\s*"reserved"\s*;/.test(lBody);
    const displayNameMatch = lBody.match(/display-name\s*=\s*"([^"]+)"\s*;/);
    const bindingsMatch = lBody.match(/bindings\s*=\s*<([\s\S]*?)>\s*;/);

    const bindings: string[] = [];
    if (bindingsMatch) {
      const raw = bindingsMatch[1].trim();
      const parts = raw
        .split(/(?=&[A-Za-z_])/)
        .map((s) => s.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      bindings.push(...parts);
    }

    layers.push({
      id,
      displayName: displayNameMatch ? displayNameMatch[1] : id.toUpperCase(),
      bindings,
      reserved: reserved || undefined,
    });

    layerHeaderRe.lastIndex = m.index + range.end;
  }

  return layers;
}
