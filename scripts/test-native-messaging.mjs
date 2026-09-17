import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { decodeMessage, encodeMessage, handleMessage, runNativeMessagingHost, validOrigin, writeRuntime } = require("../electron/native-messaging.js");
const { EXTENSION_IDS, HOST_EXECUTABLE, HOST_NAME, nativeHostManifest } = require("../electron/native-host-config.js");

test("native host manifest permits only the stable PaperMotion extension", () => {
  assert.equal(HOST_NAME, "com.papermotion.engine");
  assert.equal(HOST_EXECUTABLE, "PaperMotion.NativeHost.exe");
  assert.deepEqual(EXTENSION_IDS, ["dnjgmbcbfbhomhaneaafdjikpinkhhkd"]);
  assert.deepEqual(nativeHostManifest(), {
    name: HOST_NAME,
    description: "Starts the local PaperMotion learning engine",
    path: HOST_EXECUTABLE,
    type: "stdio",
    allowed_origins: ["chrome-extension://dnjgmbcbfbhomhaneaafdjikpinkhhkd/"],
  });
  const extensionManifest = require("../extension/manifest.json");
  const digest = createHash("sha256").update(Buffer.from(extensionManifest.key, "base64")).digest().subarray(0, 16);
  const derivedId = [...digest].map(byte => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15))).join("");
  assert.equal(derivedId, EXTENSION_IDS[0]);
  const hostSource = require("node:fs").readFileSync(new URL("../electron/native-host/Program.cs", import.meta.url), "utf8");
  assert.match(hostSource, new RegExp(`AllowedCaller = "chrome-extension://${derivedId}/"`));
});

test("Windows installer registers and removes the native host for Edge and Chrome", async () => {
  const installer = await (await import("node:fs/promises")).readFile(new URL("../electron/installer.nsh", import.meta.url), "utf8");
  for (const browser of ["Microsoft\\Edge", "Google\\Chrome"]) {
    assert.match(installer, new RegExp(`WriteRegStr HKCU "Software\\\\${browser.replace("\\", "\\\\")}\\\\NativeMessagingHosts\\\\${HOST_NAME.replaceAll(".", "\\.")}"`));
    assert.match(installer, new RegExp(`DeleteRegKey HKCU "Software\\\\${browser.replace("\\", "\\\\")}\\\\NativeMessagingHosts\\\\${HOST_NAME.replaceAll(".", "\\.")}"`));
  }
  assert.match(installer, new RegExp(HOST_NAME.replaceAll(".", "\\.")));
});

test("native protocol frames one bounded JSON message", () => {
  const message = { type: "start", version: 1 };
  assert.deepEqual(decodeMessage(encodeMessage(message)), message);
  assert.throws(() => decodeMessage(Buffer.from([1, 0, 0, 0])));
  assert.equal(validOrigin("http://127.0.0.1:4312"), "http://127.0.0.1:4312");
  assert.equal(validOrigin("https://127.0.0.1:4312"), null);
  assert.equal(validOrigin("http://127.0.0.1.evil.example"), null);
});

test("start reuses a healthy engine without launching another app", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "papermotion-native-"));
  try {
    writeRuntime(directory, { origin: "http://127.0.0.1:4312", pid: 42, startedAt: Date.now() });
    let launches = 0;
    const result = await handleMessage({ type: "start", version: 1 }, {
      dataDirectory: directory,
      probeEngine: async () => true,
      launch: () => { launches += 1; },
    });
    assert.deepEqual(result, { ok: true, origin: "http://127.0.0.1:4312", alreadyRunning: true });
    assert.equal(launches, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("start launches the companion and waits for its healthy rendezvous", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "papermotion-native-"));
  try {
    const result = await handleMessage({ type: "start", version: 1 }, {
      dataDirectory: directory,
      timeoutMs: 1000,
      probeEngine: async origin => origin === "http://localhost:5789",
      launch: () => writeRuntime(directory, { origin: "http://localhost:5789", pid: 84, startedAt: Date.now() }),
    });
    assert.deepEqual(result, { ok: true, origin: "http://localhost:5789", alreadyRunning: false });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("stdio host responds without waiting for the browser to close stdin", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "papermotion-native-"));
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks = [];
  output.on("data", chunk => chunks.push(chunk));
  input.write(encodeMessage({ type: "start", version: 1 }));
  try {
    await runNativeMessagingHost({
      input,
      output,
      dataDirectory: directory,
      timeoutMs: 1000,
      probeEngine: async () => true,
      launch: () => writeRuntime(directory, { origin: "http://127.0.0.1:6001", pid: 99, startedAt: Date.now() }),
    });
    assert.deepEqual(decodeMessage(Buffer.concat(chunks)), { ok: true, origin: "http://127.0.0.1:6001", alreadyRunning: false });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("application entry dispatches native messages before normal app startup", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "papermotion-native-entry-"));
  const appData = path.join(directory, "appdata");
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, service: "get-it-local-web" }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  writeRuntime(path.join(appData, "get-it"), { origin: `http://127.0.0.1:${address.port}`, pid: process.pid, startedAt: Date.now() });
  try {
    const nativeHostExecutable = process.env.PAPERMOTION_NATIVE_EXE;
    const executable = nativeHostExecutable || process.execPath;
    const parameters = nativeHostExecutable
      ? [`chrome-extension://${EXTENSION_IDS[0]}/`]
      : [path.resolve("electron/main.js"), `chrome-extension://${EXTENSION_IDS[0]}/`];
    const child = spawn(executable, parameters, {
      env: { ...process.env, APPDATA: appData, PAPERMOTION_DATA_DIR: path.join(appData, "get-it") },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", chunk => stdout.push(chunk));
    child.stderr.on("data", chunk => stderr.push(chunk));
    child.stdin.end(encodeMessage({ type: "start", version: 1 }));
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    assert.equal(code, 0, Buffer.concat(stderr).toString("utf8"));
    assert.deepEqual(decodeMessage(Buffer.concat(stdout)), { ok: true, origin: `http://127.0.0.1:${address.port}`, alreadyRunning: true });
  } finally {
    server.close();
    await rm(directory, { recursive: true, force: true });
  }
});