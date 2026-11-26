// Runs the same repository change through both backends' entry points and
// requires the same result: the dev server's functions (Node file system) and
// the desktop branch of api.ts (Tauri commands, stood in for here by the Node
// counterparts of the three commands that branch uses).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));

import * as desktop from "../api";
import * as devServer from "../../../scripts/vmk-dev-plugin";

const FIXTURE: Record<string, string> = {
  "config/toucan.keymap":
    '/ {\n  keymap {\n    compatible = "zmk,keymap";\n    base {\n      display-name = "BASE";\n' +
    "      bindings = <&kp Q &cg_toggle>;\n    };\n  };\n};\n\n&mt {\n  quick-tap-ms = <200>;\n};\n",
  "dts/cg_toggle.dtsi":
    '/ {\n  behaviors {\n    cg_toggle: cg_toggle {\n      compatible = "zmk,behavior-cg-toggle";\n' +
    '      #binding-cells = <0>;\n      display-name = "Toggle Ctrl GUI";\n    };\n  };\n};\n',
  "boards/shields/toucan/toucan_left.overlay":
    '&trackpad_listener {\n  status = "okay";\n};\n&zip_zoom_mapper {\n  status = "okay";\n};\n' +
    '&two_finger_double_tap {\n  status = "okay";\n};\n',
  "config/toucan.json": '{"layouts":{"default":{"layout":[{"row":0,"col":0,"x":0,"y":0}]}}}',
  Kconfig: "config ZMK_CG_TOGGLE\n\tbool \"cg toggle\"\n",
};

const tempDirs: string[] = [];

async function makeRepo(): Promise<string> {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "vmk-backends-"));
  tempDirs.push(repo);
  for (const [rel, content] of Object.entries(FIXTURE)) {
    await fs.mkdir(path.dirname(path.join(repo, rel)), { recursive: true });
    await fs.writeFile(path.join(repo, rel), content, "utf8");
  }
  return repo;
}

async function readTree(repo: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const rel of Object.keys(FIXTURE)) out[rel] = await fs.readFile(path.join(repo, rel), "utf8");
  return out;
}

const withoutPath = <T extends { repoPath: string }>(model: T) => ({ ...model, repoPath: "" });

beforeEach(() => {
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  tauri.invoke.mockImplementation(async (command: string, args: Record<string, string>) => {
    switch (command) {
      case "vmk_read_firmware_bundle":
        return devServer.readFirmwareBundle(args.repoPath);
      case "vmk_read_repo_file":
        return fs.readFile(devServer.assertInside(args.repoPath, args.relPath), "utf8");
      case "vmk_write_repo_file":
        return fs.writeFile(devServer.assertInside(args.repoPath, args.relPath), args.content, "utf8");
      default:
        throw new Error(`unexpected Tauri command: ${command}`);
    }
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  tauri.invoke.mockReset();
  for (const dir of tempDirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

describe("dev server and desktop backends", () => {
  it("build the same firmware model from the same repository", async () => {
    const repo = await makeRepo();
    const fromDevServer = await devServer.readFirmwareModel(repo);
    const fromDesktop = await desktop.getFirmwareModel(repo);

    expect(fromDesktop).toEqual(fromDevServer);
    expect(fromDesktop.customBehaviors).toHaveLength(1);
    expect(fromDesktop.physicalLayout).toHaveLength(1);
    expect(fromDesktop.editableFiles.filter((f) => f.exists).map((f) => f.relPath)).toEqual([
      "config/toucan.keymap",
      "dts/cg_toggle.dtsi",
      "boards/shields/toucan/toucan_left.overlay",
      "Kconfig",
    ]);
  });

  it("write the same files for the same tuning patch", async () => {
    const [repoA, repoB] = [await makeRepo(), await makeRepo()];
    const initial = await devServer.readFirmwareModel(repoA);
    const patch = {
      holdTap: { ...initial.holdTap, mtQuickTapMs: 165 },
      leftOverlayGates: { ...initial.leftOverlayGates, twoFingerDoubleTapEnabled: false },
    };

    const viaDevServer = await devServer.applyFirmwarePatch(repoA, patch);
    const viaDesktop = await desktop.applyFirmwarePatch(repoB, patch);

    expect(viaDesktop.changedFiles).toEqual(["config/toucan.keymap", "boards/shields/toucan/toucan_left.overlay"]);
    expect(viaDesktop.changedFiles).toEqual(viaDevServer.changedFiles);
    expect(withoutPath(viaDesktop.model)).toEqual(withoutPath(viaDevServer.model));
    expect(viaDesktop.model.holdTap.mtQuickTapMs).toBe(165);

    const treeB = await readTree(repoB);
    expect(treeB).toEqual(await readTree(repoA));
    expect(treeB["config/toucan.keymap"]).not.toBe(FIXTURE["config/toucan.keymap"]);
    expect(treeB["dts/cg_toggle.dtsi"]).toBe(FIXTURE["dts/cg_toggle.dtsi"]);
  });

  it("skip the optional macOS helper when the repository has none", async () => {
    const repo = await makeRepo();
    const patch = {
      helperSmoother: { lowStep: 1, mediumStep: 2, highStep: 3, easing: 0.5, smallestFrame: 1, endDelay: 0.1 },
    };
    expect((await devServer.applyFirmwarePatch(repo, patch)).changedFiles).toEqual([]);
    expect((await desktop.applyFirmwarePatch(repo, patch)).changedFiles).toEqual([]);
  });

  it("add and remove a custom behavior through the desktop backend", async () => {
    const repo = await makeRepo();
    const [existing] = (await desktop.getFirmwareModel(repo)).customBehaviors;

    const added = await desktop.upsertCustomBehavior(repo, {
      ...existing,
      label: "cg_extra",
      nodeName: "cg_extra",
      sourceFile: "dts/cg_extra.dtsi",
    });
    expect(added.customBehaviors.map((b) => b.label).sort()).toEqual(["cg_extra", "cg_toggle"]);

    const removed = await desktop.deleteCustomBehavior(repo, "dts/cg_extra.dtsi", "cg_extra");
    expect(removed.customBehaviors.map((b) => b.label)).toEqual(["cg_toggle"]);
  });

  it("refuse a path outside the repository on both backends", async () => {
    const repo = await makeRepo();
    const escape = { ...(await desktop.getFirmwareModel(repo)).customBehaviors[0], sourceFile: "../escape.dtsi" };
    await expect(desktop.upsertCustomBehavior(repo, escape)).rejects.toThrow(/escapes workspace root/);
    await expect(fs.access(path.join(repo, "..", "escape.dtsi"))).rejects.toThrow();
  });
});
