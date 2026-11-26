import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EXIT_LAUNCH,
  EXIT_STATIC,
  EXIT_TOOL_ERROR,
  compareChecksums,
  launchCheck,
  main,
  matchAssetSet,
  parseSha256Sums,
  readDebControl,
  sha256File,
} from "../verify-release-assets.mjs";

const VERSION = "0.4.0";
const GOOD_NAMES = [
  "SHA256SUMS.txt",
  "VMK-Studio_0.4.0_universal-macos.app.tar.gz",
  "VMK.Studio_0.4.0_amd64.deb",
  "VMK.Studio_0.4.0_universal.dmg",
  "VMK.Studio_0.4.0_x64-setup.exe",
  "VMK.Studio_0.4.0_x64_en-US.msi",
];
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

describe("matchAssetSet", () => {
  it("accepts one asset per required kind", () => {
    const { assets, errors } = matchAssetSet(GOOD_NAMES, VERSION);
    expect(errors).toEqual([]);
    expect(assets.size).toBe(5);
    expect(assets.get("macos-dmg")).toBe("VMK.Studio_0.4.0_universal.dmg");
  });

  it("rejects a missing installer", () => {
    const names = GOOD_NAMES.filter((n) => !n.endsWith(".msi"));
    expect(matchAssetSet(names, VERSION).errors.join("\n")).toMatch(/windows-msi: .*found 0/);
  });

  it("rejects assets built for another version", () => {
    const names = GOOD_NAMES.map((n) => n.replace("0.4.0", "0.3.9"));
    expect(matchAssetSet(names, VERSION).errors.length).toBeGreaterThanOrEqual(5);
  });

  it("does not treat the dots of the version as wildcards", () => {
    const names = GOOD_NAMES.map((n) => n.replace("0.4.0", "0x4x0"));
    expect(matchAssetSet(names, VERSION).assets.size).toBe(0);
  });

  it("rejects names that GitHub would rewrite on upload", () => {
    const names = GOOD_NAMES.map((n) => n.replace("VMK.Studio", "VMK Studio"));
    const { assets, errors } = matchAssetSet(names, VERSION);
    expect(assets.size).toBe(5);
    expect(errors.filter((e) => e.startsWith("asset name is not upload-safe"))).toHaveLength(4);
  });

  it("rejects an unexpected extra file and a missing checksum manifest", () => {
    expect(matchAssetSet([...GOOD_NAMES, "notes.txt"], VERSION).errors).toContain("unexpected asset: notes.txt");
    const noSums = GOOD_NAMES.filter((n) => n !== "SHA256SUMS.txt");
    expect(matchAssetSet(noSums, VERSION).errors).toContain("missing SHA256SUMS.txt");
  });
});

describe("parseSha256Sums", () => {
  it("parses text and binary mode lines", () => {
    const sums = parseSha256Sums(`${HASH_A}  one.dmg\n${HASH_B} *two.deb\n`);
    expect(sums.get("one.dmg")).toBe(HASH_A);
    expect(sums.get("two.deb")).toBe(HASH_B);
  });

  it("rejects a malformed line", () => {
    expect(() => parseSha256Sums("not-a-hash  one.dmg\n")).toThrow(/Malformed/);
  });

  it("rejects a carriage return, which sha256sum -c reads as part of the name", () => {
    expect(() => parseSha256Sums(`${HASH_A}  one.exe\r\n`)).toThrow(/Malformed/);
  });

  it("rejects a duplicate entry", () => {
    expect(() => parseSha256Sums(`${HASH_A}  one.dmg\n${HASH_B}  one.dmg\n`)).toThrow(/Duplicate/);
  });
});

describe("compareChecksums", () => {
  it("passes when every file matches", () => {
    expect(compareChecksums(new Map([["a", HASH_A]]), new Map([["a", HASH_A]]))).toEqual([]);
  });

  it("reports a mismatch, an unlisted file, and a listed file that is absent", () => {
    const errors = compareChecksums(
      new Map([["a", HASH_A], ["gone", HASH_A]]),
      new Map([["a", HASH_B], ["extra", HASH_A]])
    );
    expect(errors).toHaveLength(3);
    expect(errors.join("\n")).toMatch(/a: sha256 .* does not match/);
    expect(errors.join("\n")).toMatch(/extra: not listed/);
    expect(errors.join("\n")).toMatch(/gone: listed .* but not present/);
  });
});

describe("readDebControl", () => {
  function tarEntry(name, body) {
    const header = Buffer.alloc(512);
    header.write(name, 0, "latin1");
    header.write(body.length.toString(8).padStart(11, "0"), 124, "latin1");
    header.write("0", 156, "latin1");
    header.write("ustar", 257, "latin1");
    const data = Buffer.alloc(Math.ceil(body.length / 512) * 512);
    Buffer.from(body).copy(data);
    return Buffer.concat([header, data]);
  }

  function arArchive(members) {
    const parts = [Buffer.from("!<arch>\n", "latin1")];
    for (const [name, data] of members) {
      const header = `${name.padEnd(16)}${"0".padEnd(12)}${"0".padEnd(6)}${"0".padEnd(6)}${"100644".padEnd(8)}` +
        `${String(data.length).padEnd(10)}\`\n`;
      parts.push(Buffer.from(header, "latin1"), data);
      if (data.length % 2) parts.push(Buffer.from("\n"));
    }
    return Buffer.concat(parts);
  }

  const controlText = "Package: vmk-studio\nVersion: 0.4.0\nArchitecture: amd64\n";
  const controlTar = Buffer.concat([
    tarEntry("./md5sums", "0 file\n"),
    tarEntry("./control", controlText),
    Buffer.alloc(1024),
  ]);

  it("reads the control file of a package", () => {
    const deb = arArchive([
      ["debian-binary", Buffer.from("2.0\n")],
      ["control.tar.gz", zlib.gzipSync(controlTar)],
      ["data.tar.gz", zlib.gzipSync(Buffer.alloc(1024))],
    ]);
    expect(readDebControl(deb)).toBe(controlText);
  });

  it("rejects a file that is not an ar archive", () => {
    expect(() => readDebControl(Buffer.from("payload of something else"))).toThrow(/not an ar archive/);
  });

  it("rejects a truncated archive", () => {
    const deb = arArchive([["control.tar.gz", zlib.gzipSync(controlTar)]]);
    expect(() => readDebControl(deb.subarray(0, deb.length - 20))).toThrow(/corrupt ar member header/);
  });

  it("rejects a package without a control file", () => {
    const noControl = Buffer.concat([tarEntry("./md5sums", "0 file\n"), Buffer.alloc(1024)]);
    const deb = arArchive([["control.tar.gz", zlib.gzipSync(noControl)]]);
    expect(() => readDebControl(deb)).toThrow(/no control file/);
  });
});

describe("main exit codes", () => {
  const dirs = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  function fixture(mutate) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vmk-verify-test-"));
    dirs.push(dir);
    const payload = GOOD_NAMES.filter((n) => n !== "SHA256SUMS.txt");
    for (const n of payload) fs.writeFileSync(path.join(dir, n), `payload of ${n}`);
    const sums = payload.map((n) => `${sha256File(path.join(dir, n))}  ${n}`).join("\n");
    fs.writeFileSync(path.join(dir, "SHA256SUMS.txt"), `${sums}\n`);
    mutate?.(dir);
    return dir;
  }

  function silence() {
    const lines = [];
    vi.spyOn(console, "log").mockImplementation((l) => lines.push(String(l)));
    vi.spyOn(console, "error").mockImplementation((l) => lines.push(String(l)));
    return lines;
  }

  it("exits 1 when a file was altered after the checksums were written", async () => {
    const lines = silence();
    const dir = fixture((d) => fs.appendFileSync(path.join(d, "VMK.Studio_0.4.0_universal.dmg"), "tampered"));
    expect(await main(["v0.4.0", "--dir", dir])).toBe(EXIT_STATIC);
    expect(lines.join("\n")).toMatch(/\[FAIL\] assets\.sha256: VMK\.Studio_0\.4\.0_universal\.dmg/);
  });

  it("exits 1 when the manifest names files that are not there", async () => {
    const lines = silence();
    const dir = fixture((d) => {
      const sums = path.join(d, "SHA256SUMS.txt");
      fs.writeFileSync(sums, fs.readFileSync(sums, "utf8").replaceAll("VMK.Studio", "VMK Studio"));
    });
    expect(await main(["v0.4.0", "--dir", dir])).toBe(EXIT_STATIC);
    expect(lines.join("\n")).toMatch(/\[FAIL\] assets\.sha256: .*not listed in SHA256SUMS\.txt/);
  });

  it("exits 1 when the manifest has CRLF line endings", async () => {
    const lines = silence();
    const dir = fixture((d) => {
      const sums = path.join(d, "SHA256SUMS.txt");
      fs.writeFileSync(sums, fs.readFileSync(sums, "utf8").replaceAll("\n", "\r\n"));
    });
    expect(await main(["v0.4.0", "--dir", dir])).toBe(EXIT_STATIC);
    expect(lines.join("\n")).toMatch(/\[FAIL\] assets\.sha256: Malformed/);
  });

  it("exits 1 when an installer is missing", async () => {
    const lines = silence();
    const dir = fixture((d) => fs.rmSync(path.join(d, "VMK.Studio_0.4.0_amd64.deb")));
    expect(await main(["v0.4.0", "--dir", dir])).toBe(EXIT_STATIC);
    expect(lines.join("\n")).toMatch(/\[FAIL\] assets\.set: linux-deb/);
  });

  it("exits 1 when the installers are not what their extension claims", async () => {
    const lines = silence();
    // The fixture payloads are plain text, so the container checks must reject them.
    expect(await main(["v0.4.0", "--dir", fixture()])).toBe(EXIT_STATIC);
    expect(lines.join("\n")).toMatch(/\[FAIL\] windows\.nsis\.magic/);
    expect(lines.join("\n")).toMatch(/\[FAIL\] windows\.msi\.magic/);
    expect(lines.join("\n")).toMatch(/\[FAIL\] linux\.deb\.control/);
  });

  it("exits 5 on a malformed tag or an unknown flag", async () => {
    silence();
    expect(await main(["0.4.0"])).toBe(EXIT_TOOL_ERROR);
    expect(await main(["v0.4.0", "--nope"])).toBe(EXIT_TOOL_ERROR);
  });
});

// The launch guard needs a window server and the Swift compiler, so it is exercised on macOS only.
describe.skipIf(process.platform !== "darwin")("launchCheck", () => {
  const dirs = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  function fakeApp(script) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "vmk-launch-test-"));
    dirs.push(work);
    const macos = path.join(work, "src", "Fake.app", "Contents", "MacOS");
    fs.mkdirSync(macos, { recursive: true });
    fs.writeFileSync(
      path.join(macos, "..", "Info.plist"),
      '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>' +
        "<key>CFBundleExecutable</key><string>fake</string></dict></plist>\n"
    );
    fs.writeFileSync(path.join(macos, "fake"), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
    return { work, app: path.join(work, "src", "Fake.app") };
  }

  async function runLaunch(script, timeoutMs) {
    const { work, app } = fakeApp(script);
    const results = [];
    await launchCheck(app, work, (id, ok, detail, code) => results.push({ id, ok, detail, code }), {
      timeoutMs,
      settleMs: 200,
    });
    return Object.fromEntries(results.map((r) => [r.id, r]));
  }

  it("fails when the program exits at once", async () => {
    // The wait ends as soon as the program exits. The generous limit only covers
    // the delay macOS can add to the first run of a new executable.
    const r = await runLaunch("echo boom >&2; exit 3", 30000);
    expect(r["launch.window"]).toMatchObject({ ok: false, code: EXIT_LAUNCH });
    expect(r["launch.alive"]).toMatchObject({ ok: false, code: EXIT_LAUNCH });
    expect(r["launch.alive"].detail).toMatch(/code=3.*boom/);
  }, 120000);

  it("fails when the program keeps running but never shows a window", async () => {
    const r = await runLaunch("exec sleep 60", 3000);
    expect(r["launch.window"]).toMatchObject({ ok: false, code: EXIT_LAUNCH });
    expect(r["launch.alive"]).toMatchObject({ ok: true });
  }, 120000);
});
