import { access, readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const allowed = new Set(["--install", "--rebuild", "--check", "--port"]);
let port = 3000;
for (let index = 0; index < args.length; index++) {
  if (!allowed.has(args[index])) throw new Error(`Unknown option: ${args[index]}`);
  if (args[index] === "--port") {
    const value = args[++index];
    if (!/^\d+$/.test(value ?? "")) throw new Error("Port must be an integer.");
    port = Number(value);
  }
}
if (port < 1024 || port > 65535) throw new Error("Choose a port between 1024 and 65535.");

async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function run(script, parameters, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...parameters], { cwd: root, env, stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`Command stopped with exit code ${code}.`)));
  });
}

async function main() {
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("PaperMotion requires Node.js 22 or newer. Install an approved Node.js version and retry.");
  const metadata = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const next = path.join(root, "node_modules/next/dist/bin/next");
  if (args.includes("--check")) {
    console.log(JSON.stringify({ version: metadata.version, node: process.versions.node, dependenciesInstalled: await exists(next), url: `http://127.0.0.1:${port}`, networkRequestsMade: false }, null, 2));
    return;
  }
  if (args.includes("--install")) {
    const candidates = [process.env.PAPERMOTION_NPM_CLI, process.env.npm_execpath, path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")].filter(Boolean);
    let npm;
    for (const candidate of candidates) if (await exists(candidate)) { npm = candidate; break; }
    if (!npm) throw new Error("npm CLI not found. From this folder, run npm ci with your organization's approved Node.js/npm installation.");
    console.log("Installing the locked dependencies using your existing npm configuration. Lifecycle scripts may execute. No registry, certificate, proxy, or execution-policy settings are changed.");
    await run(npm, ["ci", "--no-audit", "--no-fund"], process.env);
    return;
  }
  if (!await exists(next)) throw new Error("Dependencies are not installed. Run Start-PaperMotion.ps1 -Install to explicitly authorize installation through your configured package source. If blocked, contact IT.");
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", () => reject(new Error(`Port ${port} is occupied. Close the other instance, or use -Port with another number and a separate GETIT_DATA_DIR.`)));
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
  const env = { ...process.env, GETIT_WEB: "1", GETIT_DEFAULT_PROVIDER: process.env.GETIT_DEFAULT_PROVIDER ?? "copilot", GETIT_DISABLE_ANALYTICS: "1", NEXT_TELEMETRY_DISABLED: "1" };
  const buildDirectory = env.GETIT_ISOLATED_BUILD === "1" ? ".next-preview" : ".next";
  const buildId = path.join(root, buildDirectory, "BUILD_ID");
  const stale = await exists(buildId) && (await stat(path.join(root, "package.json"))).mtimeMs > (await stat(buildId)).mtimeMs;
  if (args.includes("--rebuild") || stale || !await exists(buildId)) {
    console.log("Building the local engine. Next.js may fetch Google Fonts; organization network policy still applies.");
    await run(next, ["build"], env);
  }
  console.log(`PaperMotion ${metadata.version}: http://127.0.0.1:${port}`);
  console.log("Keep this terminal open. Complete copilot login separately, or select another provider in Settings. Ctrl+C stops the engine; saved study data is retained.");
  await run(next, ["start", "--hostname", "127.0.0.1", "--port", String(port)], env);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });