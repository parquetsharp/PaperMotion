import { createWriteStream } from "node:fs";
import { readFile, readdir, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import archiver from "archiver";
import yauzl from "yauzl";

export function safeArchivePath(name) {
  return typeof name === "string" && !!name && !name.includes("\\") && !name.startsWith("/")
    && !name.includes(":") && !/[\x00-\x1f]/.test(name)
    && !name.split("/").some(part => part === ".." || part === "." || part === "");
}

export async function treeFiles(directory, prefix = "") {
  const result = [];
  for (const name of (await readdir(directory)).sort()) {
    const file = path.join(directory, name);
    const stat = await lstat(file);
    if (stat.isSymbolicLink()) throw new Error(`Symlink excluded from release: ${prefix}${name}`);
    if (stat.isDirectory()) result.push(...await treeFiles(file, `${prefix}${name}/`));
    else if (stat.isFile()) result.push({ name: `${prefix}${name}`, file });
  }
  return result;
}

export async function createZip(file, entries) {
  const names = new Set();
  for (const entry of entries) {
    if (!safeArchivePath(entry.name) || names.has(entry.name)) throw new Error(`Invalid or duplicate archive entry: ${entry.name}`);
    names.add(entry.name);
  }
  await new Promise((resolve, reject) => {
    const stream = createWriteStream(file);
    const zip = archiver("zip", { zlib: { level: 9 } });
    stream.on("close", resolve); stream.on("error", reject); zip.on("error", reject); zip.on("warning", reject);
    zip.pipe(stream);
    for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
      const options = { name: entry.name, date: new Date("2026-01-01T00:00:00Z"), mode: 0o644 };
      if (entry.content !== undefined) zip.append(entry.content, options);
      else zip.file(entry.file, options);
    }
    void zip.finalize().catch(reject);
  });
}

export async function zipInventory(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error) { reject(error); return; }
      const result = [];
      zip.on("error", reject);
      zip.on("end", () => resolve(result));
      zip.on("entry", entry => {
        if (!safeArchivePath(entry.fileName) || entry.uncompressedSize > 100 * 1024 * 1024) { zip.close(); reject(new Error("Unsafe release ZIP entry.")); return; }
        zip.openReadStream(entry, (failure, stream) => {
          if (failure) { zip.close(); reject(failure); return; }
          const hash = createHash("sha256");
          stream.on("error", reject);
          stream.on("data", chunk => hash.update(chunk));
          stream.on("end", () => { result.push({ name: entry.fileName, bytes: entry.uncompressedSize, sha256: hash.digest("hex") }); zip.readEntry(); });
        });
      });
      zip.readEntry();
    });
  });
}

export async function verifyZip(file, entries) {
  const inventory = await zipInventory(file);
  if (inventory.length !== entries.length) throw new Error("Archive entry count mismatch.");
  for (const entry of entries) {
    const content = entry.content !== undefined ? Buffer.from(entry.content) : await readFile(entry.file);
    const stored = inventory.find(item => item.name === entry.name);
    if (!stored || stored.sha256 !== createHash("sha256").update(content).digest("hex")) throw new Error(`Archive content mismatch: ${entry.name}`);
  }
  return inventory;
}

export function publicationBlockers(config) {
  const blockers = [];
  for (const field of ["publisherName", "supportContact", "websiteUrl", "privacyPolicyUrl", "companionDownloadUrl"]) {
    if (typeof config[field] !== "string" || !config[field].trim() || /TODO|REPLACE|example\.(com|org|test)/i.test(config[field])) blockers.push(`Complete ${field}`);
    else if (field.endsWith("Url")) {
      try { if (new URL(config[field]).protocol !== "https:") blockers.push(`${field} must use public HTTPS`); }
      catch { blockers.push(`Invalid ${field}`); }
    }
  }
  const gates = ["publisherAccountVerified", "privacyPolicyApprovedAndPublished", "companionInstallationTestedOnCleanMachine", "edgeStoreIdPairingTested", "reviewerAccessPrepared", "dataTransferAndConsentReviewed", "loopbackTransportReviewed", "generatedCodeArchitectureReviewed", "licensesAndBrandingReviewed", "finalSubmissionApproved"];
  for (const field of gates) if (config.confirmations?.[field] !== true) blockers.push(`Confirm ${field}`);
  if (!["Hidden", "Public"].includes(config.visibility)) blockers.push("Choose valid visibility");
  return blockers;
}