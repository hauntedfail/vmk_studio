export interface ZmkKeycodeGroup {
  group: string;
  codes: Array<{ code: string; label: string }>;
}

export const ZMK_MOD_WRAPPERS = [
  { id: "LC", label: "L Ctrl" },
  { id: "LS", label: "L Shift" },
  { id: "LA", label: "L Alt" },
  { id: "LG", label: "L GUI" },
  { id: "RC", label: "R Ctrl" },
  { id: "RS", label: "R Shift" },
  { id: "RA", label: "R Alt" },
  { id: "RG", label: "R GUI" },
] as const;

export const ZMK_KEYCODE_GROUPS: ZmkKeycodeGroup[] = [
  {
    group: "Letters",
    codes: "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((ch) => ({ code: ch, label: ch })),
  },
  {
    group: "Numbers",
    codes: ["N1", "N2", "N3", "N4", "N5", "N6", "N7", "N8", "N9", "N0"].map((c) => ({
      code: c,
      label: c.slice(1),
    })),
  },
  {
    group: "Modifiers",
    codes: [
      { code: "LCTRL", label: "Left Ctrl" },
      { code: "LSHFT", label: "Left Shift" },
      { code: "LALT", label: "Left Alt" },
      { code: "LGUI", label: "Left GUI (Cmd/Win)" },
      { code: "RCTRL", label: "Right Ctrl" },
      { code: "RSHFT", label: "Right Shift" },
      { code: "RALT", label: "Right Alt" },
      { code: "RGUI", label: "Right GUI" },
    ],
  },
  {
    group: "Editing & Navigation",
    codes: [
      { code: "SPACE", label: "Space" },
      { code: "RET", label: "Enter" },
      { code: "TAB", label: "Tab" },
      { code: "BSPC", label: "Backspace" },
      { code: "DEL", label: "Delete" },
      { code: "ESC", label: "Escape" },
      { code: "CAPS", label: "Caps Lock" },
      { code: "LEFT", label: "Left Arrow" },
      { code: "DOWN", label: "Down Arrow" },
      { code: "UP", label: "Up Arrow" },
      { code: "RIGHT", label: "Right Arrow" },
      { code: "HOME", label: "Home" },
      { code: "END", label: "End" },
      { code: "PG_UP", label: "Page Up" },
      { code: "PG_DN", label: "Page Down" },
    ],
  },
  {
    group: "Symbols",
    codes: [
      { code: "MINUS", label: "- (Minus)" },
      { code: "EQUAL", label: "= (Equal)" },
      { code: "LBKT", label: "[ (Left Bracket)" },
      { code: "RBKT", label: "] (Right Bracket)" },
      { code: "BSLH", label: "\\ (Backslash)" },
      { code: "SEMI", label: "; (Semicolon)" },
      { code: "SQT", label: "' (Quote)" },
      { code: "GRAVE", label: "` (Grave)" },
      { code: "COMMA", label: ", (Comma)" },
      { code: "DOT", label: ". (Period)" },
      { code: "FSLH", label: "/ (Slash)" },
      { code: "EXCL", label: "!" },
      { code: "AT", label: "@" },
      { code: "HASH", label: "#" },
      { code: "DLLR", label: "$" },
      { code: "PRCNT", label: "%" },
      { code: "CARET", label: "^" },
      { code: "AMPS", label: "&" },
      { code: "ASTRK", label: "*" },
      { code: "LPAR", label: "(" },
      { code: "RPAR", label: ")" },
      { code: "UNDER", label: "_" },
      { code: "PLUS", label: "+" },
      { code: "LBRC", label: "{" },
      { code: "RBRC", label: "}" },
      { code: "PIPE", label: "|" },
      { code: "TILDE", label: "~" },
    ],
  },
  {
    group: "Function Keys",
    codes: Array.from({ length: 24 }, (_, i) => ({
      code: `F${i + 1}`,
      label: `F${i + 1}`,
    })),
  },
  {
    group: "Media & System",
    codes: [
      { code: "C_VOL_UP", label: "Volume Up" },
      { code: "C_VOL_DN", label: "Volume Down" },
      { code: "C_MUTE", label: "Mute" },
      { code: "C_PP", label: "Play / Pause" },
      { code: "C_NEXT", label: "Next Track" },
      { code: "C_PREV", label: "Prev Track" },
      { code: "C_BRI_UP", label: "Brightness Up" },
      { code: "C_BRI_DN", label: "Brightness Down" },
      { code: "LANG1", label: "Kana / Lang 1" },
      { code: "LANG2", label: "Eisu / Lang 2" },
    ],
  },
];

export const ALL_ZMK_KEYCODES = ZMK_KEYCODE_GROUPS.flatMap((g) => g.codes);

export function unwrapZmkMods(expr: string): { mods: string[]; base: string } {
  const mods: string[] = [];
  let cur = expr.trim();
  const re = /^(LC|LS|LA|LG|RC|RS|RA|RG)\((.+)\)$/;
  let m = cur.match(re);
  while (m) {
    mods.push(m[1]);
    cur = m[2].trim();
    m = cur.match(re);
  }
  return { mods, base: cur };
}

export function wrapZmkMods(base: string, mods: string[]): string {
  return mods.reduceRight((acc, mod) => `${mod}(${acc})`, base.trim());
}

const MOD_GLYPHS: Record<string, string> = {
  LC: "⌃",
  RC: "⌃",
  LS: "⇧",
  RS: "⇧",
  LA: "⌥",
  RA: "⌥",
  LG: "⌘",
  RG: "⌘",
};

const KEYCAP_LEGEND_MAP: Record<string, string> = {
  // Modifiers (Apple / MBK minimal symbols)
  LCTRL: "⌃",
  RCTRL: "⌃",
  LSHFT: "⇧",
  LSHIFT: "⇧",
  RSHFT: "⇧",
  RSHIFT: "⇧",
  LALT: "⌥",
  RALT: "⌥",
  LGUI: "⌘",
  LCMD: "⌘",
  LWIN: "⌘",
  RGUI: "⌘",
  RCMD: "⌘",
  RWIN: "⌘",
  // Editing & control
  TAB: "⇥",
  BSPC: "⌫",
  BACKSPACE: "⌫",
  DEL: "⌦",
  DELETE: "⌦",
  RET: "↵",
  ENTER: "↵",
  RETURN: "↵",
  ESC: "⎋",
  ESCAPE: "⎋",
  SPACE: "␣",
  CAPS: "⇪",
  CAPSLOCK: "⇪",
  // Navigation
  LEFT: "←",
  DOWN: "↓",
  UP: "↑",
  RIGHT: "→",
  HOME: "↖",
  END: "↘",
  PG_UP: "⇞",
  PG_DN: "⇟",
  // Punctuation & symbols
  COMMA: ",",
  DOT: ".",
  SEMI: ";",
  SQT: "'",
  FSLH: "/",
  BSLH: "\\",
  MINUS: "-",
  EQUAL: "=",
  LBKT: "[",
  RBKT: "]",
  GRAVE: "`",
  EXCL: "!",
  AT: "@",
  HASH: "#",
  DLLR: "$",
  PRCNT: "%",
  CARET: "^",
  AMPS: "&",
  STAR: "*",
  ASTRK: "*",
  KP_MULTIPLY: "*",
  LPAR: "(",
  RPAR: ")",
  UNDER: "_",
  PLUS: "+",
  LBRC: "{",
  RBRC: "}",
  PIPE: "|",
  TILDE: "~",
  LT: "<",
  GT: ">",
  QMARK: "?",
  COLON: ":",
  DQT: '"',
  // Numbers
  N0: "0",
  N1: "1",
  N2: "2",
  N3: "3",
  N4: "4",
  N5: "5",
  N6: "6",
  N7: "7",
  N8: "8",
  N9: "9",
  // Media
  C_VOL_UP: "Vol+",
  C_VOL_DN: "Vol-",
  C_MUTE: "Mute",
  C_PP: "⏯",
  C_NEXT: "⏭",
  C_PREV: "⏮",
  C_BRI_UP: "Bri+",
  C_BRI_DN: "Bri-",
};

/**
 * Formats a ZMK keycode expression (including wrapped modifiers like LC(LG(UP)))
 * into a clean, compact keycap legend with ample optical breathing room.
 */
export function formatZmkKeycapLegend(expr: string): string {
  const trimmed = expr.trim();
  if (!trimmed) return "";
  const { mods, base } = unwrapZmkMods(trimmed);
  const baseLabel = KEYCAP_LEGEND_MAP[base] ?? base;
  if (mods.length === 0) return baseLabel;
  const modPrefix = mods.map((m) => MOD_GLYPHS[m] ?? m).join("");
  return `${modPrefix}${baseLabel}`;
}
