import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";

const __filename = url.fileURLToPath(import.meta.url);
const rootDir = path.resolve(__filename, "../..");

async function main() {
  const tagArg = process.argv[2] || "";
  const version = tagArg.replace(/^v/, "");
  if (!version) {
    console.error("Usage: node scripts/extract-release-notes.mjs <vX.Y.Z>");
    process.exit(1);
  }

  const changelog = await fs.readFile(path.join(rootDir, "CHANGELOG.md"), "utf8");
  const lines = changelog.split(/\r?\n/);
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const startRe = new RegExp(`^##\\s+\\[?${escaped}\\]?(?:\\(|\\s|$)`);

  let startIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (startRe.test(lines[i])) {
      startIdx = i;
      break;
    }
  }

  if (startIdx === -1) {
    console.log(`Release v${version} of VMK Studio.`);
    return;
  }

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }

  const section = lines
    .slice(startIdx + 1, endIdx)
    .join("\n")
    .trim();

  if (!section) {
    console.log(`Release v${version} of VMK Studio.`);
    return;
  }

  console.log(section);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
