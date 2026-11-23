import type {
  ComboDef,
  ConditionalLayerRule,
  CustomBehaviorDef,
  RepoKeymapLayer,
  RepoKeymapSavePayload,
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

export interface ParsedDtsBinding {
  behavior: string;
  params: string[];
}

export function parseDtsBindingExpr(expr: string): ParsedDtsBinding {
  const trimmed = expr.trim();
  if (!trimmed) return { behavior: "&trans", params: [] };

  const tokens: string[] = [];
  let cur = "";
  let parenDepth = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "(") parenDepth++;
    else if (ch === ")") parenDepth = Math.max(0, parenDepth - 1);

    if (/\s/.test(ch) && parenDepth === 0) {
      if (cur) {
        tokens.push(cur);
        cur = "";
      }
    } else {
      cur += ch;
    }
  }
  if (cur) tokens.push(cur);

  return {
    behavior: tokens[0] || "&trans",
    params: tokens.slice(1),
  };
}

export function formatDtsBindingExpr(behavior: string, params: string[]): string {
  const cleanBeh = behavior.startsWith("&") ? behavior.trim() : `&${behavior.trim()}`;
  const cleanParams = params.map((p) => p.trim()).filter(Boolean);
  return cleanParams.length > 0 ? `${cleanBeh} ${cleanParams.join(" ")}` : cleanBeh;
}

export function parseConditionalLayers(keymapContent: string): ConditionalLayerRule[] {
  const clean = stripComments(keymapContent);
  const block = findBlockRange(clean, /\bconditional_layers\s*\{/);
  if (!block) return [];

  const body = clean.slice(block.bodyStart, block.bodyEnd);
  const rules: ConditionalLayerRule[] = [];
  const ruleRe = /([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;
  let m: RegExpExecArray | null;

  while ((m = ruleRe.exec(body)) !== null) {
    const name = m[1];
    const sub = body.slice(m.index);
    const range = findBlockRange(sub, /^[A-Za-z_][A-Za-z0-9_]*\s*\{/);
    if (!range) continue;

    const rBody = sub.slice(range.bodyStart, range.bodyEnd);
    const ifMatch = rBody.match(/if-layers\s*=\s*<([^>]+)>/);
    const thenMatch = rBody.match(/then-layer\s*=\s*<(\d+)>/);
    if (ifMatch && thenMatch) {
      const ifLayers = ifMatch[1]
        .trim()
        .split(/\s+/)
        .map((n) => parseInt(n, 10))
        .filter((n) => !Number.isNaN(n));
      rules.push({
        name,
        ifLayers,
        thenLayer: parseInt(thenMatch[1], 10),
      });
    }
    ruleRe.lastIndex = m.index + range.end;
  }

  return rules;
}

export function parseCombos(keymapContent: string): ComboDef[] {
  const clean = stripComments(keymapContent);
  const block = findBlockRange(clean, /\bcombos\s*\{/);
  if (!block) return [];

  const body = clean.slice(block.bodyStart, block.bodyEnd);
  const combos: ComboDef[] = [];
  const comboRe = /([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;
  let m: RegExpExecArray | null;

  while ((m = comboRe.exec(body)) !== null) {
    const name = m[1];
    const sub = body.slice(m.index);
    const range = findBlockRange(sub, /^[A-Za-z_][A-Za-z0-9_]*\s*\{/);
    if (!range) continue;

    const cBody = sub.slice(range.bodyStart, range.bodyEnd);
    const timeoutMatch = cBody.match(/timeout-ms\s*=\s*<(\d+)>/);
    const posMatch = cBody.match(/key-positions\s*=\s*<([^>]+)>/);
    const bindMatch = cBody.match(/bindings\s*=\s*<([^>]+)>/);
    const layersMatch = cBody.match(/layers\s*=\s*<([^>]+)>/);

    if (posMatch && bindMatch) {
      const keyPositions = posMatch[1]
        .trim()
        .split(/\s+/)
        .map((n) => parseInt(n, 10))
        .filter((n) => !Number.isNaN(n));
      const layers = layersMatch
        ? layersMatch[1]
            .trim()
            .split(/\s+/)
            .map((n) => parseInt(n, 10))
            .filter((n) => !Number.isNaN(n))
        : undefined;
      combos.push({
        name,
        timeoutMs: timeoutMatch ? parseInt(timeoutMatch[1], 10) : 50,
        keyPositions,
        bindings: bindMatch[1].trim(),
        layers,
      });
    }

    comboRe.lastIndex = m.index + range.end;
  }

  return combos;
}

function formatBindingsGrid(bindings: string[]): string {
  const safe = bindings.map((b) => b.trim() || "&trans");
  if (safe.length === 42) {
    const rows = [
      safe.slice(0, 12),
      safe.slice(12, 24),
      safe.slice(24, 36),
      safe.slice(36, 42),
    ];
    // Compute column widths for neat visual alignment
    const colWidths = Array(12).fill(0);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 12; c++) {
        colWidths[c] = Math.max(colWidths[c], rows[r][c].length);
      }
    }
    const formatRow12 = (row: string[]) => {
      const left = row
        .slice(0, 6)
        .map((cell, i) => cell.padEnd(colWidths[i]))
        .join(" ");
      const right = row
        .slice(6, 12)
        .map((cell, i) => (i === 5 ? cell : cell.padEnd(colWidths[i + 6])))
        .join(" ");
      return `                ${left}   ${right}`;
    };
    const thumbLeft = rows[3].slice(0, 3).join(" ");
    const thumbRight = rows[3].slice(3, 6).join(" ");
    return [
      formatRow12(rows[0]),
      formatRow12(rows[1]),
      formatRow12(rows[2]),
      `                                ${thumbLeft}   ${thumbRight}`,
    ].join("\n");
  }

  const lines: string[] = [];
  for (let i = 0; i < safe.length; i += 12) {
    lines.push(`                ${safe.slice(i, i + 12).join(" ")}`);
  }
  return lines.join("\n");
}

function serializeKeymapBlock(layers: RepoKeymapLayer[]): string {
  const layerBlocks = layers.map((layer) => {
    const safeId = layer.id.replace(/[^A-Za-z0-9_]/g, "_") || "layer";
    if (layer.reserved) {
      return `        ${safeId} {\n            status = "reserved";\n        };`;
    }
    const displayName = (layer.displayName || safeId.toUpperCase()).replace(/"/g, "");
    const grid = formatBindingsGrid(layer.bindings);
    return (
      `        ${safeId} {\n` +
      `            display-name = "${displayName}";\n` +
      `            bindings = <\n${grid}\n            >;\n` +
      `        };`
    );
  });

  return (
    `keymap {\n` +
    `        compatible = "zmk,keymap";\n\n` +
    `${layerBlocks.join("\n\n")}\n` +
    `    };`
  );
}

function serializeConditionalLayersBlock(rules: ConditionalLayerRule[]): string {
  if (rules.length === 0) return "";
  const items = rules.map((r) => {
    const safeName = r.name.replace(/[^A-Za-z0-9_]/g, "_") || "cond_layer";
    return (
      `        ${safeName} {\n` +
      `            if-layers = <${r.ifLayers.join(" ")}>;\n` +
      `            then-layer = <${Math.round(r.thenLayer)}>;\n` +
      `        };`
    );
  });
  return (
    `conditional_layers {\n` +
    `        compatible = "zmk,conditional-layers";\n` +
    `${items.join("\n\n")}\n` +
    `    };`
  );
}

function serializeCombosBlock(combos: ComboDef[]): string {
  if (combos.length === 0) return "";
  const items = combos.map((c) => {
    const safeName = c.name.replace(/[^A-Za-z0-9_]/g, "_") || "combo";
    const layersLine =
      c.layers && c.layers.length > 0
        ? `\n            layers = <${c.layers.join(" ")}>;`
        : "";
    return (
      `        ${safeName} {\n` +
      `            timeout-ms = <${Math.round(c.timeoutMs)}>;\n` +
      `            key-positions = <${c.keyPositions.join(" ")}>;` +
      `${layersLine}\n` +
      `            bindings = <${c.bindings.trim()}>;\n` +
      `        };`
    );
  });
  return (
    `combos {\n` +
    `        compatible = "zmk,combos";\n` +
    `${items.join("\n\n")}\n` +
    `    };`
  );
}

export function updateRepoKeymapSource(
  keymapContent: string,
  payload: RepoKeymapSavePayload
): string {
  let out = keymapContent;

  // 1. Replace keymap { ... };
  const kmRange = findBlockRange(out, /\bkeymap\s*\{/);
  if (kmRange) {
    out =
      out.slice(0, kmRange.start) +
      serializeKeymapBlock(payload.layers) +
      out.slice(kmRange.end);
  }

  // 2. Replace or insert conditional_layers { ... };
  if (payload.conditionalLayers !== undefined) {
    const clRange = findBlockRange(out, /\bconditional_layers\s*\{/);
    const serialized = serializeConditionalLayersBlock(payload.conditionalLayers);
    if (clRange) {
      if (serialized) {
        out = out.slice(0, clRange.start) + serialized + out.slice(clRange.end);
      } else {
        out = out.slice(0, clRange.start).replace(/[ \t]*$/, "") + out.slice(clRange.end).replace(/^\n+/, "\n");
      }
    } else if (serialized) {
      const rootRange = findBlockRange(out, /\/\s*\{/);
      if (rootRange) {
        out =
          out.slice(0, rootRange.bodyStart) +
          `\n    ${serialized}\n` +
          out.slice(rootRange.bodyStart);
      }
    }
  }

  // 3. Replace or insert combos { ... };
  if (payload.combos !== undefined) {
    const comboRange = findBlockRange(out, /\bcombos\s*\{/);
    const serialized = serializeCombosBlock(payload.combos);
    if (comboRange) {
      if (serialized) {
        out = out.slice(0, comboRange.start) + serialized + out.slice(comboRange.end);
      } else {
        out =
          out.slice(0, comboRange.start).replace(/[ \t]*$/, "") +
          out.slice(comboRange.end).replace(/^\n+/, "\n");
      }
    } else if (serialized) {
      const rootRange = findBlockRange(out, /\/\s*\{/);
      if (rootRange) {
        out =
          out.slice(0, rootRange.bodyStart) +
          `\n    ${serialized}\n` +
          out.slice(rootRange.bodyStart);
      }
    }
  }

  return out;
}

function formatBehaviorNode(def: CustomBehaviorDef): string {
  const safeLabel = def.label.replace(/[^A-Za-z0-9_]/g, "_") || "custom_behavior";
  const safeNode = (def.nodeName || safeLabel).replace(/[^A-Za-z0-9_@-]/g, "_");
  const lines: string[] = [
    `        ${safeLabel}: ${safeNode} {`,
    `            compatible = "${def.compatible}";`,
    `            #binding-cells = <${Math.round(def.bindingCells)}>;`,
  ];
  for (const [k, v] of Object.entries(def.properties)) {
    const trimmed = v.trim();
    if (!trimmed) continue;
    if (trimmed === "true") {
      lines.push(`            ${k};`);
    } else if (trimmed.startsWith("<") || trimmed.startsWith('"')) {
      lines.push(`            ${k} = ${trimmed};`);
    } else if (/^\d+$/.test(trimmed)) {
      lines.push(`            ${k} = <${trimmed}>;`);
    } else {
      lines.push(`            ${k} = "${trimmed}";`);
    }
  }
  lines.push(`            display-name = "${def.displayName.replace(/"/g, "")}";`);
  lines.push(`        };`);
  return lines.join("\n");
}

export function upsertCustomBehaviorNode(
  dtsContent: string,
  def: CustomBehaviorDef
): string {
  const safeLabel = def.label.replace(/[^A-Za-z0-9_]/g, "_");
  const existingRe = new RegExp(`(^|\\n)[ \\t]*${safeLabel}\\s*:\\s*[A-Za-z0-9_@-]+\\s*\\{`);
  const existing = findBlockRange(dtsContent, existingRe);
  const formatted = formatBehaviorNode(def);

  if (existing) {
    const prefix = dtsContent[existing.start] === "\n" ? "\n" : "";
    return (
      dtsContent.slice(0, existing.start) +
      prefix +
      formatted +
      dtsContent.slice(existing.end)
    );
  }

  const behRange = findBlockRange(dtsContent, /\bbehaviors\s*\{/);
  if (behRange) {
    const beforeClose = dtsContent.slice(0, behRange.bodyEnd).replace(/[ \t]*$/, "");
    const sep = beforeClose.endsWith("\n") ? "\n" : "\n\n";
    return `${beforeClose}${sep}${formatted}\n    ${dtsContent.slice(behRange.bodyEnd)}`;
  }

  return `${dtsContent.trimEnd()}\n\n/ {\n    behaviors {\n${formatted}\n    };\n};\n`;
}

export function deleteCustomBehaviorNode(
  dtsContent: string,
  label: string
): string {
  const safeLabel = label.replace(/[^A-Za-z0-9_]/g, "_");
  const existingRe = new RegExp(`(^|\\n)[ \\t]*${safeLabel}\\s*:\\s*[A-Za-z0-9_@-]+\\s*\\{`);
  const existing = findBlockRange(dtsContent, existingRe);
  if (!existing) return dtsContent;
  return (
    dtsContent.slice(0, existing.start) +
    dtsContent.slice(existing.end).replace(/^\n{2,}/, "\n")
  );
}
