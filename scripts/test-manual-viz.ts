import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createManualVisualization } from "../lib/manual-viz";
import type { PersistedTagsFile } from "../lib/tags-store";

function fixture() {
  let file: PersistedTagsFile = { v: 1, docId: "test", savedAt: 0, tags: [], pagesAnalyzed: [0], activeTagId: null };
  let saves = 0;
  const dependencies = {
    document: () => ({ id: "test", filename: "paper.pdf", uploadedAt: 0, numPages: 1, pdfUrl: "/unused.pdf", extracted: { numPages: 1, pages: [{ pageIndex: 0, width: 600, height: 800, items: [], text: "Momentum is mass times velocity. Energy is conserved." }] } }),
    load: () => structuredClone(file),
    save: (_id: string, update: Omit<PersistedTagsFile, "v" | "docId" | "savedAt">) => { file = { ...file, ...update }; saves++; },
  };
  const request = { requestId: randomUUID(), page: 0, text: "Momentum is mass times velocity.", type: "formula", endX: 230, endY: 620, fontHeight: 12 };
  return { dependencies, request, read: () => file, saves: () => saves };
}

test("manual selections create persistent unique queued tags without marking new pages analyzed", () => {
  const { dependencies, request, read, saves } = fixture();
  const first = createManualVisualization("test", request, dependencies);
  assert.ok(first.id.startsWith("manual-"));
  assert.equal(first.generating, true);
  assert.equal(first.selection?.text, request.text);
  assert.match(first.concept.context, /reader-selected passage/);
  assert.equal(read().activeTagId, first.id);
  assert.deepEqual(read().pagesAnalyzed, [0]);
  assert.deepEqual(createManualVisualization("test", request, dependencies), first);
  assert.equal(saves(), 1, "Retrying the same create request does not duplicate generation");
  for (const type of ["3d", "2d-anim", "graph", "2d-text", "interactive"]) createManualVisualization("test", { ...request, type, requestId: randomUUID() }, dependencies);
  assert.equal(read().tags.length, 6);
  assert.equal(new Set(read().tags.map(tag => tag.id)).size, 6);
});

test("manual selection validates text, page, bounds, category and request identity before writing", () => {
  const { dependencies, request, saves } = fixture();
  for (const invalid of [
    { text: "not present in this PDF" }, { text: "" }, { text: "a".repeat(4001) }, { page: 1 }, { page: -1 },
    { endX: 601 }, { endY: 801 }, { endY: NaN }, { fontHeight: 0 }, { type: "unknown" }, { requestId: "../bad" }, { extra: true },
  ]) assert.throws(() => createManualVisualization("test", { ...request, ...invalid }, dependencies), { status: 400 });
  assert.equal(saves(), 0);
  assert.throws(() => createManualVisualization("test", request, { ...dependencies, document: () => undefined }), { status: 404 });
  createManualVisualization("test", request, dependencies);
  assert.throws(() => createManualVisualization("test", { ...request, text: "Energy is conserved." }, dependencies), { status: 409 });
  assert.throws(() => createManualVisualization("test", { ...request, type: "graph" }, dependencies), { status: 409 });
  assert.throws(() => createManualVisualization("test", { ...request, label: "Other label" }, dependencies), { status: 409 });
  assert.equal(saves(), 1);
});