import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { safeArchivePath, createZip, verifyZip, publicationBlockers } from "./release/archive.mjs";

test("release archives reject traversal, duplicate names, and preserve exact bytes", async () => {
  for (const name of ["../secret", "/absolute", "C:/secret", "a\\b", "a/../b", "a//b", "a\u0000b"]) assert.equal(safeArchivePath(name), false);
  assert.equal(safeArchivePath("licenses/package/LICENSE"), true);
  const directory = await mkdtemp(path.join(tmpdir(), "papermotion-release-test-"));
  try {
    const entries = [{ name: "manifest.json", content: '{"manifest_version":3}' }, { name: "assets/icon.bin", content: Buffer.from([0, 255, 13, 10]) }];
    const file = path.join(directory, "test.zip");
    await createZip(file, entries);
    assert.equal((await verifyZip(file, entries)).length, 2);
    await assert.rejects(createZip(file, [entries[0], entries[0]]), /duplicate/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("submission readiness fails closed for missing identity, URLs, and approvals", () => {
  const blockers = publicationBlockers({ visibility: "Hidden", confirmations: {} });
  assert.ok(blockers.includes("Complete privacyPolicyUrl"));
  assert.ok(blockers.includes("Confirm finalSubmissionApproved"));
  assert.ok(publicationBlockers({ visibility: "Hidden", websiteUrl: "http://example.com" }).some(value => value.includes("websiteUrl")));
});