"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const HOST_NAME = "com.papermotion.engine";
const MAX_MESSAGE_BYTES = 64 * 1024;
const RUNTIME_FILE = "engine-runtime.json";

function defaultDataDirectory(environment = process.env, platform = process.platform) {
  if (platform === "win32") return path.join(environment.APPDATA || "", "get-it");
  if (platform === "darwin") return path.join(environment.HOME || "", "Library", "Application Support", "get-it");
  return path.join(environment.XDG_CONFIG_HOME || path.join(environment.HOME || "", ".config"), "get-it");
}

function runtimeFile(dataDirectory) {
  return path.join(dataDirectory, RUNTIME_FILE);
}

function validOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:"
      && ["127.0.0.1", "localhost"].includes(url.hostname)
      && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

function readRuntime(dataDirectory) {
  try {
    const value = JSON.parse(fs.readFileSync(runtimeFile(dataDirectory), "utf8"));
    const origin = validOrigin(value.origin);
    return origin && Number.isInteger(value.pid) && value.pid > 0
      ? { origin, pid: value.pid, startedAt: Number(value.startedAt) || 0 }
      : null;
  } catch {
    return null;
  }
}

function writeRuntime(dataDirectory, value) {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const target = runtimeFile(dataDirectory);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function removeRuntime(dataDirectory, pid = process.pid) {
  const current = readRuntime(dataDirectory);
  if (!current || current.pid !== pid) return;
  try { fs.rmSync(runtimeFile(dataDirectory), { force: true }); } catch { /* best effort */ }
}

function probe(origin, timeoutMs = 1500) {
  return new Promise(resolve => {
    const request = http.get(`${origin}/api/health`, { timeout: timeoutMs }, response => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.once("error", () => resolve(false));
    request.once("timeout", () => { request.destroy(); resolve(false); });
  });
}

async function waitForRuntime(dataDirectory, timeoutMs, probeEngine = probe) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = readRuntime(dataDirectory);
    if (current && await probeEngine(current.origin)) return current;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return null;
}

function launchCompanion(executable = process.execPath) {
  const child = spawn(executable, ["--papermotion-extension-start"], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
}

function decodeMessage(buffer) {
  if (buffer.length < 4) throw new Error("Native message header is incomplete.");
  const length = buffer.readUInt32LE(0);
  if (!length || length > MAX_MESSAGE_BYTES || buffer.length !== length + 4) throw new Error("Native message length is invalid.");
  return JSON.parse(buffer.subarray(4).toString("utf8"));
}

function encodeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  if (body.length > MAX_MESSAGE_BYTES) throw new Error("Native response is too large.");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

async function readMessage(input) {
  let buffered = Buffer.alloc(0);
  for await (const chunk of input) {
    buffered = Buffer.concat([buffered, chunk]);
    if (buffered.length < 4) continue;
    const length = buffered.readUInt32LE(0);
    if (!length || length > MAX_MESSAGE_BYTES) throw new Error("Native message length is invalid.");
    if (buffered.length >= length + 4) return decodeMessage(buffered.subarray(0, length + 4));
  }
  throw new Error("Native message is incomplete.");
}

async function handleMessage(message, options = {}) {
  if (!message || message.type !== "start" || message.version !== 1) {
    return { ok: false, code: "invalid_request", message: "Unsupported PaperMotion companion request." };
  }
  const dataDirectory = options.dataDirectory || defaultDataDirectory();
  const probeEngine = options.probeEngine || probe;
  const current = readRuntime(dataDirectory);
  if (current && await probeEngine(current.origin)) return { ok: true, origin: current.origin, alreadyRunning: true };
  try {
    (options.launch || launchCompanion)();
  } catch {
    return { ok: false, code: "launch_failed", message: "PaperMotion could not be started." };
  }
  const started = await waitForRuntime(dataDirectory, options.timeoutMs || 90000, probeEngine);
  return started
    ? { ok: true, origin: started.origin, alreadyRunning: false }
    : { ok: false, code: "start_timeout", message: "PaperMotion did not finish starting. Complete any setup shown by the desktop app, then retry." };
}

async function runNativeMessagingHost(options = {}) {
  const input = options.input || process.stdin;
  let response;
  try {
    response = await handleMessage(await readMessage(input), options);
  } catch {
    response = { ok: false, code: "invalid_request", message: "The native companion received an invalid request." };
  }
  input.pause?.();
  await new Promise(resolve => (options.output || process.stdout).write(encodeMessage(response), resolve));
}

module.exports = {
  HOST_NAME,
  decodeMessage,
  defaultDataDirectory,
  encodeMessage,
  handleMessage,
  readRuntime,
  readMessage,
  removeRuntime,
  runNativeMessagingHost,
  validOrigin,
  writeRuntime,
};