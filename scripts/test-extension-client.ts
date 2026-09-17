import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { engineOrigin, fetchPdf, pdfHash } from "../extension/src/api";

test("extension connects only to explicit loopback HTTP engines", () => {
  assert.equal(engineOrigin("http://127.0.0.1:3001/"), "http://127.0.0.1:3001");
  assert.equal(engineOrigin("http://localhost:3000"), "http://localhost:3000");
  for (const input of ["https://example.com", "http://127.0.0.1.evil.example", "http://user:pass@localhost", "http://localhost/api", "http://localhost/?token=secret"]) {
    assert.throws(() => engineOrigin(input), input);
  }
});

test("PDF validation rejects HTML login pages and produces stable fingerprints", async () => {
  await assert.rejects(pdfHash(new Blob(["<html>Login</html>"])));
  await assert.rejects(pdfHash(new Blob([])));
  const pdf = new Blob(["%PDF-1.7 example"]);
  assert.equal(await pdfHash(pdf), await pdfHash(pdf));
  assert.notEqual(await pdfHash(pdf), await pdfHash(new Blob(["%PDF-1.7 other"])));
});

test("open local PDFs require browser file access before any bytes are read", async context => {
  const read = context.mock.method(globalThis, "fetch", async () => new Response("%PDF-1.7 local"));
  await assert.rejects(fetchPdf("file:///C:/Documents/lecture.pdf"), /Allow access to file URLs/);
  assert.equal(read.mock.callCount(), 0);
  const pdf = await fetchPdf("file:///C:/Documents/lecture.pdf", true);
  assert.equal(await pdf.text(), "%PDF-1.7 local");
  assert.equal(read.mock.callCount(), 1);
  assert.equal(read.mock.calls[0].arguments[0], "file:///C:/Documents/lecture.pdf");
  assert.equal(read.mock.calls[0].arguments[1]?.credentials, "omit");
});

test("website PDFs keep authenticated fetches and unsupported sources are not read", async context => {
  const read = context.mock.method(globalThis, "fetch", async () => new Response("%PDF-1.7 remote"));
  await fetchPdf("https://example.com/lecture.pdf");
  assert.equal(read.mock.calls[0].arguments[1]?.credentials, "include");
  for (const url of ["blob:https://example.com/temporary", "chrome://extensions", "https://user:password@example.com/lecture.pdf", "file://server/share/lecture.pdf"]) {
    await assert.rejects(fetchPdf(url, true), /Open a PDF/);
  }
  assert.equal(read.mock.callCount(), 1);
});

test("sidebar can identify website PDFs before site access is granted", async () => {
  const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  assert.ok(manifest.permissions.includes("tabs"));
  assert.deepEqual([...manifest.permissions].sort(), ["sidePanel", "storage", "tabs"]);
  assert.ok(manifest.optional_host_permissions.includes("https://*/*"));
  assert.ok(!manifest.host_permissions.includes("https://*/*"));
  assert.ok(!manifest.host_permissions.includes("<all_urls>"));
});

test("manifest declares local PDF access without relaxing script restrictions", async () => {
  const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  assert.ok(manifest.host_permissions.includes("file:///*"));
  assert.match(manifest.content_security_policy.extension_pages, /connect-src[^;]*file:/);
  assert.match(manifest.content_security_policy.extension_pages, /script-src 'self';/);
});