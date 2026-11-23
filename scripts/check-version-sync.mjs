import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";

const __filename = url.fileURLToPath(import.meta.url);
const rootDir = path.resolve(__filename, "../..");

function parseArgs(argv) {
  let tag = null;
  let requireChangelog = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--tag" && argv[i + 1]) {
      tag = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--require-changelog") {
      requireChangelog = true;
    }
  }
  return { tag, requireChangelog };
}

function isValidSemver(v) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(v);
}

async function main() {
  const { tag, requireChangelog } = parseArgs(process.argv.slice(2));

  const pkg = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));
  const tauriConf = JSON.parse(
    await fs.readFile(path.join(rootDir, "src-tauri/tauri.conf.json"), "utf8")
  );
  const cargoToml = await fs.readFile(path.join(rootDir, "src-tauri/Cargo.toml"), "utf8");
  const cargoPkgSection = cargoToml.split(/^\[/m).find((s) => s.startsWith("package]")) || "";
  const cargoMatch = cargoPkgSection.match(/^version\s*=\s*"([^"]+)"/m);

  const versions = {
    "package.json": pkg.version,
    "src-tauri/tauri.conf.json": tauriConf.version,
    "src-tauri/Cargo.toml": cargoMatch?.[1] ?? "(missing)",
  };

  const errors = [];
  const expected = pkg.version;

  if (!isValidSemver(expected)) {
    errors.push(`package.json version "${expected}" is not valid SemVer`);
  }

  for (const [file, ver] of Object.entries(versions)) {
    if (ver !== expected) {
      errors.push(`${file} version "${ver}" does not match package.json "${expected}"`);
    }
  }

  if (tag) {
    const expectedTag = `v${expected}`;
    if (tag !== expectedTag) {
      errors.push(`Release tag "${tag}" does not match expected tag "${expectedTag}"`);
    }
  }

  if (requireChangelog) {
    const changelog = await fs.readFile(path.join(rootDir, "CHANGELOG.md"), "utf8");
    const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const headingRe = new RegExp(`^##\\s+\\[?${escaped}\\]?(?:\\(|\\s|$)`, "m");
    if (!headingRe.test(changelog)) {
      errors.push(`CHANGELOG.md is missing a "## [${expected}]" release section`);
    }
  }

  for (const [file, ver] of Object.entries(versions)) {
    console.log(`  ${file.padEnd(28)} ${ver}`);
  }
  if (tag) {
    console.log(`  ${"release tag".padEnd(28)} ${tag}`);
  }

  if (errors.length > 0) {
    console.error("\nVersion sync check failed:");
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  console.log(`\nVersion sync OK (v${expected})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
