// Mechanical verification of the assets attached to a (draft) GitHub Release.
//
// Usage:
//   node scripts/verify-release-assets.mjs <vX.Y.Z> [--dir <assets-dir>] [--ref <git-ref>] [--launch]
//
// Without --dir the assets are downloaded with `gh release download`.
// --ref names the commit the bundles were built from (default: the tag).
// --launch (macOS only) starts the bundled app and requires it to stay alive
// and to own an on-screen window.
//
// Exit codes:
//   0  PASS
//   1  STATIC VIOLATION    asset set, checksum, version, identity, signature, icon
//   2  LAUNCH VIOLATION    the app exited early or never showed a window
//   3  TRANSIENT           the assets could not be downloaded
//   5  TOOL / IO ERROR     bad usage, missing tool, unexpected failure

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { spawn, spawnSync } from "node:child_process";

export const EXIT_PASS = 0;
export const EXIT_STATIC = 1;
export const EXIT_LAUNCH = 2;
export const EXIT_TRANSIENT = 3;
export const EXIT_TOOL_ERROR = 5;

const __filename = url.fileURLToPath(import.meta.url);
const rootDir = path.resolve(__filename, "../..");

const SUMS_FILE = "SHA256SUMS.txt";
const MIN_WINDOW = { width: 400, height: 300 };
const LAUNCH_TIMEOUT_MS = 30000;
const LAUNCH_SETTLE_MS = 5000;

/** One required asset per kind. `kind` is stable; the pattern is matched against the file name. */
export function requiredAssets(version) {
  const v = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    { kind: "macos-dmg", pattern: new RegExp(`_${v}_universal\\.dmg$`) },
    { kind: "macos-app-tarball", pattern: new RegExp(`_${v}_universal-macos\\.app\\.tar\\.gz$`) },
    { kind: "linux-deb", pattern: new RegExp(`_${v}_amd64\\.deb$`) },
    { kind: "windows-nsis", pattern: new RegExp(`_${v}_x64-setup\\.exe$`) },
    { kind: "windows-msi", pattern: new RegExp(`_${v}_x64_[A-Za-z-]+\\.msi$`) },
  ];
}

/**
 * Parses `sha256sum` output. Throws on a malformed line or a duplicate name.
 * A carriage return is malformed: `sha256sum -c` reads it as part of the file name.
 */
export function parseSha256Sums(text) {
  const sums = new Map();
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const m = line.match(/^([0-9a-f]{64}) [ *](.+)$/);
    if (!m) throw new Error(`Malformed ${SUMS_FILE} line: ${JSON.stringify(line)}`);
    if (sums.has(m[2])) throw new Error(`Duplicate ${SUMS_FILE} entry: ${m[2]}`);
    sums.set(m[2], m[1]);
  }
  return sums;
}

/**
 * Maps each required kind to exactly one file name.
 * Returns { assets: Map<kind, name>, errors: string[] }.
 */
export function matchAssetSet(names, version) {
  const assets = new Map();
  const errors = [];
  const claimed = new Set();
  for (const { kind, pattern } of requiredAssets(version)) {
    const hits = names.filter((n) => pattern.test(n));
    if (hits.length === 1) {
      assets.set(kind, hits[0]);
      claimed.add(hits[0]);
    } else {
      errors.push(`${kind}: expected exactly 1 asset matching ${pattern}, found ${hits.length}`);
    }
  }
  for (const n of names) {
    if (n !== SUMS_FILE && !claimed.has(n)) errors.push(`unexpected asset: ${n}`);
  }
  if (!names.includes(SUMS_FILE)) errors.push(`missing ${SUMS_FILE}`);
  // GitHub rewrites other characters when an asset is uploaded, which would
  // leave the checksum manifest pointing at names that do not exist.
  for (const n of names) {
    if (!/^[A-Za-z0-9._-]+$/.test(n)) errors.push(`asset name is not upload-safe: ${JSON.stringify(n)}`);
  }
  return { assets, errors };
}

/**
 * Compares the checksum manifest against the hashes of the files on disk.
 * Every file must be listed, every listed file must exist, and the hashes must match.
 */
export function compareChecksums(expected, actual) {
  const errors = [];
  for (const [name, hash] of actual) {
    if (!expected.has(name)) errors.push(`${name}: not listed in ${SUMS_FILE}`);
    else if (expected.get(name) !== hash) {
      errors.push(`${name}: sha256 ${hash} does not match ${SUMS_FILE} (${expected.get(name)})`);
    }
  }
  for (const name of expected.keys()) {
    if (!actual.has(name)) errors.push(`${name}: listed in ${SUMS_FILE} but not present`);
  }
  return errors;
}

export function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

class ToolError extends Error {}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  if (res.error) throw new ToolError(`${cmd}: ${res.error.message}`);
  return res;
}

function runOk(cmd, args, opts = {}) {
  const res = run(cmd, args, opts);
  if (res.status !== 0) {
    throw new ToolError(`${cmd} ${args.join(" ")} exited ${res.status}: ${(res.stderr || "").trim()}`);
  }
  return res.stdout;
}

function startsWithBytes(file, bytes) {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(bytes.length);
    fs.readSync(fd, buf, 0, bytes.length, 0);
    return buf.equals(Buffer.from(bytes));
  } finally {
    fs.closeSync(fd);
  }
}

function findApp(dir) {
  const apps = fs.readdirSync(dir).filter((n) => n.endsWith(".app"));
  if (apps.length !== 1) throw new ToolError(`expected exactly 1 .app in ${dir}, found ${apps.length}`);
  return path.join(dir, apps[0]);
}

function plistValue(app, key) {
  return runOk("plutil", ["-extract", key, "raw", path.join(app, "Contents", "Info.plist")]).trim();
}

/** Static checks on a macOS .app bundle. Returns the path of the main executable. */
function checkAppBundle(app, label, expected, check) {
  check(`${label}.version`, plistValue(app, "CFBundleShortVersionString") === expected.version,
    `CFBundleShortVersionString=${plistValue(app, "CFBundleShortVersionString")}, expected ${expected.version}`);
  check(`${label}.identifier`, plistValue(app, "CFBundleIdentifier") === expected.identifier,
    `CFBundleIdentifier=${plistValue(app, "CFBundleIdentifier")}, expected ${expected.identifier}`);

  const exe = path.join(app, "Contents", "MacOS", plistValue(app, "CFBundleExecutable"));
  const archs = runOk("lipo", ["-archs", exe]).trim().split(/\s+/).sort().join(" ");
  check(`${label}.universal`, archs === "arm64 x86_64", `architectures: ${archs}`);

  const sign = run("codesign", ["--verify", "--deep", "--strict", app]);
  check(`${label}.codesign`, sign.status === 0,
    sign.status === 0 ? "codesign --verify --deep --strict" : (sign.stderr || "").trim());

  const iconName = plistValue(app, "CFBundleIconFile");
  const icon = path.join(app, "Contents", "Resources", iconName.endsWith(".icns") ? iconName : `${iconName}.icns`);
  const iconHash = fs.existsSync(icon) ? sha256File(icon) : "(missing)";
  check(`${label}.icon`, iconHash === expected.iconHash,
    `bundle icon ${iconHash.slice(0, 12)}, ${expected.ref.slice(0, 12)}:src-tauri/icons/icon.icns ${expected.iconHash.slice(0, 12)}`);
  return exe;
}

const WINDOW_PROBE = `
import CoreGraphics
import Foundation
let pid = Int32(CommandLine.arguments[1])!
let minW = Double(CommandLine.arguments[2])!
let minH = Double(CommandLine.arguments[3])!
let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] ?? []
for w in list {
  guard let owner = w[kCGWindowOwnerPID as String] as? NSNumber, owner.int32Value == pid,
        let b = w[kCGWindowBounds as String] as? [String: Any],
        let width = (b["Width"] as? NSNumber)?.doubleValue,
        let height = (b["Height"] as? NSNumber)?.doubleValue else { continue }
  if width >= minW && height >= minH {
    let id = (w[kCGWindowNumber as String] as? NSNumber)?.intValue ?? 0
    print("\\(id) \\(Int(width))x\\(Int(height))")
    exit(0)
  }
}
exit(1)
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function logTail(file) {
  const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
  return JSON.stringify(lines.slice(-5).join(" | "));
}

/** Starts the app, waits for a window, and requires the process to outlive a settle period. */
export async function launchCheck(appFromDmg, work, check, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? LAUNCH_TIMEOUT_MS;
  const settleMs = opts.settleMs ?? LAUNCH_SETTLE_MS;
  const probeDir = path.join(work, "probe");
  fs.mkdirSync(probeDir);
  const probeSrc = path.join(probeDir, "window-probe.swift");
  const probeBin = path.join(probeDir, "window-probe");
  fs.writeFileSync(probeSrc, WINDOW_PROBE);
  runOk("swiftc", ["-O", "-o", probeBin, probeSrc]);

  const runDir = path.join(work, "run");
  fs.mkdirSync(runDir);
  const app = path.join(runDir, path.basename(appFromDmg));
  runOk("cp", ["-R", appFromDmg, app]);
  const exe = path.join(app, "Contents", "MacOS", plistValue(app, "CFBundleExecutable"));

  const log = fs.openSync(path.join(work, "launch.log"), "w");
  const child = spawn(exe, [], { stdio: ["ignore", log, log] });
  let exited = null;
  child.on("exit", (code, signal) => {
    exited = { code, signal };
  });

  try {
    let windowInfo = null;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !exited && !windowInfo) {
      await sleep(500);
      const res = run(probeBin, [String(child.pid), String(MIN_WINDOW.width), String(MIN_WINDOW.height)]);
      if (res.status === 0) windowInfo = res.stdout.trim();
    }
    check("launch.window", windowInfo !== null,
      windowInfo !== null
        ? `window ${windowInfo} owned by pid ${child.pid}`
        : `no window of at least ${MIN_WINDOW.width}x${MIN_WINDOW.height} within ${timeoutMs} ms`,
      EXIT_LAUNCH);
    if (windowInfo !== null) await sleep(settleMs);
    check("launch.alive", exited === null,
      exited === null
        ? `pid ${child.pid} still running ${settleMs} ms after the wait for its window`
        : `process exited (code=${exited.code}, signal=${exited.signal}); log tail: ${logTail(path.join(work, "launch.log"))}`,
      EXIT_LAUNCH);
    return windowInfo;
  } finally {
    if (exited === null) child.kill("SIGTERM");
    fs.closeSync(log);
  }
}

function parseArgs(argv) {
  const out = { tag: null, dir: null, ref: null, launch: false };
  for (let i = 0; i < argv.length; i += 1) {
    if ((argv[i] === "--dir" || argv[i] === "--ref") && argv[i + 1]) {
      out[argv[i].slice(2)] = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--launch") out.launch = true;
    else if (!argv[i].startsWith("-") && out.tag === null) out.tag = argv[i];
    else throw new ToolError(`Unknown argument: ${argv[i]}`);
  }
  if (!out.tag || !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(out.tag)) {
    throw new ToolError(
      "Usage: node scripts/verify-release-assets.mjs <vX.Y.Z> [--dir <assets-dir>] [--ref <git-ref>] [--launch]"
    );
  }
  return out;
}

export async function main(argv) {
  const results = [];
  let exitCode = EXIT_PASS;
  const check = (id, ok, detail, failCode = EXIT_STATIC) => {
    results.push({ id, ok, detail });
    console.log(`  [${ok ? "PASS" : "FAIL"}] ${id}: ${detail}`);
    // Static violations outrank launch violations: the lowest non-zero code wins.
    if (!ok && (exitCode === EXIT_PASS || failCode < exitCode)) exitCode = failCode;
  };
  const finish = (code) => {
    const failed = results.filter((r) => !r.ok).length;
    console.log(
      `verify-release-assets: status=${code === EXIT_PASS ? "PASS" : "FAIL"} exit_code=${code} ` +
        `checks=${results.length} failed=${failed}`
    );
    return code;
  };

  let args;
  const cleanup = [];
  try {
    args = parseArgs(argv);
    const version = args.tag.slice(1);
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "vmk-release-verify-"));
    cleanup.push(() => fs.rmSync(work, { recursive: true, force: true }));
    console.log(`verify-release-assets: tag=${args.tag}${args.launch ? " launch=on" : ""}`);

    let dir = args.dir;
    if (!dir) {
      dir = path.join(work, "assets");
      fs.mkdirSync(dir);
      const dl = run("gh", ["release", "download", args.tag, "--dir", dir], { cwd: rootDir });
      if (dl.status !== 0) {
        console.error(`  gh release download failed: ${(dl.stderr || "").trim()}`);
        return finish(EXIT_TRANSIENT);
      }
    }

    // --- Static: asset set and checksums (every platform) ---
    const names = fs.readdirSync(dir).filter((n) => fs.statSync(path.join(dir, n)).isFile()).sort();
    const { assets, errors: setErrors } = matchAssetSet(names, version);
    check("assets.set", setErrors.length === 0,
      setErrors.length === 0 ? `${names.length} files, one per required kind` : setErrors.join("; "));
    if (!names.includes(SUMS_FILE)) return finish(exitCode);

    const actualSums = new Map(
      names.filter((n) => n !== SUMS_FILE).map((n) => [n, sha256File(path.join(dir, n))])
    );
    let sumErrors;
    try {
      const expectedSums = parseSha256Sums(fs.readFileSync(path.join(dir, SUMS_FILE), "utf8"));
      sumErrors = compareChecksums(expectedSums, actualSums);
    } catch (err) {
      sumErrors = [err.message];
    }
    check("assets.sha256", sumErrors.length === 0,
      sumErrors.length === 0 ? `${actualSums.size} files match ${SUMS_FILE}` : sumErrors.join("; "));

    const file = (kind) => (assets.has(kind) ? path.join(dir, assets.get(kind)) : null);

    // --- Static: Windows installers are checked by container signature only ---
    if (file("windows-nsis")) {
      check("windows.nsis.magic", startsWithBytes(file("windows-nsis"), [0x4d, 0x5a]), "PE header (MZ)");
    }
    if (file("windows-msi")) {
      check("windows.msi.magic",
        startsWithBytes(file("windows-msi"), [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
        "compound file header");
    }

    // --- Static: Debian package control fields ---
    if (file("linux-deb")) {
      const debDir = path.join(work, "deb");
      fs.mkdirSync(debDir);
      const unpack = run("ar", ["-x", file("linux-deb")], { cwd: debDir });
      const controlTar = fs.readdirSync(debDir).find((n) => n.startsWith("control.tar"));
      const untar = controlTar ? run("tar", ["-xf", controlTar], { cwd: debDir }) : null;
      const readable = unpack.status === 0 && untar?.status === 0 && fs.existsSync(path.join(debDir, "control"));
      check("linux.deb.control", readable, readable ? "control file extracted" : "not a readable Debian package");
      if (readable) {
        const control = fs.readFileSync(path.join(debDir, "control"), "utf8");
        const field = (k) => control.match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1]?.trim();
        check("linux.deb.version", field("Version") === version, `Version: ${field("Version")}`);
        check("linux.deb.arch", field("Architecture") === "amd64", `Architecture: ${field("Architecture")}`);
      }
    }

    // --- Static and launch: macOS bundles ---
    if (process.platform !== "darwin") {
      console.log("  [SKIP] macos.*: bundle and launch checks need macOS");
      if (args.launch) throw new ToolError("--launch is only supported on macOS");
      return finish(exitCode);
    }
    if (!file("macos-dmg") || !file("macos-app-tarball")) return finish(exitCode);

    const tauriConf = JSON.parse(fs.readFileSync(path.join(rootDir, "src-tauri", "tauri.conf.json"), "utf8"));
    const ref = args.ref ?? args.tag;
    const iconBlob = run("git", ["show", `${ref}:src-tauri/icons/icon.icns`], { cwd: rootDir, encoding: "buffer" });
    if (iconBlob.status !== 0) throw new ToolError(`git show ${ref}:src-tauri/icons/icon.icns failed`);
    const expected = {
      ref,
      version,
      identifier: tauriConf.identifier,
      iconHash: crypto.createHash("sha256").update(iconBlob.stdout).digest("hex"),
    };

    const mount = path.join(work, "mnt");
    fs.mkdirSync(mount);
    const attach = run("hdiutil", [
      "attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mount, file("macos-dmg"),
    ]);
    check("macos.dmg.mount", attach.status === 0,
      attach.status === 0 ? "disk image mounted read-only" : `hdiutil attach: ${(attach.stderr || "").trim()}`);
    const tarDir = path.join(work, "tarball");
    fs.mkdirSync(tarDir);
    const untar = run("tar", ["-xzf", file("macos-app-tarball"), "-C", tarDir]);
    check("macos.tarball.extract", untar.status === 0,
      untar.status === 0 ? "archive extracted" : `tar: ${(untar.stderr || "").trim()}`);
    if (attach.status !== 0 || untar.status !== 0) return finish(exitCode);

    cleanup.push(() => run("hdiutil", ["detach", mount, "-force"]));
    const dmgApp = findApp(mount);
    const dmgExe = checkAppBundle(dmgApp, "macos.dmg", expected, check);
    const tarExe = checkAppBundle(findApp(tarDir), "macos.tarball", expected, check);
    check("macos.same-build", sha256File(dmgExe) === sha256File(tarExe),
      `dmg executable ${sha256File(dmgExe).slice(0, 12)}, tarball executable ${sha256File(tarExe).slice(0, 12)}`);

    if (args.launch) {
      if (exitCode !== EXIT_PASS) {
        console.log("  [SKIP] launch.*: not started because a static check failed");
      } else {
        await launchCheck(dmgApp, work, check);
      }
    }
    return finish(exitCode);
  } catch (err) {
    console.error(`  ${err instanceof ToolError ? "tool error" : "unexpected error"}: ${err.message}`);
    return finish(EXIT_TOOL_ERROR);
  } finally {
    for (const fn of cleanup.reverse()) fn();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
