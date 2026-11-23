import fs from "fs/promises";
import path from "path";
import url from "url";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.resolve(__filename, "../..");

const FALLBACK = {
  tag_name: "v0.4.0",
  name: "VMK Studio 0.4.0",
  assets: [],
};

async function generateReleaseData() {
  const dataFilePath = path.resolve(__dirname, "src", "data", "release-data.json");
  await fs.mkdir(path.dirname(dataFilePath), { recursive: true });

  try {
    await fs.access(dataFilePath);
    return;
  } catch {
    // file does not exist yet
  }

  await fs.writeFile(dataFilePath, JSON.stringify(FALLBACK, null, 2) + "\n");
  console.log("Generated default release-data.json");
}

generateReleaseData();
