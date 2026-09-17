import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

if (process.platform !== "win32") throw new Error("Edge Native Messaging integration is Windows-only.");

const root = path.resolve(import.meta.dirname, "..");
const extensionDirectory = path.join(root, "extension", "build");
const hostManifest = path.join(root, "dist-electron", "win-unpacked", "com.papermotion.engine.json");
const registryKey = "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.papermotion.engine";
const dataDirectory = path.join(process.env.APPDATA, "get-it");
const runtimeFile = path.join(dataDirectory, "engine-runtime.json");
const temporary = await mkdtemp(path.join(tmpdir(), "papermotion-native-edge-"));
const runtimeBackup = path.join(temporary, "engine-runtime.backup.json");
let hadRuntime = false;
let previousRegistry = null;
let context;
const server = createServer((request, response) => {
  if (request.url === "/api/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, service: "get-it-local-web" }));
    return;
  }
  response.writeHead(404).end();
});

function registry(...parameters) {
  return spawnSync("reg.exe", parameters, { encoding: "utf8", windowsHide: true });
}

try {
  const existing = registry("query", registryKey, "/ve");
  const match = existing.status === 0 ? existing.stdout.match(/REG_SZ\s+(.+)\s*$/m) : null;
  previousRegistry = match?.[1]?.trim() ?? null;

  try {
    await copyFile(runtimeFile, runtimeBackup);
    hadRuntime = true;
  } catch {}

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(runtimeFile, JSON.stringify({ origin, pid: process.pid, startedAt: Date.now() }) + "\n");

  const registration = registry("add", registryKey, "/ve", "/t", "REG_SZ", "/d", hostManifest, "/f");
  assert.equal(registration.status, 0, registration.stderr || registration.stdout);

  context = await chromium.launchPersistentContext(path.join(temporary, "profile"), {
    channel: "msedge",
    headless: true,
    args: [`--disable-extensions-except=${extensionDirectory}`, `--load-extension=${extensionDirectory}`],
  });
  const isWorker = worker => worker.url().startsWith("chrome-extension://") && worker.url().endsWith("/background.js");
  const worker = context.serviceWorkers().find(isWorker) ?? await context.waitForEvent("serviceworker", { predicate: isWorker });
  const result = await worker.evaluate(host => new Promise(resolve => {
    chrome.runtime.sendNativeMessage(host, { type: "start", version: 1 }, response => {
      resolve({ response, error: chrome.runtime.lastError?.message ?? null });
    });
  }), "com.papermotion.engine");
  assert.equal(result.error, null);
  assert.deepEqual(result.response, { ok: true, origin, alreadyRunning: true });
  console.log(`Edge Native Messaging launched PaperMotion.NativeHost.exe and returned ${origin}.`);
} finally {
  await context?.close();
  server.close();
  if (previousRegistry) registry("add", registryKey, "/ve", "/t", "REG_SZ", "/d", previousRegistry, "/f");
  else registry("delete", registryKey, "/f");
  if (hadRuntime) await copyFile(runtimeBackup, runtimeFile);
  else await rm(runtimeFile, { force: true });
  await rm(temporary, { recursive: true, force: true });
}
