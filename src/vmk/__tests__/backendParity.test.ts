// Keeps the Node backend (scripts/vmk-dev-plugin.ts) and the Rust backend
// (src-tauri/src/vmk.rs) in step. The shared cases in testdata/backend-parity.json
// are run here against the Node side and in `cargo test` against the Rust side;
// the source checks below catch a command, endpoint or table added to one side only.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  LEFT_MARKERS,
  assertInside,
  isValidTestScriptName,
  scanUf2CentralMarkers,
} from "../../../scripts/vmk-dev-plugin";
import { BUNDLE_FILES, EDITABLE_FILE_DEFS } from "../firmwareOps";

const rootDir = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(rootDir, rel), "utf8");

interface Uf2Block {
  magic: boolean;
  declaredSize: number;
  fill: number;
  text: Array<{ at: number; value: string }>;
}

const vectors = JSON.parse(read("testdata/backend-parity.json")) as {
  pathConfinement: { cases: Array<{ rel: string; allowed: boolean; resolved?: string }> };
  testScriptNames: { cases: Array<{ name: string; valid: boolean }> };
  uf2Markers: {
    cases: Array<{ name: string; blocks: Uf2Block[]; trailing?: string; half: string; markers: string[] }>;
  };
};

function buildUf2(blocks: Uf2Block[], trailing = ""): Buffer {
  const parts = blocks.map((spec) => {
    const block = Buffer.alloc(512, 0);
    if (spec.magic) {
      block.writeUInt32LE(0x0a324655, 0);
      block.writeUInt32LE(0x9e5d5157, 4);
    }
    block.writeUInt32LE(spec.declaredSize, 16);
    block.fill(spec.fill, 32, 32 + 476);
    for (const t of spec.text) block.write(t.value, 32 + t.at, "latin1");
    return block;
  });
  return Buffer.concat([...parts, Buffer.from(trailing, "latin1")]);
}

describe("shared backend cases (Node side)", () => {
  const root = path.resolve("/tmp/vmk-parity-root");

  it("has cases to run", () => {
    expect(vectors.pathConfinement.cases.length).toBeGreaterThan(10);
    expect(vectors.testScriptNames.cases.length).toBeGreaterThan(5);
    expect(vectors.uf2Markers.cases.length).toBeGreaterThan(5);
  });

  it.each(vectors.pathConfinement.cases)("path confinement: $rel", ({ rel, allowed, resolved }) => {
    if (allowed) {
      const full = assertInside(root, rel);
      expect(path.relative(root, full).split(path.sep).join("/")).toBe(resolved);
    } else {
      expect(() => assertInside(root, rel)).toThrow();
    }
  });

  it.each(vectors.testScriptNames.cases)("test script name: $name", ({ name, valid }) => {
    expect(isValidTestScriptName(name)).toBe(valid);
  });

  it.each(vectors.uf2Markers.cases)("UF2 markers: $name", ({ blocks, trailing, half, markers }) => {
    expect(scanUf2CentralMarkers(buildUf2(blocks, trailing))).toEqual({
      detectedHalf: half,
      detectedMarkers: markers,
    });
  });
});

describe("backend surfaces match", () => {
  const rust = read("src-tauri/src/vmk.rs");
  const rustMain = read("src-tauri/src/main.rs");
  const api = read("src/vmk/api.ts");
  const plugin = read("scripts/vmk-dev-plugin.ts");

  const sorted = (items: Iterable<string>) => [...new Set(items)].sort();
  const all = (text: string, re: RegExp) => [...text.matchAll(re)].map((m) => m[1]);
  const camel = (snake: string) => snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

  function rustStringArray(name: string): string[] {
    const body = rust.match(new RegExp(`const ${name}: \\[&str; \\d+\\] = \\[([^\\]]*)\\];`))?.[1];
    if (body === undefined) throw new Error(`const ${name} not found in vmk.rs`);
    return all(body, /"([^"]*)"/g);
  }

  it("uses the same central-half marker strings", () => {
    expect(rustStringArray("LEFT_MARKERS")).toEqual([...LEFT_MARKERS]);
  });

  it("offers the same editable files", () => {
    expect(rustStringArray("EDITABLE_FILES")).toEqual(EDITABLE_FILE_DEFS.map((f) => f.relPath));
  });

  it("reads the same file into each firmware bundle field", () => {
    const rustFields = Object.fromEntries(
      [...rust.matchAll(/^\s+(\w+): read_opt\("([^"]+)"\),$/gm)].map((m) => [camel(m[1]), m[2]])
    );
    expect(rustFields).toEqual(BUNDLE_FILES);
  });

  it("registers every Tauri command the app calls, and calls every command that exists", () => {
    const called = sorted(all(api, /invoke(?:<[^(]*>)?\(\s*"(vmk_\w+)"/g));
    const defined = sorted(all(rust, /#\[command\]\s*pub async fn (vmk_\w+)/g));
    const registered = sorted(
      all(rustMain.match(/generate_handler!\[([^\]]*)\]/)?.[1] ?? "", /\b(vmk_\w+)\b/g)
    );
    expect(called.length).toBeGreaterThan(5);
    expect(defined).toEqual(called);
    expect(registered).toEqual(called);
  });

  it("serves every local API endpoint the app calls, and calls every endpoint that is served", () => {
    const called = sorted(all(api, /postApi(?:<[^(]*>)?\(\s*"([^"]+)"/g));
    const served = sorted(all(plugin, /endpoint === "([^"]+)"/g));
    expect(called.length).toBeGreaterThan(5);
    expect(served).toEqual(called);
  });

  it("pairs each local API call with a Tauri call in the same function", () => {
    const functions = api.split(/^export async function /m).slice(1);
    const backendFunctions = functions.filter((body) => /postApi|invoke/.test(body));
    expect(backendFunctions.length).toBeGreaterThan(10);
    for (const body of backendFunctions) {
      const name = body.slice(0, body.indexOf("("));
      expect(body, `${name} has no local API branch`).toMatch(/postApi/);
      expect(body, `${name} has no desktop branch`).toMatch(/isTauriRuntime\(\)/);
    }
  });
});
