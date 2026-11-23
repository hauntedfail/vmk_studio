import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import url from "node:url";
import { spawn } from "node:child_process";

const __filename = url.fileURLToPath(import.meta.url);
const rootDir = path.resolve(__filename, "../..");

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close(() => reject(new Error("Could not allocate free TCP port")));
        return;
      }
      const { port } = addr;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHttp(targetUrl, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(targetUrl);
      if (res.ok) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for ${targetUrl}: ${lastError}`);
}

async function main() {
  const distIndex = path.join(rootDir, "dist", "index.html");
  await fs.access(distIndex);

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const viteBin = path.join(
    rootDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "vite.cmd" : "vite"
  );

  const proc = spawn(
    viteBin,
    ["preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    }
  );

  let stderr = "";
  proc.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  try {
    const res = await waitForHttp(baseUrl);
    const html = await res.text();
    if (!html.includes("<title>VMK Studio</title>")) {
      throw new Error("Preview HTML is missing expected <title>VMK Studio</title>");
    }

    const assetPaths = new Set();
    for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) {
      assetPaths.add(match[1]);
    }
    if (assetPaths.size === 0) {
      throw new Error("No built /assets/* references found in dist/index.html");
    }

    for (const assetPath of assetPaths) {
      const assetRes = await fetch(`${baseUrl}${assetPath}`);
      if (!assetRes.ok) {
        throw new Error(`Asset ${assetPath} returned HTTP ${assetRes.status}`);
      }
      const body = await assetRes.arrayBuffer();
      if (body.byteLength === 0) {
        throw new Error(`Asset ${assetPath} is empty`);
      }
    }

    console.log(
      `Preview smoke test OK (${baseUrl}, verified ${assetPaths.size} built assets)`
    );
  } catch (err) {
    if (stderr.trim()) {
      console.error("vite preview stderr:\n" + stderr);
    }
    throw err;
  } finally {
    proc.kill("SIGTERM");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
