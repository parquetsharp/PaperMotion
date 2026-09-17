import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CONCURRENCY_LIMITS, normalizeConcurrency, type ConcurrencyField } from "../lib/job-concurrency";

test("parallelism values keep defaults and enforce finite integer bounds", () => {
  for (const field of Object.keys(CONCURRENCY_LIMITS) as ConcurrencyField[]) {
    const limits = CONCURRENCY_LIMITS[field];
    for (const value of [undefined, null, "8", NaN, Infinity, -Infinity]) {
      assert.equal(normalizeConcurrency(value, field), limits.default);
    }
    assert.equal(normalizeConcurrency(0, field), 1);
    assert.equal(normalizeConcurrency(-10, field), 1);
    assert.equal(normalizeConcurrency(2.9, field), 2);
    assert.equal(normalizeConcurrency(1000, field), limits.max);
    assert.equal(normalizeConcurrency(limits.max, field), limits.max);
  }
});

test("settings and schedulers honor persisted parallelism without interrupting active calls", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "papermotion-concurrency-"));
  const previousDirectory = process.env.GETIT_DATA_DIR;
  process.env.GETIT_DATA_DIR = directory;
  try {
    const { loadSettings, saveSettings } = await import("../lib/settings-store");
    const { GET, POST } = await import("../app/api/settings/route");
    const post = (body: object) => POST(new Request("http://localhost/api/settings", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }));
    assert.equal(loadSettings().detectionConcurrency, 3);
    assert.equal(loadSettings().vizConcurrency, 4);
    saveSettings({ ...loadSettings(), provider: "copilot", copilotModelFast: "custom-model" });
    assert.equal((await post({ detectionConcurrency: 8, vizConcurrency: 16 })).status, 200);
    const saved = loadSettings();
    assert.equal(saved.detectionConcurrency, 8);
    assert.equal(saved.vizConcurrency, 16);
    assert.equal(saved.copilotModelFast, "custom-model");
    assert.equal((await post({ theme: "dark" })).status, 200);
    assert.equal((await (await GET()).json()).vizConcurrency, 16);
    assert.equal((await post({ detectionConcurrency: 1 })).status, 200);
    assert.equal(loadSettings().vizConcurrency, 16);
    for (const field of Object.keys(CONCURRENCY_LIMITS) as ConcurrencyField[]) {
      for (const value of [0, -1, 1.5, "8", null, CONCURRENCY_LIMITS[field].max + 1]) {
        assert.equal((await post({ [field]: value, theme: "light" })).status, 400);
        assert.equal(loadSettings().theme, "dark");
        assert.equal(loadSettings().detectionConcurrency, 1);
        assert.equal(loadSettings().vizConcurrency, 16);
      }
    }
    for (const version of [1, 2]) {
      await writeFile(path.join(directory, "settings.json"), JSON.stringify({ v: version, provider: "copilot" }));
      assert.equal(loadSettings().detectionConcurrency, 3);
      assert.equal(loadSettings().vizConcurrency, 4);
    }
    await writeFile(path.join(directory, "settings.json"), JSON.stringify({ v: 2, detectionConcurrency: -3, vizConcurrency: 900 }));
    assert.equal(loadSettings().detectionConcurrency, 1);
    assert.equal(loadSettings().vizConcurrency, 16);
    saveSettings({ ...loadSettings(), detectionConcurrency: NaN, vizConcurrency: Infinity });
    const disk = JSON.parse(await readFile(path.join(directory, "settings.json"), "utf8"));
    assert.equal(disk.detectionConcurrency, 3);
    assert.equal(disk.vizConcurrency, 4);

    const { CopilotProvider } = await import("../lib/providers/copilot-provider");
    const { saveDoc } = await import("../lib/store");
    const { loadTags, saveTags } = await import("../lib/tags-store");
    const { ensureDetection, ensureVizQueue, getJobStatus } = await import("../lib/jobs");
    const formula = { type: "formula", title: "Momentum", caption: "Momentum from mass and velocity.", main_latex: "p=mv", steps: [] };
    const pending: Array<() => void> = [];
    const requests: string[] = [];
    const runner = mock.method(CopilotProvider.prototype, "runJson", (prompt: string) => {
      requests.push(prompt);
      return new Promise(resolve => pending.push(() => resolve({ data: prompt.includes("--- PAGES ---") ? { concepts: [] } : { ...formula, evidence: [] }, usage: null })));
    });
    const flush = async () => { for (let turn = 0; turn < 20; turn++) await setImmediate(); };
    try {
      for (const mode of ["detection", "viz"] as const) {
        const field = mode === "detection" ? "detectionConcurrency" : "vizConcurrency";
        for (const limit of [1, CONCURRENCY_LIMITS[field].default, CONCURRENCY_LIMITS[field].max]) {
          const total = limit + 5;
          const docId = `${mode}-${limit}`;
          const numPages = mode === "detection" ? total * 5 : 1;
          saveSettings({ ...loadSettings(), provider: "copilot", autoGenerate: false, [field]: limit });
          saveDoc({ id: docId, filename: "fixture.pdf", uploadedAt: 0, numPages, pdfUrl: "/unused.pdf", extracted: { numPages, pages: Array.from({ length: numPages }, (_, pageIndex) => ({ pageIndex, width: 600, height: 800, items: [], text: "A sufficiently detailed page about momentum and velocity. ".repeat(8) })) } });
          saveTags(docId, { activeTagId: null, pagesAnalyzed: [], tags: mode === "detection" ? [] : Array.from({ length: total }, (_, index) => ({ id: `tag-${index}`, page: 0, endX: 0, endY: 0, fontHeight: 12, type: "formula", label: `Momentum ${index}`, ready: false, generating: true, concept: { type: "formula", label: `Momentum ${index}`, anchor: "Momentum", context: "Momentum from mass and velocity." } })) });
          requests.length = 0;
          const start = mode === "detection" ? ensureDetection : ensureVizQueue;
          start(docId);
          start(docId);
          await flush();
          assert.equal(pending.length, limit, `${mode} fills exactly the configured number of slots`);
          assert.equal(requests.length, limit, "Repeated start does not duplicate the queue");
          assert.equal((await post({ [field]: 1 })).status, 200);
          assert.equal(pending.length, limit, "Lowering the limit leaves every existing request running");
          pending.shift()!();
          await flush();
          assert.equal(pending.length, Math.max(1, limit - 1), "Lowering concurrency drains existing calls without cancelling them");
          if (limit > 1) assert.equal(requests.length, limit, "No replacement starts while above the new limit");
          while (pending.length > 1) { pending.shift()!(); await flush(); }
          const originalRequests = [...pending];
          assert.equal((await post({ [field]: 3 })).status, 200);
          await flush();
          assert.equal(pending.length, 3, "Saving a higher limit immediately fills the extra slots");
          assert.ok(originalRequests.every(request => pending.includes(request)), "Scale-up preserves the original running requests");
          const originalThree = [...pending];
          assert.equal((await post({ [field]: 5 })).status, 200);
          await flush();
          assert.equal(pending.length, 5, "Changing 3 to 5 launches two more requests without waiting for a completion");
          assert.ok(originalThree.every(request => pending.includes(request)));
          const startedCount = requests.length;
          assert.equal((await post({ [field]: 5 })).status, 200);
          assert.equal((await post({ [field]: 3 })).status, 200);
          await flush();
          assert.equal(pending.length, 5, "Repeated saves and reductions never cancel or duplicate requests");
          assert.equal(requests.length, startedCount);
          for (let round = 0; round < total && pending.length; round++) {
            pending.splice(0).forEach(resolve => resolve());
            await flush();
          }
          assert.equal(pending.length, 0);
          assert.equal(requests.length, total);
          assert.equal(new Set(requests).size, total, "Each page batch or concept is requested once");
          const status = getJobStatus(docId);
          assert.equal(status.detectionRunning, false);
          assert.equal(status.vizQueueRunning, false);
          const result = loadTags(docId)!;
          if (mode === "detection") assert.equal(result.pagesAnalyzed.length, numPages);
          else assert.equal(result.tags.filter(tag => tag.ready && !tag.generating).length, total);
          assert.equal((await post({ [field]: 6 })).status, 200);
          await flush();
          assert.equal(requests.length, total, "Completed queues are not restarted or regenerated on settings save");
        }
      }
      const { CodexError } = await import("../lib/codex-errors");
      const stoppedCalls: Array<{ detection: boolean; resolve: () => void; reject: (error: Error) => void }> = [];
      const stoppedRunner = mock.method(CopilotProvider.prototype, "runJson", (prompt: string) => new Promise((resolve, reject) => {
        const detection = prompt.includes("--- PAGES ---");
        stoppedCalls.push({ detection, resolve: () => resolve({ data: detection ? { concepts: [] } : { ...formula, evidence: [] }, usage: null }), reject });
      }));
      const warnings = mock.method(console, "warn", () => {});
      try {
        const detectionId = `detection-${CONCURRENCY_LIMITS.detectionConcurrency.default}`;
        const vizId = `viz-${CONCURRENCY_LIMITS.vizConcurrency.default}`;
        saveSettings({ ...loadSettings(), detectionConcurrency: 3, vizConcurrency: 3 });
        saveTags(detectionId, { tags: [], pagesAnalyzed: [], activeTagId: null });
        const file = loadTags(vizId)!;
        saveTags(vizId, { tags: file.tags.map(tag => ({ ...tag, ready: false, generating: true })), pagesAnalyzed: [], activeTagId: null });
        ensureDetection(detectionId);
        ensureVizQueue(vizId);
        await flush();
        assert.equal(stoppedCalls.length, 6);
        stoppedCalls.find(call => call.detection)!.reject(new CodexError("auth_lost", "Fixture authentication failure"));
        stoppedCalls.find(call => !call.detection)!.reject(new CodexError("rate_limit", "Fixture quota failure"));
        await flush();
        assert.equal((await post({ detectionConcurrency: 5, vizConcurrency: 5 })).status, 200);
        await flush();
        assert.equal(stoppedCalls.length, 6, "Increasing limits does not bypass an account-error stop while other calls drain");
        stoppedCalls.forEach(call => call.resolve());
        await flush();
        assert.equal(getJobStatus(detectionId).detectionRunning, false);
        assert.equal(getJobStatus(vizId).vizQueueRunning, false);
        assert.equal((await post({ detectionConcurrency: 6, vizConcurrency: 6 })).status, 200);
        await flush();
        assert.equal(stoppedCalls.length, 6, "Stopped queues stay stopped after all in-flight requests finish");
      } finally {
        stoppedCalls.forEach(call => call.resolve());
        await flush();
        stoppedRunner.mock.restore();
        warnings.mock.restore();
      }
    } finally {
      runner.mock.restore();
    }
  } finally {
    if (previousDirectory === undefined) delete process.env.GETIT_DATA_DIR;
    else process.env.GETIT_DATA_DIR = previousDirectory;
    await rm(directory, { recursive: true, force: true });
  }
});