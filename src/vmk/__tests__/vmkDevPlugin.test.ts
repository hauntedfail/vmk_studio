import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  assertInside,
  checkLocalApiRequest,
  vmkDevPlugin,
  scanUf2CentralMarkers,
  inspectBootloaderAt,
  inspectArtifact,
  saveSnapshot,
  listSnapshots,
  readFirmwareModel,
  applyFirmwarePatch,
} from "../../../scripts/vmk-dev-plugin";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function buildSyntheticUf2(payloads: Buffer[]): Buffer {
  const blocks = payloads.map((payload, idx) => {
    if (payload.length > 476) {
      throw new Error("UF2 test payload exceeds 476 bytes");
    }
    const block = Buffer.alloc(512, 0);
    block.writeUInt32LE(0x0a324655, 0); // magicStart0 ("UF2\n")
    block.writeUInt32LE(0x9e5d5157, 4); // magicStart1
    block.writeUInt32LE(0x00002000, 8); // flags
    block.writeUInt32LE(0x00027000 + idx * 256, 12); // targetAddr
    block.writeUInt32LE(payload.length, 16); // payloadSize
    block.writeUInt32LE(idx, 20); // blockNo
    block.writeUInt32LE(payloads.length, 24); // numBlocks
    block.writeUInt32LE(0xada52840, 28); // nRF52840 familyID
    payload.copy(block, 32);
    block.writeUInt32LE(0x0ab16f30, 508); // magicEnd
    return block;
  });
  return Buffer.concat(blocks);
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("vmkDevPlugin safety and workspace helpers", () => {
  it("confines relative paths inside workspace root and blocks .git access", () => {
    const root = "/tmp/vmk-test-root";
    expect(assertInside(root, "config/toucan.keymap")).toBe(
      path.resolve(root, "config/toucan.keymap")
    );
    expect(() => assertInside(root, "../outside")).toThrow(/escapes workspace root/i);
    expect(() => assertInside(root, "config/../../outside")).toThrow(/escapes workspace root/i);
    expect(() => assertInside(root, "/etc/passwd")).toThrow(/escapes workspace root/i);
    expect(() => assertInside(root, ".git/config")).toThrow(/\.git internals/i);
    expect(() => assertInside(root, ".git")).toThrow(/\.git internals/i);
  });

  it("detects left-half central markers in UF2 payloads even across block boundaries", () => {
    // Split "Studio Unlock" across two 256-byte UF2 blocks
    const block0 = Buffer.alloc(256, 0xaa);
    Buffer.from("Studio ").copy(block0, 256 - 7);
    const block1 = Buffer.alloc(256, 0xbb);
    Buffer.from("Unlock\0extra").copy(block1, 0);

    const centralUf2 = buildSyntheticUf2([block0, block1]);
    const centralRes = scanUf2CentralMarkers(centralUf2);
    expect(centralRes.detectedHalf).toBe("left");
    expect(centralRes.detectedMarkers).toContain("Studio Unlock");

    // Peripheral UF2 with no central markers
    const periphUf2 = buildSyntheticUf2([
      Buffer.from("toucan_right_peripheral_split_relay"),
    ]);
    const periphRes = scanUf2CentralMarkers(periphUf2);
    expect(periphRes.detectedHalf).toBe("right_or_other");
    expect(periphRes.detectedMarkers).toEqual([]);
  });

  it("inspects a mock XIAO-BOOT bootloader volume accurately", async () => {
    const vol = await makeTempDir("vmk-boot-");
    await fs.writeFile(
      path.join(vol, "INFO_UF2.TXT"),
      "UF2 Bootloader 0.6.1\nModel: Seeed XIAO nRF52840\nBoard-ID: nRF52840-SeeedXiao\n",
      "utf8"
    );
    const uf2 = buildSyntheticUf2([Buffer.from("prefix studio_rpc_thread suffix")]);
    await fs.writeFile(path.join(vol, "CURRENT.UF2"), uf2);

    const status = await inspectBootloaderAt(vol);
    expect(status.mounted).toBe(true);
    expect(status.isXiaoNrf52840).toBe(true);
    expect(status.boardId).toBe("nRF52840-SeeedXiao");
    expect(status.detectedHalf).toBe("left");
    expect(status.detectedMarkers).toContain("studio_rpc_thread");

    const unmounted = await inspectBootloaderAt(path.join(vol, "missing-volume"));
    expect(unmounted.mounted).toBe(false);
    expect(unmounted.detectedHalf).toBe("unknown");
  });

  it("verifies UF2 artifact SHA-256 match and mismatch states", async () => {
    const repo = await makeTempDir("vmk-art-");
    const distDir = path.join(repo, "dist");
    await fs.mkdir(distDir, { recursive: true });

    const payload = Buffer.from("synthetic-uf2-bytes");
    const sha = crypto.createHash("sha256").update(payload).digest("hex");
    await fs.writeFile(path.join(distDir, "toucan_right.uf2"), payload);
    await fs.writeFile(
      path.join(distDir, "toucan_right.uf2.sha256"),
      `${sha}  toucan_right.uf2\n`,
      "utf8"
    );

    const okArt = await inspectArtifact(repo, "toucan_right", "right");
    expect(okArt.exists).toBe(true);
    expect(okArt.sha256).toBe(sha);
    expect(okArt.checksumMatches).toBe(true);

    // Corrupt expected checksum
    await fs.writeFile(
      path.join(distDir, "toucan_right.uf2.sha256"),
      `${"0".repeat(64)}  toucan_right.uf2\n`,
      "utf8"
    );
    const badArt = await inspectArtifact(repo, "toucan_right", "right");
    expect(badArt.checksumMatches).toBe(false);

    const missing = await inspectArtifact(repo, "toucan_left_zg_studio", "left");
    expect(missing.exists).toBe(false);
  });

  it("saves and lists Studio snapshots while ignoring non-snapshot JSON files", async () => {
    const backups = await makeTempDir("vmk-snaps-");
    await fs.writeFile(
      path.join(backups, "flash-record.json"),
      JSON.stringify({ status: "timeout_no_bootloader" }),
      "utf8"
    );

    const saved = await saveSnapshot(backups, "before test!", {
      device: "Toucan 2",
      behavior_ids: [8, 27],
      keymap_sha256: "deadbeef",
      note: "baseline",
      layers: [{ id: 0, name: "BASE", bindings: [] }],
    });

    expect(saved.name).toContain("before_test_");
    expect(saved.layerCount).toBe(1);

    const listed = await listSnapshots(backups);
    expect(listed).toHaveLength(1);
    expect(listed[0].device).toBe("Toucan 2");
    expect(listed[0].note).toBe("baseline");
  });

  it("reads and patches a fixture firmware repository end-to-end", async () => {
    const repo = await makeTempDir("vmk-repo-");
    await fs.mkdir(path.join(repo, "config"), { recursive: true });
    await fs.mkdir(path.join(repo, "dts"), { recursive: true });
    await fs.mkdir(path.join(repo, "boards/shields/toucan"), { recursive: true });

    await fs.writeFile(
      path.join(repo, "config/toucan.keymap"),
      `/ {\n  keymap {\n    compatible = "zmk,keymap";\n    base {\n      display-name = "BASE";\n      bindings = <&kp Q &cg_toggle>;\n    };\n  };\n};\n\n&mt {\n  quick-tap-ms = <200>;\n};\n`,
      "utf8"
    );
    await fs.writeFile(
      path.join(repo, "dts/cg_toggle.dtsi"),
      `/ {\n  behaviors {\n    cg_toggle: cg_toggle {\n      compatible = "zmk,behavior-cg-toggle";\n      #binding-cells = <0>;\n      display-name = "Toggle Ctrl GUI";\n    };\n  };\n};\n`,
      "utf8"
    );
    await fs.writeFile(
      path.join(repo, "boards/shields/toucan/toucan_left.overlay"),
      `&trackpad_listener {\n  status = "okay";\n};\n&zip_zoom_mapper {\n  status = "okay";\n};\n&two_finger_double_tap {\n  status = "okay";\n};\n`,
      "utf8"
    );

    const initial = await readFirmwareModel(repo);
    expect(initial.customBehaviors).toHaveLength(1);
    expect(initial.holdTap.mtQuickTapMs).toBe(200);
    expect(initial.leftOverlayGates.twoFingerDoubleTapEnabled).toBe(true);

    const patched = await applyFirmwarePatch(repo, {
      holdTap: { ...initial.holdTap, mtQuickTapMs: 165 },
      leftOverlayGates: {
        ...initial.leftOverlayGates,
        twoFingerDoubleTapEnabled: false,
      },
    });
    expect(patched.changedFiles).toEqual([
      "config/toucan.keymap",
      "boards/shields/toucan/toucan_left.overlay",
    ]);
    expect(patched.model.holdTap.mtQuickTapMs).toBe(165);
    expect(patched.model.leftOverlayGates.twoFingerDoubleTapEnabled).toBe(false);
  });
});

describe("local API request guard", () => {
  const sameOrigin = {
    host: "localhost:5173",
    origin: "http://localhost:5173",
    "sec-fetch-site": "same-origin",
    "content-type": "application/json",
  };

  it("accepts the app's own requests and a local client without an Origin", () => {
    expect(checkLocalApiRequest(sameOrigin)).toEqual({ ok: true });
    expect(
      checkLocalApiRequest({ host: "127.0.0.1:5173", "content-type": "application/json; charset=utf-8" })
    ).toEqual({ ok: true });
    expect(checkLocalApiRequest({ host: "[::1]:5173", "content-type": "application/json" })).toEqual({ ok: true });
  });

  it("rejects another site's page, whatever content type it sends", () => {
    for (const contentType of ["text/plain", "application/json"]) {
      expect(
        checkLocalApiRequest({ ...sameOrigin, origin: "https://evil.example", "content-type": contentType })
      ).toMatchObject({ ok: false, status: 403 });
    }
    expect(checkLocalApiRequest({ ...sameOrigin, origin: "null" })).toMatchObject({ ok: false, status: 403 });
    expect(checkLocalApiRequest({ ...sameOrigin, origin: "http://localhost:9999" })).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(checkLocalApiRequest({ ...sameOrigin, origin: undefined, "sec-fetch-site": "cross-site" })).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("rejects a host name that only resolves to this machine", () => {
    for (const host of ["evil.example:5173", "localhost.evil.example", "192.168.1.20:5173", ""]) {
      expect(checkLocalApiRequest({ host, "content-type": "application/json" })).toMatchObject({
        ok: false,
        status: 403,
      });
    }
    expect(checkLocalApiRequest({ "content-type": "application/json" })).toMatchObject({ ok: false, status: 403 });
  });

  it("rejects a body that a cross-origin form could send without a preflight", () => {
    for (const contentType of ["text/plain", "application/x-www-form-urlencoded", undefined]) {
      expect(checkLocalApiRequest({ host: "localhost:5173", "content-type": contentType })).toMatchObject({
        ok: false,
        status: 415,
      });
    }
  });
});

describe("local API over HTTP", () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
    server = undefined;
  });

  async function startApi(): Promise<number> {
    type Handler = (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void;
    let handler: Handler | undefined;
    const plugin = vmkDevPlugin();
    const configure = plugin.configureServer as (s: { middlewares: { use: (h: Handler) => void } }) => void;
    configure({ middlewares: { use: (h) => (handler = h) } });
    server = http.createServer((req, res) =>
      handler!(req, res, () => {
        res.statusCode = 404;
        res.end();
      })
    );
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    return (server.address() as AddressInfo).port;
  }

  function post(
    port: number,
    endpoint: string,
    headers: Record<string, string>,
    body: unknown
  ): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: `/api/vmk/${endpoint}`, method: "POST", headers },
        (res) => {
          let text = "";
          res.on("data", (c) => (text += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
        }
      );
      req.on("error", reject);
      req.end(JSON.stringify(body));
    });
  }

  it("writes for the app and refuses the same request from another origin or host", async () => {
    const repo = await makeTempDir("vmk-api-");
    const port = await startApi();
    const target = path.join(repo, "probe.txt");
    const write = { repoPath: repo, relPath: "probe.txt", content: "from the app" };
    const own = { Host: `localhost:${port}`, Origin: `http://localhost:${port}`, "Content-Type": "application/json" };

    const foreign = await post(
      port,
      "write-file",
      { Host: `localhost:${port}`, Origin: "https://evil.example", "Content-Type": "text/plain" },
      { ...write, content: "from another site" }
    );
    expect(foreign.status).toBe(403);
    await expect(fs.access(target)).rejects.toThrow();

    const rebound = await post(
      port,
      "write-file",
      { Host: `evil.example:${port}`, "Content-Type": "application/json" },
      { ...write, content: "from a rebound name" }
    );
    expect(rebound.status).toBe(403);
    await expect(fs.access(target)).rejects.toThrow();

    const ok = await post(port, "write-file", own, write);
    expect(ok.status).toBe(200);
    expect(await fs.readFile(target, "utf8")).toBe("from the app");

    const read = await post(
      port,
      "read-file",
      { Host: `evil.example:${port}`, "Content-Type": "application/json" },
      { repoPath: repo, relPath: "probe.txt" }
    );
    expect(read.status).toBe(403);
    expect(read.body).not.toContain("from the app");
  });
});
