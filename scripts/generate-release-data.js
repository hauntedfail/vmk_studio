import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";

const __filename = url.fileURLToPath(import.meta.url);
const rootDir = path.resolve(__filename, "../..");

async function generateReleaseData() {
  const pkg = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));
  const version = pkg.version || "0.4.0";
  const payload = {
    tag_name: `v${version}`,
    name: `VMK Studio ${version}`,
    assets: [],
  };

  const dataFilePath = path.resolve(rootDir, "src", "data", "release-data.json");
  await fs.mkdir(path.dirname(dataFilePath), { recursive: true });

  const nextJson = JSON.stringify(payload, null, 2) + "\n";
  try {
    const existing = await fs.readFile(dataFilePath, "utf8");
    if (existing === nextJson) {
      return;
    }
  } catch {
    // file does not exist yet
  }

  await fs.writeFile(dataFilePath, nextJson, "utf8");
  console.log(`Generated release-data.json for v${version}`);
}

generateReleaseData();
