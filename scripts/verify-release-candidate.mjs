import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
import yauzl from "yauzl";
import { fileURLToPath } from "node:url";
import { safeArchivePath, zipInventory } from "./release/archive.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const config = JSON.parse(await readFile(path.join(root, "release/edge/release.json"), "utf8"));
const output = path.join(root, "dist-release/edge", config.releaseVersion);
const extension = await zipInventory(path.join(output, `PaperMotion-Edge-${config.releaseVersion}.zip`));
const companionFile = path.join(output, `PaperMotion-Engine-Source-${config.releaseVersion}.zip`);
const companion = await zipInventory(companionFile);
for (const entries of [extension, companion]) {
  assert.ok(entries.some(entry => entry.name === "LICENSE"));
  assert.ok(entries.some(entry => entry.name === "NOTICE.txt"));
  assert.ok(entries.some(entry => entry.name === "MODIFICATIONS.md"));
  assert.ok(!entries.some(entry => /(^|\/)(node_modules|data|\.git|\.next[^/]*|extension-out)(\/|$)|(^|\/)\.env(?!\.example$)|\.(pem|pfx|key)$/i.test(entry.name)));
}
assert.ok(extension.some(entry => entry.name === "manifest.json"));
assert.ok(extension.some(entry => entry.name === "THIRD_PARTY_NOTICES.md"));
const temporary = await mkdtemp(path.join(tmpdir(), "papermotion-release-extract-"));
try {
  await new Promise((resolve, reject) => {
    yauzl.open(companionFile, { lazyEntries: true }, (error, zip) => {
      if (error) { reject(error); return; }
      zip.on("error", reject); zip.on("end", resolve);
      zip.on("entry", entry => {
        if (!safeArchivePath(entry.fileName)) { zip.close(); reject(new Error("Unsafe archive path")); return; }
        zip.openReadStream(entry, (failure, stream) => {
          if (failure) { zip.close(); reject(failure); return; }
          const destination = path.join(temporary, entry.fileName);
          void mkdir(path.dirname(destination), { recursive: true })
            .then(() => pipeline(stream, createWriteStream(destination, { flags: "wx" })))
            .then(() => zip.readEntry()).catch(reject);
        });
      });
      zip.readEntry();
    });
  });
  const pkg = JSON.parse(await readFile(path.join(temporary, "package.json"), "utf8"));
  const lock = JSON.parse(await readFile(path.join(temporary, "package-lock.json"), "utf8"));
  assert.equal(pkg.version, config.releaseVersion);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
  assert.deepEqual(pkg.dependencies, lock.packages[""].dependencies);
  assert.deepEqual(pkg.devDependencies, lock.packages[""].devDependencies);
  const check = spawnSync(process.execPath, ["scripts/start-companion.mjs", "--check"], { cwd: temporary, encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr);
  const status = JSON.parse(check.stdout);
  assert.equal(status.version, config.releaseVersion);
  assert.equal(status.dependenciesInstalled, false);
  assert.equal(status.networkRequestsMade, false);
  const missing = spawnSync(process.execPath, ["scripts/start-companion.mjs"], { cwd: temporary, encoding: "utf8" });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Dependencies are not installed/);
  console.log(`Verified ${extension.length} extension files and ${companion.length} source files; extracted launcher reports version ${pkg.version} and refuses missing dependencies without downloads.`);
} finally { await rm(temporary, { recursive: true, force: true }); }