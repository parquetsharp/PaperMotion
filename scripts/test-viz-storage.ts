import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setImmediate } from "node:timers/promises";

test("deleted queued/running tags stay deleted through late results, stale saves and re-detection", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "papermotion-delete-test-"));
  const oldDirectory = process.env.GETIT_DATA_DIR;
  process.env.GETIT_DATA_DIR = directory;
  try {
    const { saveDoc } = await import("../lib/store");
    const { loadTags, saveTags } = await import("../lib/tags-store");
    const { loadSettings, saveSettings } = await import("../lib/settings-store");
    const { deleteVisualization } = await import("../lib/viz-edit");
    const { beginVizEdit } = await import("../lib/viz-edit-lock");
    const { ensureDetection, ensureVizQueue, getJobStatus, requestVizGeneration } = await import("../lib/jobs");
    const { CopilotProvider } = await import("../lib/providers/copilot-provider");
    const { visualizationVersions } = await import("../lib/viz-versions");
    const docId = "delete-fixture";
    const text = "Momentum equals mass times velocity. ".repeat(6);
    saveDoc({ id: docId, filename: "paper.pdf", uploadedAt: 0, numPages: 1, pdfUrl: "/unused.pdf", extracted: { numPages: 1, pages: [{ pageIndex: 0, width: 600, height: 800, text, items: [{ str: text, x: 5, y: 5, width: 500, height: 12, eol: true }] }] } });
    saveSettings({ ...loadSettings(), provider: "copilot", autoGenerate: true, vizConcurrency: 1 });
    const spec = { type: "formula" as const, title: "Momentum", caption: "Momentum formula", main_latex: "p=mv", steps: [] };
    const concept = { type: "formula" as const, label: "Momentum", context: text, anchor: "Momentum equals mass times velocity." };
    const tags = ["0-0", "queued", "kept"].map(id => ({ id, page: 0, endX: 10, endY: 10, fontHeight: 12, label: id, type: "formula" as const, ready: id === "kept", generating: id !== "kept", concept, ...(id === "kept" ? { spec } : {}) }));
    saveTags(docId, { tags, activeTagId: "0-0", pagesAnalyzed: [] });
    const pending: Array<() => void> = [];
    let calls = 0;
    const runner = mock.method(CopilotProvider.prototype, "runJson", (prompt: string) => {
      calls++;
      if (prompt.includes("--- PAGES ---")) return Promise.resolve({ data: { concepts: [{ ...concept, page: 0 }] }, usage: null });
      return new Promise(resolve => pending.push(() => resolve({ data: spec, usage: null })));
    });
    const flush = async () => { for (let tick = 0; tick < 25; tick++) await setImmediate(); };
    try {
      ensureVizQueue(docId);
      await flush();
      assert.equal(calls, 1);
      assert.throws(() => deleteVisualization(docId, "kept", { revision: 99 }), { status: 409 });
      const release = beginVizEdit(docId, "kept")!;
      assert.throws(() => deleteVisualization(docId, "kept", { revision: 0 }), { status: 409 });
      release();
      deleteVisualization(docId, "0-0", { revision: 0 });
      deleteVisualization(docId, "queued", { revision: 0 });
      pending.shift()!();
      await flush();
      assert.equal(calls, 1, "Queued deleted tag never calls the model");
      assert.equal(getJobStatus(docId).vizQueueRunning, false);
      saveTags(docId, { tags, activeTagId: "queued", pagesAnalyzed: [] });
      assert.deepEqual(loadTags(docId)!.tags.map(tag => tag.id), ["kept"]);
      assert.equal(loadTags(docId)!.activeTagId, null);
      ensureDetection(docId);
      await flush();
      assert.equal(calls, 2);
      assert.equal(loadTags(docId)!.tags.length, 1, "Re-detection cannot recreate a deleted detected tag");
      requestVizGeneration(docId, "queued");
      await flush();
      assert.equal(calls, 2);
      for (let generation = 0; generation < 8; generation++) {
        requestVizGeneration(docId, "kept");
        await flush();
        pending.shift()!();
        await flush();
      }
      const kept = loadTags(docId)!.tags[0];
      assert.equal(kept.versions?.length, 5);
      assert.equal(visualizationVersions(kept).length, 6);
      assert.equal(new Set(visualizationVersions(kept).map(version => version.id)).size, 6);
    } finally { pending.forEach(resolve => resolve()); await flush(); runner.mock.restore(); }
  } finally {
    if (oldDirectory === undefined) delete process.env.GETIT_DATA_DIR;
    else process.env.GETIT_DATA_DIR = oldDirectory;
    await rm(directory, { recursive: true, force: true });
  }
});