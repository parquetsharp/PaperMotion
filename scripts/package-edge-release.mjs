import { readFile, writeFile, mkdir, rm, copyFile, lstat } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";
import { createZip, verifyZip, treeFiles, publicationBlockers } from "./release/archive.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const config = JSON.parse(await readFile(path.join(root, "release/edge/release.json"), "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(config.releaseVersion)) throw new Error("Release version must be numeric major.minor.patch.");
const output = path.join(root, "dist-release", "edge", config.releaseVersion);
const blockers = publicationBlockers(config);
const lockfile = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
const registryHosts = [...new Set(Object.values(lockfile.packages).flatMap(pkg => {
  if (typeof pkg.resolved !== "string" || !pkg.resolved.startsWith("https://")) return [];
  return [new URL(pkg.resolved).hostname];
}))];
if (registryHosts.some(host => host !== "registry.npmjs.org") && config.confirmations?.companionInstallationTestedOnCleanMachine !== true) blockers.push("Verify non-public-registry lockfile URLs on the intended reviewer/customer machine");
if (process.argv.includes("--require-ready") && blockers.length) throw new Error(`Not ready for submission:\n${blockers.join("\n")}`);
await mkdir(output, { recursive: true });
const build = spawnSync(process.execPath, [path.join(root, "scripts/build-extension.mjs")], { cwd: root, stdio: "inherit" });
if (build.status !== 0) throw new Error("Extension build failed; no release package created.");

const extensionDirectory = path.join(root, "extension/build");
const manifest = JSON.parse(await readFile(path.join(extensionDirectory, "manifest.json"), "utf8"));
if (manifest.version !== config.releaseVersion) throw new Error("Extension manifest version and release version must match.");
if (manifest.manifest_version !== 3 || manifest.permissions.includes("activeTab")) throw new Error("Manifest permission audit is out of date.");
const extensionEntries = await treeFiles(extensionDirectory);
for (const entry of extensionEntries) {
  if (/(^|\/)(\.env[^/]*|node_modules|data|\.git)(\/|$)|\.(map|pem|key|pfx)$/i.test(entry.name)) throw new Error(`Forbidden extension entry: ${entry.name}`);
}
const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const baseline = "ae0fa99";
const changed = new Set(execFileSync("git", ["diff", "--name-only", baseline], { cwd: root, encoding: "utf8" }).trim().split(/\r?\n/));
const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
for (const file of untracked) changed.add(file);
const candidates = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
const roots = new Set(["package.json", "package-lock.json", "LICENSE", "README.md", "README.upstream.md", "CONTRIBUTING.md", "technical-writeup.md", "next.config.ts", "tsconfig.json", "postcss.config.mjs", "eslint.config.mjs", "AGENTS.md", "CLAUDE.md", ".env.example"]);
const allowedSource = file => roots.has(file)
  || /^(app|components|lib)\/.+\.(tsx?|jsx?|css|json)$/.test(file)
  || /^scripts\/(?!extension-out\/|smoke-out\/).+\.(mjs|cjs|tsx?|js)$/.test(file)
  || /^extension\/(?:src\/.+\.(tsx?|css)|manifest\.json|panel\.html|README\.md)$/.test(file)
  || /^release\/.+\.(md|txt|json|ps1)$/.test(file)
  || /^electron\/.+\.(js|html|css|plist)$/.test(file)
  || /^public\/(?:pdf\.worker\.min\.mjs|pdfs\/(?:anatomy|calculus|chemistry|physics)\.pdf)$/.test(file);
const sourceEntries = [];
const sourceInventory = [];
const modified = [];
for (const name of [...new Set(candidates)].filter(allowedSource).sort()) {
  const file = path.join(root, name);
  let info;
  try { info = await lstat(file); } catch { continue; }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Unsupported release source: ${name}`);
  let content = await readFile(file);
  sourceInventory.push({ name, sha256: createHash("sha256").update(content).digest("hex") });
  if (name === "package.json" || name === "package-lock.json") {
    const value = JSON.parse(content.toString("utf8"));
    value.version = config.releaseVersion;
    if (value.packages?.[""]) value.packages[""].version = config.releaseVersion;
    content = Buffer.from(JSON.stringify(value, null, 2) + "\n");
  }
  if (changed.has(name)) {
    modified.push(name);
    if (/\.(tsx?|jsx?|mjs|cjs|css)$/.test(name)) {
      let text = content.toString("utf8");
      const notice = "/* Modified for PaperMotion; see MODIFICATIONS.md and NOTICE.txt. */\n";
      if (text.startsWith("#!")) { const split = text.indexOf("\n") + 1; text = text.slice(0, split) + notice + text.slice(split); }
      else text = notice + text;
      content = Buffer.from(text);
    }
  }
  sourceEntries.push({ name, content });
}
const modifications = `# PaperMotion Source Modifications\n\nRelease ${config.releaseVersion}, assembled from working tree based on ${sourceRevision}. Upstream comparison: Get It. commit ${baseline}. Original copyright and attribution notices remain in distributed source. Modified code files carry a release notice. JSON and other data-file changes are listed here because adding comments would invalidate their format. Package/lock version fields are stamped during packaging only.\n\n${modified.map(name => `- ${name}`).join("\n")}\n`;
sourceEntries.push({ name: "MODIFICATIONS.md", content: modifications });
sourceEntries.push({ name: "NOTICE.txt", file: path.join(root, "release/edge/NOTICE.txt") });
sourceEntries.push({ name: "START-HERE.md", file: path.join(root, "release/companion/START-HERE.md") });
sourceEntries.push({ name: "Start-PaperMotion.ps1", file: path.join(root, "release/companion/Start-PaperMotion.ps1") });
const provenance = { version: config.releaseVersion, sourceRevision, workingTreeChangesIncluded: modified, sourceFiles: sourceInventory };
sourceEntries.push({ name: "SOURCE-PROVENANCE.json", content: JSON.stringify(provenance, null, 2) + "\n" });
extensionEntries.push({ name: "MODIFICATIONS.md", content: modifications });

const extensionZip = path.join(output, `PaperMotion-Edge-${config.releaseVersion}.zip`);
const companionZip = path.join(output, `PaperMotion-Engine-Source-${config.releaseVersion}.zip`);
const inventories = {};
for (const [file, entries] of [[extensionZip, extensionEntries], [companionZip, sourceEntries]]) {
  await createZip(file, entries);
  inventories[path.basename(file)] = await verifyZip(file, entries);
}
const assets = path.join(output, "assets");
await rm(assets, { recursive: true, force: true });
await mkdir(assets, { recursive: true });
await sharp(path.join(extensionDirectory, "icon-128.png")).resize(300, 300).png().toFile(path.join(assets, "logo-300.png"));
const screenshots = [];
for (const name of ["store-chat.png", "store-quiz.png", "store-concepts.png"]) {
  const source = path.join(root, "scripts/extension-out", name);
  try { await accessScreenshot(source); } catch { continue; }
  await copyFile(source, path.join(assets, name)); screenshots.push(name);
}
async function accessScreenshot(file) {
  const metadata = await sharp(file).metadata();
  if (!((metadata.width === 640 && metadata.height === 480) || (metadata.width === 1280 && metadata.height === 800))) throw new Error("Invalid screenshot dimensions.");
}
const documents = path.join(output, "submission-drafts");
await rm(documents, { recursive: true, force: true });
await mkdir(documents, { recursive: true });
for (const name of ["READINESS.md", "VALIDATION.md", "STORE-LISTING.md", "PERMISSIONS.md", "PRIVACY-POLICY-DRAFT.md", "REVIEWER-NOTES.md", "SECURITY-REVIEW.md", "RELEASE-NOTES.md", "release.json"]) await copyFile(path.join(root, "release/edge", name), path.join(documents, name));
const checksums = [];
for (const file of [extensionZip, companionZip]) checksums.push(`${createHash("sha256").update(await readFile(file)).digest("hex")}  ${path.basename(file)}`);
await writeFile(path.join(output, "SHA256SUMS.txt"), checksums.join("\n") + "\n");
await writeFile(path.join(output, "archive-inventory.json"), JSON.stringify(inventories, null, 2) + "\n");
const report = { version: config.releaseVersion, visibility: config.visibility, readyForSubmission: blockers.length === 0, submitted: false, blockers, generatedAt: new Date().toISOString(), sourceRevision, registryHosts, bundledPackages: JSON.parse(await readFile(path.join(extensionDirectory, "third-party-inventory.json"), "utf8")).length, screenshots, archives: Object.fromEntries(Object.entries(inventories).map(([name, entries]) => [name, { entries: entries.length, verified: true }])) };
await writeFile(path.join(output, "readiness-report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ output, archives: report.archives, bundledPackages: report.bundledPackages, screenshots, readyForSubmission: report.readyForSubmission, unresolvedGates: blockers.length, submitted: false }, null, 2));