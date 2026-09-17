import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") throw new Error("The PaperMotion native host must be built on Windows.");

const root = fileURLToPath(new URL("../", import.meta.url));
const framework = path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319");
const compiler = path.join(framework, "csc.exe");
const outputDirectory = path.join(root, "dist-native");
const output = path.join(outputDirectory, "PaperMotion.NativeHost.exe");
mkdirSync(outputDirectory, { recursive: true });

const result = spawnSync(compiler, [
  "/nologo",
  "/target:exe",
  "/optimize+",
  "/platform:x64",
  `/reference:${path.join(framework, "System.Web.Extensions.dll")}`,
  `/out:${output}`,
  path.join(root, "electron", "native-host", "Program.cs"),
], { cwd: root, stdio: "inherit", shell: false });

if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Native host compiler exited with code ${result.status}.`);
console.log(`Built native messaging host: ${output}`);