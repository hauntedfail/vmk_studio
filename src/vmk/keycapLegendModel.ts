import { parseDtsBindingExpr } from "./keymapCodec";
import { formatZmkKeycapLegend, unwrapZmkMods } from "./zmkKeycodes";
import { decodeHidUsageWithMods, formatHidUsageShort } from "./customBehaviors";
import type { CustomBehaviorDef } from "./types";

export type KeycapIconId =
  | "vol-up"
  | "vol-dn"
  | "mute"
  | "play"
  | "next"
  | "prev"
  | "bri-up"
  | "bri-dn"
  | "bt"
  | "usb"
  | "out-tog"
  | "mouse"
  | "unlock"
  | "bootloader"
  | "reset"
  | "cg-swap"
  | "zoom-in"
  | "zoom-out"
  | "smart-zoom"
  | "nav-back"
  | "nav-fwd"
  | "caps-word"
  | "repeat";

export interface KeycapLegendSpec {
  kind: "glyph" | "icon" | "muted";
  text?: string;
  icon?: KeycapIconId;
  sub?: string;
  header?: string;
  secondaryLabel?: string;
}

const KEYCODE_TO_ICON: Record<string, KeycapIconId> = {
  C_VOL_UP: "vol-up",
  C_VOLUME_UP: "vol-up",
  C_VOL_DN: "vol-dn",
  C_VOLUME_DOWN: "vol-dn",
  C_MUTE: "mute",
  C_PP: "play",
  C_PLAY_PAUSE: "play",
  C_NEXT: "next",
  C_PREV: "prev",
  C_BRI_UP: "bri-up",
  C_BRIGHTNESS_INC: "bri-up",
  C_BRI_DN: "bri-dn",
  C_BRIGHTNESS_DEC: "bri-dn",
};

const HID_KEYBOARD_GLYPHS: Record<number, string> = {
  0x04: "A", 0x05: "B", 0x06: "C", 0x07: "D", 0x08: "E", 0x09: "F",
  0x0a: "G", 0x0b: "H", 0x0c: "I", 0x0d: "J", 0x0e: "K", 0x0f: "L",
  0x10: "M", 0x11: "N", 0x12: "O", 0x13: "P", 0x14: "Q", 0x15: "R",
  0x16: "S", 0x17: "T", 0x18: "U", 0x19: "V", 0x1a: "W", 0x1b: "X",
  0x1c: "Y", 0x1d: "Z",
  0x1e: "1", 0x1f: "2", 0x20: "3", 0x21: "4", 0x22: "5",
  0x23: "6", 0x24: "7", 0x25: "8", 0x26: "9", 0x27: "0",
  0x28: "↵", 0x29: "⎋", 0x2a: "⌫", 0x2b: "⇥", 0x2c: "␣",
  0x2d: "-", 0x2e: "=", 0x2f: "[", 0x30: "]", 0x31: "\\",
  0x32: "#", 0x33: ";", 0x34: "'", 0x35: "`", 0x36: ",", 0x37: ".", 0x38: "/",
  0x39: "⇪",
  0x3a: "F1", 0x3b: "F2", 0x3c: "F3", 0x3d: "F4", 0x3e: "F5", 0x3f: "F6",
  0x40: "F7", 0x41: "F8", 0x42: "F9", 0x43: "F10", 0x44: "F11", 0x45: "F12",
  0x4a: "↖", 0x4b: "⇞", 0x4c: "⌦", 0x4d: "↘", 0x4e: "⇟",
  0x4f: "→", 0x50: "←", 0x51: "↓", 0x52: "↑",
  0x55: "*",
  0x90: "あ", 0x91: "英",
  0xe0: "⌃", 0xe1: "⇧", 0xe2: "⌥", 0xe3: "⌘",
  0xe4: "⌃", 0xe5: "⇧", 0xe6: "⌥", 0xe7: "⌘",
};

const HID_SHIFTED_SYMBOLS: Record<number, string> = {
  0x1e: "!", 0x1f: "@", 0x20: "#", 0x21: "$", 0x22: "%",
  0x23: "^", 0x24: "&", 0x25: "*", 0x26: "(", 0x27: ")",
  0x2d: "_", 0x2e: "+", 0x2f: "{", 0x30: "}", 0x31: "|",
  0x33: ":", 0x34: '"', 0x35: "~", 0x36: "<", 0x37: ">", 0x38: "?",
};

const HID_CONSUMER_ICONS: Record<number, KeycapIconId> = {
  0xe9: "vol-up",
  0xea: "vol-dn",
  0xe2: "mute",
  0xcd: "play",
  0xb5: "next",
  0xb6: "prev",
  0x6f: "bri-up",
  0x70: "bri-dn",
};

function formatModMaskCompact(modMask: number): string {
  let out = "";
  if (modMask & (0x01 | 0x10)) out += "⌃";
  if (modMask & (0x02 | 0x20)) out += "⇧";
  if (modMask & (0x04 | 0x40)) out += "⌥";
  if (modMask & (0x08 | 0x80)) out += "⌘";
  return out;
}

export function resolveHidUsageLegend(usage: number): KeycapLegendSpec {
  if (!usage) return { kind: "muted", text: "·" };
  const decoded = decodeHidUsageWithMods(usage);

  if (decoded.page === 0x0c) {
    const icon = HID_CONSUMER_ICONS[decoded.id];
    if (icon) return { kind: "icon", icon };
  }

  if (decoded.page === 0x07) {
    const shiftOnly =
      (decoded.modMask === 0x02 || decoded.modMask === 0x20) &&
      HID_SHIFTED_SYMBOLS[decoded.id];
    if (shiftOnly) {
      return { kind: "glyph", text: HID_SHIFTED_SYMBOLS[decoded.id] };
    }
    const baseGlyph = HID_KEYBOARD_GLYPHS[decoded.id];
    if (baseGlyph) {
      const modPrefix = formatModMaskCompact(decoded.modMask);
      return { kind: "glyph", text: `${modPrefix}${baseGlyph}` };
    }
  }

  const fallback = formatHidUsageShort(usage);
  return { kind: "glyph", text: formatZmkKeycapLegend(fallback) || "?" };
}

function resolveNamedBehaviorLegend(nameOrLabel: string): KeycapLegendSpec | null {
  const norm = nameOrLabel.trim().toLowerCase();
  if (norm === "studio_unlock" || norm === "studio unlock") {
    return { kind: "icon", icon: "unlock" };
  }
  if (norm === "bootloader") {
    return { kind: "icon", icon: "bootloader" };
  }
  if (norm === "sys_reset" || norm === "reset") {
    return { kind: "icon", icon: "reset" };
  }
  if (norm === "caps_word" || norm === "caps word") {
    return { kind: "icon", icon: "caps-word" };
  }
  if (norm === "key_repeat" || norm === "key repeat") {
    return { kind: "icon", icon: "repeat" };
  }
  if (norm === "cg_toggle" || norm === "toggle ctrl gui") {
    return { kind: "icon", icon: "cg-swap", sub: "CG" };
  }
  if (norm === "cg_toggle_on" || norm === "ctrl gui swap on") {
    return { kind: "icon", icon: "cg-swap", sub: "+" };
  }
  if (norm === "cg_toggle_off" || norm === "ctrl gui swap off") {
    return { kind: "icon", icon: "cg-swap", sub: "-" };
  }
  if (norm === "cg_zoom_in" || norm === "pinch zoom in") {
    return { kind: "icon", icon: "zoom-in" };
  }
  if (norm === "cg_zoom_out" || norm === "pinch zoom out") {
    return { kind: "icon", icon: "zoom-out" };
  }
  if (norm === "cg_smart_zoom" || norm === "smart zoom") {
    return { kind: "icon", icon: "smart-zoom" };
  }
  if (norm === "cg_back" || norm === "browser back") {
    return { kind: "icon", icon: "nav-back" };
  }
  if (norm === "cg_forward" || norm === "browser forward") {
    return { kind: "icon", icon: "nav-fwd" };
  }
  return null;
}

export function resolveDtsBindingLegend(
  bindingStr: string,
  layers: Array<{ displayName: string }>,
  customDefs: CustomBehaviorDef[],
  reserved = false
): KeycapLegendSpec {
  if (reserved) return { kind: "muted", text: "—" };

  const parsed = parseDtsBindingExpr(bindingStr);
  const bare = parsed.behavior.replace(/^&/, "");

  if (parsed.behavior === "&trans") return { kind: "muted", text: "▽" };
  if (parsed.behavior === "&none") return { kind: "muted", text: "·" };

  const named = resolveNamedBehaviorLegend(bare);
  if (named) return named;

  if (parsed.behavior === "&kp" || parsed.behavior === "&sk" || parsed.behavior === "&kt") {
    const expr = parsed.params.join(" ");
    const { mods, base } = unwrapZmkMods(expr);
    if (mods.length === 0 && KEYCODE_TO_ICON[base]) {
      return {
        kind: "icon",
        icon: KEYCODE_TO_ICON[base],
        header: parsed.behavior === "&kp" ? undefined : bare.toUpperCase(),
      };
    }
    return {
      kind: "glyph",
      text: formatZmkKeycapLegend(expr) || "?",
      header: parsed.behavior === "&kp" ? undefined : bare.toUpperCase(),
    };
  }

  if (parsed.behavior === "&mt") {
    return {
      kind: "glyph",
      text: formatZmkKeycapLegend(parsed.params[1] || "?") || "?",
      secondaryLabel: parsed.params[0]
        ? formatZmkKeycapLegend(parsed.params[0])
        : undefined,
    };
  }

  if (parsed.behavior === "&lt") {
    const lIdx = parseInt(parsed.params[0] || "0", 10);
    const lName = layers[lIdx]?.displayName || `L${parsed.params[0] ?? 0}`;
    return {
      kind: "glyph",
      text: formatZmkKeycapLegend(parsed.params[1] || "?") || "?",
      secondaryLabel: lName,
    };
  }

  if (["&mo", "&to", "&tog", "&sl"].includes(parsed.behavior)) {
    const lIdx = parseInt(parsed.params[0] || "0", 10);
    const lName =
      Number.isFinite(lIdx) && layers[lIdx]
        ? layers[lIdx].displayName
        : formatZmkKeycapLegend(parsed.params[0] || "?");
    return {
      kind: "glyph",
      text: lName,
      header: parsed.behavior === "&mo" ? undefined : bare.toUpperCase(),
    };
  }

  if (parsed.behavior === "&bt") {
    const cmd = parsed.params[0] || "";
    if (cmd === "BT_SEL") {
      return { kind: "icon", icon: "bt", sub: parsed.params[1] ?? "0" };
    }
    if (cmd === "BT_CLR" || cmd === "BT_CLR_ALL") {
      return { kind: "icon", icon: "bt", sub: "×" };
    }
    if (cmd === "BT_NXT") {
      return { kind: "icon", icon: "bt", sub: "›" };
    }
    if (cmd === "BT_PRV") {
      return { kind: "icon", icon: "bt", sub: "‹" };
    }
    if (cmd === "BT_DISC") {
      return { kind: "icon", icon: "bt", sub: `-${parsed.params[1] ?? ""}` };
    }
    return { kind: "icon", icon: "bt", sub: cmd.replace(/^BT_/, "").slice(0, 3) };
  }

  if (parsed.behavior === "&out") {
    const cmd = parsed.params[0] || "";
    if (cmd === "OUT_USB") return { kind: "icon", icon: "usb" };
    if (cmd === "OUT_BLE") return { kind: "icon", icon: "bt" };
    return { kind: "icon", icon: "out-tog" };
  }

  if (parsed.behavior === "&mkp") {
    const btn = (parsed.params[0] || "")
      .replace(/^MB/, "")
      .replace(/CLK$/, "");
    return { kind: "icon", icon: "mouse", sub: btn || "·" };
  }

  const customDef = customDefs.find((d) => d.label === bare);
  if (customDef) {
    const customNamed = resolveNamedBehaviorLegend(customDef.displayName);
    if (customNamed) return customNamed;
    return { kind: "glyph", text: customDef.displayName.slice(0, 4) };
  }

  return {
    kind: "glyph",
    header: parsed.params.length > 0 ? bare.toUpperCase() : undefined,
    text: parsed.params.length > 0 ? parsed.params.join(" ") : bare,
  };
}

export function resolveStudioBindingLegend(
  displayName: string | undefined,
  param1: number,
  param2: number,
  layers: Array<{ id: number; name?: string }>
): KeycapLegendSpec {
  const name = (displayName || "").trim();

  if (name === "Transparent" || name === "Behavior Transparent") {
    return { kind: "muted", text: "▽" };
  }
  if (name === "None" || name === "Behavior None") {
    return { kind: "muted", text: "·" };
  }

  const named = resolveNamedBehaviorLegend(name);
  if (named) return named;

  if (name === "Key Press" || name === "Sticky Key" || name === "Key Toggle") {
    const inner = resolveHidUsageLegend(param1);
    return {
      ...inner,
      header:
        name === "Key Press"
          ? undefined
          : name === "Sticky Key"
            ? "SK"
            : "KT",
    };
  }

  if (name === "Mod-Tap") {
    const tap = resolveHidUsageLegend(param2);
    const hold = resolveHidUsageLegend(param1);
    return {
      ...tap,
      secondaryLabel: hold.text || undefined,
    };
  }

  if (name === "Layer-Tap") {
    const layer = layers.find((l) => l.id === param1);
    const tap = resolveHidUsageLegend(param2);
    return {
      ...tap,
      secondaryLabel: layer?.name || `L${param1}`,
    };
  }

  if (
    name === "Momentary Layer" ||
    name === "To Layer" ||
    name === "Toggle Layer" ||
    name === "Sticky Layer"
  ) {
    const layer = layers.find((l) => l.id === param1);
    const modeHeader =
      name === "Momentary Layer"
        ? undefined
        : name === "To Layer"
          ? "TO"
          : name === "Toggle Layer"
            ? "TOG"
            : "SL";
    return {
      kind: "glyph",
      text: layer?.name || `L${param1}`,
      header: modeHeader,
    };
  }

  if (name === "Bluetooth") {
    const subs: Record<number, string> = {
      0: "×",
      1: "›",
      2: "‹",
      3: String(param2),
      4: "×",
      5: `-${param2}`,
    };
    return { kind: "icon", icon: "bt", sub: subs[param1] ?? String(param1) };
  }

  if (name === "Output Selection") {
    if (param1 === 1) return { kind: "icon", icon: "usb" };
    if (param1 === 2) return { kind: "icon", icon: "bt" };
    return { kind: "icon", icon: "out-tog" };
  }

  if (name === "Mouse Key Press") {
    const btns: Record<number, string> = { 1: "L", 2: "R", 4: "M", 8: "4", 16: "5" };
    return { kind: "icon", icon: "mouse", sub: btns[param1] ?? String(param1) };
  }

  if (!name && param1) {
    return resolveHidUsageLegend(param1);
  }

  return {
    kind: "glyph",
    text: (name || "—").slice(0, 6),
  };
}
